/**
 * CopilotHydra — OpenCode auth.json per-provider sync
 *
 * OpenCode stores OAuth tokens in `~/.local/share/opencode/auth.json`,
 * keyed by provider ID. When `getAuth()` is called with a provider ID that
 * has no entry, it returns `undefined`, causing the auth loader to return
 * an empty object and requests go out unauthenticated (Bad Request).
 *
 * This module ensures every active Hydra account has a matching oauth entry
 * in auth.json under its current `providerId` (e.g. `github-copilot-user-ruben`).
 *
 * Backfill sources (in priority order):
 * 1. Existing legacy entry under `github-copilot-acct-<accountId>`
 * 2. Hydra secret store token for that account
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { resolveOpenCodeAuthPath } from "./auth-path.js";
export { resolveOpenCodeAuthPath } from "./auth-path.js";
import { COPILOT_HYDRA_ACCT_PREFIX } from "../config/providers.js";
import { debugStorage, info, warn } from "../log.js";
import { findSecret } from "../storage/secrets.js";
import { withLock } from "../storage/locking.js";
import type { AccountId, CopilotAccountMeta } from "../types.js";

// ---------------------------------------------------------------------------
// Auth.json read/write
// ---------------------------------------------------------------------------

interface OAuthEntry {
	type: "oauth";
	refresh: string;
	access: string;
	expires: number;
	accountId?: string;
	enterpriseUrl?: string;
}

function isOAuthEntry(value: unknown): value is OAuthEntry {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return false;
	const rec = value as Record<string, unknown>;
	return (
		rec["type"] === "oauth" &&
		typeof rec["refresh"] === "string" &&
		typeof rec["access"] === "string" &&
		typeof rec["expires"] === "number"
	);
}

/**
 * Result of loading auth.json — distinguishes missing from corrupt.
 * Consumers can decide how to handle each state instead of silently
 * treating all errors as "empty".
 */
export interface LoadAuthJsonResult {
	/** auth.json was read and parsed successfully */
	ok: true;
	data: Record<string, unknown>;
	/** True when auth.json did not exist (ENOENT). The file was absent, not broken. */
	wasMissing?: undefined;
	/** Human-readable diagnostic when ok is false */
	error?: undefined;
}

export interface LoadAuthJsonError {
	ok: false;
	data: Record<string, unknown>;
	/** True when auth.json did not exist (ENOENT). The file was absent, not broken. */
	wasMissing: boolean;
	/** Human-readable diagnostic when ok is false */
	error: string;
}

type LoadAuthResult = LoadAuthJsonResult | LoadAuthJsonError;

async function loadAuthJson(
	authPath?: string,
): Promise<LoadAuthResult> {
	const path = authPath ?? resolveOpenCodeAuthPath();
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (isRecord(parsed)) {
			return { ok: true, data: parsed };
		}
		// Valid JSON but not an object — treat as corrupt
		return {
			ok: false,
			data: {},
			wasMissing: false,
			error: `auth.json root is not a JSON object (got ${typeof parsed})`,
		};
	} catch (err) {
		if (isNodeError(err) && err.code === "ENOENT") {
			// File simply doesn't exist — benign, return empty with wasMissing flag
			return { ok: false, data: {}, wasMissing: true, error: "auth.json not found (ENOENT)" };
		}
		const message = isNodeError(err)
			? `auth.json read error: ${err.code ?? "UNKNOWN"} — ${err.message}`
			: `auth.json parse error: ${String(err)}`;
		warn("auth-sync", message);
		return { ok: false, data: {}, wasMissing: false, error: message };
	}
}

async function saveAuthJsonLocked(
	data: Record<string, unknown>,
	authPath?: string,
): Promise<void> {
	const path = authPath ?? resolveOpenCodeAuthPath();

	// Ensure parent directory exists before acquiring lock
	await mkdir(dirname(path), { recursive: true });

	// Acquire lock around the entire read-modify-write cycle
	await withLock(path, async () => {
		// Re-read under lock to avoid clobbering concurrent writes
		let merged = data;
		try {
			const raw = await readFile(path, "utf-8");
			const parsed = JSON.parse(raw) as unknown;
			if (isRecord(parsed)) {
				// Merge: our data overwrites any existing keys
				merged = { ...parsed, ...data };
			}
		} catch (err) {
			if (!(isNodeError(err) && err.code === "ENOENT")) {
				// Corrupt or unreadable — overwrite with our data
				warn("auth-sync", `Overwriting unreadable auth.json under lock: ${String(err)}`);
			}
		}

		await saveAuthJsonUnlocked(merged, path);
	});
}

/**
 * Low-level atomic write without locking. Prefer saveAuthJsonLocked().
 * Exported for use in test helpers where locking is unnecessary.
 */
export async function saveAuthJsonUnlocked(
	data: Record<string, unknown>,
	authPath: string,
): Promise<void> {
	const tmpPath = authPath + ".tmp";
	const json = JSON.stringify(data, null, 2) + "\n";

	await mkdir(dirname(authPath), { recursive: true });
	await writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });

	if (process.platform === "win32") {
		try {
			try {
				await unlink(authPath);
			} catch {
				// ignore
			}
			await rename(tmpPath, authPath);
		} catch {
			await writeFile(authPath, json, { encoding: "utf-8", mode: 0o600 });
		}
		return;
	}

	await rename(tmpPath, authPath);
}

// ---------------------------------------------------------------------------
// Backfill logic
// ---------------------------------------------------------------------------

export interface BackfillResult {
	/** Total active accounts evaluated */
	total: number;
	/** Accounts that already had a matching providerId entry */
	alreadyPresent: number;
	/** Accounts backfilled from legacy acct-* entry */
	backfilledFromLegacy: string[];
	/** Accounts backfilled from Hydra secret store */
	backfilledFromSecrets: string[];
	/** Accounts that could not be backfilled (no token source) */
	unresolved: Array<{ accountId: AccountId; providerId: string }>;
}

/**
 * Ensure every active Hydra account has an oauth entry in OpenCode's auth.json
 * under its current providerId.
 *
 * This is safe to call repeatedly — it only writes entries that are missing.
 */
export async function backfillProviderAuthEntries(
	accounts: CopilotAccountMeta[],
	configDir?: string,
	authPath?: string,
): Promise<BackfillResult> {
	const result: BackfillResult = {
		total: accounts.length,
		alreadyPresent: 0,
		backfilledFromLegacy: [],
		backfilledFromSecrets: [],
		unresolved: [],
	};

	if (accounts.length === 0) return result;

	const loadResult = await loadAuthJson(authPath);
	const authData: Record<string, unknown> = { ...loadResult.data };
	// Collect only the new entries so that saveAuthJsonLocked merges just these
	// keys under the lock. Passing the entire authData would cause stale values
	// from the initial read to overwrite tokens that OpenCode (or another process)
	// wrote between our read and the locked write.
	const newEntries: Record<string, unknown> = {};

	if (!loadResult.ok && !loadResult.wasMissing) {
		warn("auth-sync", `auth.json load issue: ${loadResult.error ?? "unknown"}. Proceeding with backfill — any write will overwrite the corrupt file.`);
	}

	for (const account of accounts) {
		if (account.lifecycleState !== "active") continue;

		// Already has a valid entry under current providerId
		const existing = authData[account.providerId];
		if (isOAuthEntry(existing)) {
			result.alreadyPresent++;
			continue;
		}

		// Attempt backfill source 1: legacy acct-* entry
		const legacyKey = `${COPILOT_HYDRA_ACCT_PREFIX}${account.id}`;
		const legacyEntry = authData[legacyKey];
		if (isOAuthEntry(legacyEntry)) {
			newEntries[account.providerId] = {
				...legacyEntry,
				accountId: account.id,
			};
			result.backfilledFromLegacy.push(account.providerId);
			debugStorage(
				`backfilled auth.json entry for "${account.providerId}" from legacy key "${legacyKey}"`,
			);
			continue;
		}

		// Attempt backfill source 2: Hydra secret store
		const secret = await findSecret(account.id, configDir);
		if (secret?.githubOAuthToken) {
			newEntries[account.providerId] = {
				type: "oauth",
				refresh: secret.githubOAuthToken,
				access: secret.githubOAuthToken,
				expires: 0,
				accountId: account.id,
			};
			result.backfilledFromSecrets.push(account.providerId);
			debugStorage(
				`backfilled auth.json entry for "${account.providerId}" from Hydra secret store`,
			);
			continue;
		}

		// No source available
		result.unresolved.push({
			accountId: account.id,
			providerId: account.providerId,
		});
		warn(
			"auth-sync",
			`No token source found for account "${account.id}" (${account.providerId}). ` +
				"User may need to re-authenticate.",
		);
	}

	const modified =
		result.backfilledFromLegacy.length > 0 ||
		result.backfilledFromSecrets.length > 0;

	if (modified) {
		await saveAuthJsonLocked(newEntries, authPath);
		info(
			"auth-sync",
			`Backfilled ${result.backfilledFromLegacy.length + result.backfilledFromSecrets.length} ` +
				`auth.json entries (${result.backfilledFromLegacy.length} from legacy, ` +
				`${result.backfilledFromSecrets.length} from secrets)`,
		);
	}

	return result;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return typeof err === "object" && err !== null && "code" in err;
}

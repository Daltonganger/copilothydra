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
import { dirname, join } from "node:path";
import { COPILOT_HYDRA_ACCT_PREFIX } from "../config/providers.js";
import { debugStorage, info, warn } from "../log.js";
import { findSecret } from "../storage/secrets.js";
import type { AccountId, CopilotAccountMeta } from "../types.js";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the path to OpenCode's auth.json in the data directory.
 * Mirrors the logic in primary-compat-export.ts.
 */
export function resolveOpenCodeAuthPath(): string {
	const home =
		process.env["OPENCODE_TEST_HOME"] ??
		process.env["HOME"] ??
		process.env["USERPROFILE"] ??
		"~";
	if (process.env["XDG_DATA_HOME"]) {
		return join(process.env["XDG_DATA_HOME"], "opencode", "auth.json");
	}
	return join(home, ".local", "share", "opencode", "auth.json");
}

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

async function loadAuthJson(
	authPath?: string,
): Promise<Record<string, unknown>> {
	const path = authPath ?? resolveOpenCodeAuthPath();
	try {
		const raw = await readFile(path, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		if (isRecord(parsed)) return parsed;
	} catch (err) {
		if (isNodeError(err) && err.code === "ENOENT") {
			return {};
		}
		warn("auth-sync", `Failed to read auth.json: ${String(err)}`);
	}
	return {};
}

async function saveAuthJson(
	data: Record<string, unknown>,
	authPath?: string,
): Promise<void> {
	const path = authPath ?? resolveOpenCodeAuthPath();
	const tmpPath = path + ".tmp";
	const json = JSON.stringify(data, null, 2) + "\n";

	await mkdir(dirname(path), { recursive: true });
	await writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });

	if (process.platform === "win32") {
		try {
			try {
				await unlink(path);
			} catch {
				// ignore
			}
			await rename(tmpPath, path);
		} catch {
			await writeFile(path, json, { encoding: "utf-8", mode: 0o600 });
		}
		return;
	}

	await rename(tmpPath, path);
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

	const authData = await loadAuthJson(authPath);
	let modified = false;

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
			authData[account.providerId] = {
				...legacyEntry,
				accountId: account.id,
			};
			result.backfilledFromLegacy.push(account.providerId);
			modified = true;
			debugStorage(
				`backfilled auth.json entry for "${account.providerId}" from legacy key "${legacyKey}"`,
			);
			continue;
		}

		// Attempt backfill source 2: Hydra secret store
		const secret = await findSecret(account.id, configDir);
		if (secret?.githubOAuthToken) {
			authData[account.providerId] = {
				type: "oauth",
				refresh: secret.githubOAuthToken,
				access: secret.githubOAuthToken,
				expires: 0,
				accountId: account.id,
			};
			result.backfilledFromSecrets.push(account.providerId);
			modified = true;
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

	if (modified) {
		await saveAuthJson(authData, authPath);
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

/**
 * CopilotHydra — account storage
 *
 * Reads and writes the account metadata file (copilot-accounts.json).
 * No secrets are stored here.
 *
 * File location: <opencode-config-dir>/copilot-accounts.json
 * Default config dir: ~/.config/opencode/ (macOS/Linux)
 *                     ~/.config/opencode/ (Windows too, because OpenCode uses xdg-basedir universally)
 *
 * Important Spike E finding:
 * - OpenCode stores its own auth.json in the DATA dir (`~/.local/share/opencode/auth.json`)
 * - CopilotHydra stores its own metadata/secrets in the CONFIG dir by design
 *   because the user explicitly chose the OpenCode config directory convention.
 *
 * NOTE: Phase 0 scaffold. Locking is deferred to src/storage/locking.ts.
 * Atomic write/replace is implemented here but without cross-process locks.
 * Full lock-wrapped transactions are built in Phase 2.
 */

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AccountId, CopilotAccountMeta, AccountsFile } from "../types.js";
import { debugStorage, warn } from "../log.js";
import { withLock } from "./locking.js";
import { buildAccountLimitMessage, countActiveAccounts, MAX_ACTIVE_ACCOUNTS } from "../runtime-checks.js";
import {
  isRecord,
  requireEnumValue,
  requireIsoTimestamp,
  requireOptionalBoolean,
  requireOptionalString,
  requireString,
} from "./validation.js";
import { hardenWindowsFilePermissions } from "./windows-permissions.js";
import { buildProviderId } from "../config/providers.js";

const PLAN_TIERS = ["free", "student", "pro", "pro+"] as const;
const CAPABILITY_STATES = ["user-declared", "mismatch"] as const;
const LIFECYCLE_STATES = ["active", "pending-removal"] as const;

// ---------------------------------------------------------------------------
// Config dir resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the OpenCode config directory.
 *
 * Priority:
 * 1. OPENCODE_CONFIG_DIR env var (confirmed in Spike E)
 * 2. XDG_CONFIG_HOME/opencode
 * 3. <home>/.config/opencode
 *
 * Notes:
 * - OpenCode itself uses `xdg-basedir` across macOS/Linux/Windows.
 * - We intentionally mirror that convention here instead of using APPDATA.
 * - OPENCODE_TEST_HOME exists in OpenCode for test isolation; we honor it as
 *   a home-dir override when no explicit config dir is provided.
 */
export function resolveConfigDir(): string {
  if (process.env["OPENCODE_CONFIG_DIR"]) {
    return process.env["OPENCODE_CONFIG_DIR"];
  }
  if (process.env["XDG_CONFIG_HOME"]) {
    return join(process.env["XDG_CONFIG_HOME"], "opencode");
  }
  const home = process.env["OPENCODE_TEST_HOME"] ?? process.env["HOME"] ?? process.env["USERPROFILE"] ?? "~";
  return join(home, ".config", "opencode");
}

export function accountsFilePath(configDir?: string): string {
  return join(configDir ?? resolveConfigDir(), "copilot-accounts.json");
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function loadAccounts(configDir?: string): Promise<AccountsFile> {
  const path = accountsFilePath(configDir);
  const file = await loadAccountsFromPath(path);
  const { accountsFile, changed } = normalizeAccountsFile(file);
  if (changed) {
    await saveAccountsToPath(accountsFile, path);
  }
  return accountsFile;
}

async function loadAccountsFromPath(path: string): Promise<AccountsFile> {
  debugStorage(`loading accounts from ${path}`);

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return validateAccountsFile(parsed);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      debugStorage("accounts file not found, returning empty");
      return { version: 1, accounts: [] };
    }
    if (isCorruptionError(err)) {
      await quarantineCorruptFile(path, "accounts", err);
      return { version: 1, accounts: [] };
    }
    warn("storage", `Failed to load accounts file: ${String(err)}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Write (atomic)
// ---------------------------------------------------------------------------

export async function saveAccounts(data: AccountsFile, configDir?: string): Promise<void> {
  const path = accountsFilePath(configDir);
  await saveAccountsToPath(data, path);
}

async function saveAccountsToPath(data: AccountsFile, path: string): Promise<void> {
  const tmpPath = path + ".tmp";
  debugStorage(`saving accounts to ${path}`);

  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(data, null, 2) + "\n";

  // Atomic write: write to .tmp then rename
  await writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });

  // On Windows, rename may fail if destination exists — try unlink first (best-effort)
  if (process.platform === "win32") {
    try {
      const { unlink } = await import("node:fs/promises");
      try { await unlink(path); } catch { /* ignore if not exists */ }
      await rename(tmpPath, path);
    } catch (err) {
      warn("storage", `Atomic rename failed on Windows, falling back to direct write: ${String(err)}`);
      await writeFile(path, json, { encoding: "utf-8", mode: 0o600 });
    }
    // Best-effort DACL hardening on Windows
    await hardenWindowsFilePermissions(path);
  } else {
    await rename(tmpPath, path);
  }
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export async function findAccount(
  id: AccountId,
  configDir?: string
): Promise<CopilotAccountMeta | undefined> {
  const file = await loadAccounts(configDir);
  return file.accounts.find((a) => a.id === id);
}

export async function findAccountByGitHubUsername(
  githubUsername: string,
  configDir?: string
): Promise<CopilotAccountMeta | undefined> {
  const normalized = normalizeGitHubUsername(githubUsername);
  const file = await loadAccounts(configDir);
  return file.accounts.find((a) => normalizeGitHubUsername(a.githubUsername) === normalized);
}

export async function upsertAccount(
  account: CopilotAccountMeta,
  configDir?: string
): Promise<void> {
  await updateAccounts((file) => {
    const normalizedUsername = normalizeGitHubUsername(account.githubUsername);
    const duplicateUsername = file.accounts.find(
      (a) => a.id !== account.id && normalizeGitHubUsername(a.githubUsername) === normalizedUsername
    );
    if (duplicateUsername) {
      throw new Error(
        `[copilothydra] an account with GitHub username "${account.githubUsername}" already exists ` +
          `(existing label: ${duplicateUsername.label})`
      );
    }

    const idx = file.accounts.findIndex((a) => a.id === account.id);
    const otherAccounts = idx >= 0
      ? file.accounts.filter((a) => a.id !== account.id)
      : file.accounts;
    const activeAccountCount = countActiveAccounts(otherAccounts);
    if (account.lifecycleState === "active" && activeAccountCount >= MAX_ACTIVE_ACCOUNTS) {
      throw new Error(buildAccountLimitMessage(activeAccountCount));
    }

    if (idx >= 0) {
      file.accounts[idx] = account;
    } else {
      file.accounts.push(account);
    }
  }, configDir);
}

export async function removeAccount(
  id: AccountId,
  configDir?: string
): Promise<void> {
  await updateAccounts((file) => {
    file.accounts = file.accounts.filter((a) => a.id !== id);
  }, configDir);
}

export async function updateAccounts(
  mutator: (file: AccountsFile) => void | Promise<void>,
  configDir?: string
): Promise<AccountsFile> {
  const path = accountsFilePath(configDir);

  return await withLock(path, async () => {
    const loaded = await loadAccountsFromPath(path);
    const { accountsFile } = normalizeAccountsFile(loaded);
    await mutator(accountsFile);
    const normalized = normalizeAccountsFile(accountsFile).accountsFile;
    validateAccountsFile(normalized);
    await saveAccountsToPath(normalized, path);
    return normalized;
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateAccountsFile(data: unknown): AccountsFile {
  if (!isRecord(data) || data["version"] !== 1 || !Array.isArray(data["accounts"])) {
    throw new Error("[copilothydra] accounts file is corrupt or has an unexpected format");
  }

  const accounts = data["accounts"];
  const seenIds = new Set<string>();
  const seenProviderIds = new Set<string>();
  const seenGitHubUsernames = new Set<string>();

  for (const account of accounts) {
    if (!isRecord(account)) {
      throw new Error("[copilothydra] accounts file contains a non-object account entry");
    }

    const id = requireString(account, "id", "account");
    const providerId = requireString(account, "providerId", "account");
    requireString(account, "label", "account");
    const githubUsername = requireString(account, "githubUsername", "account");
    const plan = requireString(account, "plan", "account");
    const capabilityState = requireString(account, "capabilityState", "account");
    requireOptionalBoolean(account, "allowUnverifiedModels", "account");
    const mismatchDetectedAt = requireOptionalString(account, "mismatchDetectedAt", "account");
    requireOptionalString(account, "mismatchModelId", "account");
    const mismatchSuggestedPlan = requireOptionalString(account, "mismatchSuggestedPlan", "account");
    const lifecycleState = requireString(account, "lifecycleState", "account");
    const addedAt = requireString(account, "addedAt", "account");
    const lastValidatedAt = requireOptionalString(account, "lastValidatedAt", "account");

    requireEnumValue(plan, PLAN_TIERS, "account", "plan");
    requireEnumValue(capabilityState, CAPABILITY_STATES, "account", "capabilityState");
    if (mismatchSuggestedPlan !== undefined) {
      requireEnumValue(mismatchSuggestedPlan, PLAN_TIERS, "account", "mismatchSuggestedPlan");
    }
    requireEnumValue(lifecycleState, LIFECYCLE_STATES, "account", "lifecycleState");
    requireIsoTimestamp(addedAt, "account", "addedAt");
    if (lastValidatedAt !== undefined) {
      requireIsoTimestamp(lastValidatedAt, "account", "lastValidatedAt");
    }
    if (mismatchDetectedAt !== undefined) {
      requireIsoTimestamp(mismatchDetectedAt, "account", "mismatchDetectedAt");
    }

    if (seenIds.has(id)) {
      throw new Error(`[copilothydra] accounts file contains duplicate account id: ${id}`);
    }
    if (seenProviderIds.has(providerId)) {
      throw new Error(`[copilothydra] accounts file contains duplicate provider id: ${providerId}`);
    }
    const normalizedUsername = normalizeGitHubUsername(githubUsername);
    if (seenGitHubUsernames.has(normalizedUsername)) {
      throw new Error(`[copilothydra] accounts file contains duplicate github username: ${githubUsername}`);
    }

    seenIds.add(id);
    seenProviderIds.add(providerId);
    seenGitHubUsernames.add(normalizedUsername);
  }

  return data as unknown as AccountsFile;
}

function normalizeAccountsFile(data: AccountsFile): { accountsFile: AccountsFile; changed: boolean } {
  let changed = false;
  const accounts = data.accounts.map((account) => {
    const expectedProviderId = buildProviderId(account.githubUsername);
    if (account.providerId === expectedProviderId) {
      return account;
    }

    changed = true;
    return {
      ...account,
      providerId: expectedProviderId,
    };
  });

  return {
    accountsFile: changed ? { ...data, accounts } : data,
    changed,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function normalizeGitHubUsername(value: string): string {
  return value.trim().toLowerCase();
}

function isCorruptionError(err: unknown): boolean {
  return (
    err instanceof SyntaxError ||
    (err instanceof Error && (
      err.message.includes("accounts file is corrupt or has an unexpected format") ||
      err.message.includes("accounts file contains") ||
        err.message.includes("account is missing required string field") ||
        err.message.includes("account has invalid optional string field") ||
        err.message.includes("account has invalid optional boolean field") ||
        err.message.includes("account has invalid enum value") ||
        err.message.includes("account has invalid ISO timestamp") ||
        err.message.includes("duplicate github username")
    ))
  );
}

async function quarantineCorruptFile(path: string, label: string, err: unknown): Promise<void> {
  const quarantinePath = `${path}.corrupt-${Date.now()}`;
  warn("storage", `Detected corrupt ${label} file. Quarantining to ${quarantinePath}`);

  try {
    await rename(path, quarantinePath);
  } catch (renameErr) {
    warn(
      "storage",
      `Failed to quarantine corrupt ${label} file after load error: ${String(renameErr)} (original error: ${String(err)})`
    );
    throw err;
  }
}

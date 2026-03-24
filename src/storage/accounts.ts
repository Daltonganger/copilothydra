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
  return loadAccountsFromPath(path);
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

export async function upsertAccount(
  account: CopilotAccountMeta,
  configDir?: string
): Promise<void> {
  await updateAccounts((file) => {
    const idx = file.accounts.findIndex((a) => a.id === account.id);
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
    const file = await loadAccountsFromPath(path);
    await mutator(file);
    validateAccountsFile(file);
    await saveAccountsToPath(file, path);
    return file;
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

  for (const account of accounts) {
    if (!isRecord(account)) {
      throw new Error("[copilothydra] accounts file contains a non-object account entry");
    }

    const id = requireString(account, "id", "account");
    const providerId = requireString(account, "providerId", "account");
    requireString(account, "label", "account");
    requireString(account, "githubUsername", "account");
    requireString(account, "plan", "account");
    requireString(account, "capabilityState", "account");
    requireString(account, "lifecycleState", "account");
    requireString(account, "addedAt", "account");

    if (seenIds.has(id)) {
      throw new Error(`[copilothydra] accounts file contains duplicate account id: ${id}`);
    }
    if (seenProviderIds.has(providerId)) {
      throw new Error(`[copilothydra] accounts file contains duplicate provider id: ${providerId}`);
    }

    seenIds.add(id);
    seenProviderIds.add(providerId);
  }

  return data as unknown as AccountsFile;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`[copilothydra] ${label} is missing required string field: ${key}`);
  }
  return value;
}

function isCorruptionError(err: unknown): boolean {
  return (
    err instanceof SyntaxError ||
    (err instanceof Error && (
      err.message.includes("accounts file is corrupt or has an unexpected format") ||
      err.message.includes("accounts file contains") ||
      err.message.includes("account is missing required string field")
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

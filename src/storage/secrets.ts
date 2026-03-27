/**
 * CopilotHydra — secrets storage
 *
 * Reads and writes the secrets file (copilot-secrets.json).
 * Contains GitHub OAuth tokens. Never logged.
 *
 * File location: <opencode-config-dir>/copilot-secrets.json
 *
 * Security notes:
 * - created with mode 0o600 (owner read/write only)
 * - tokens are NEVER passed to log functions
 * - plaintext storage is v1-only; keychain migration is a Phase 2+ concern
 * - COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM flag must be set to write tokens
 *
 * NOTE: Phase 0 scaffold. Cross-process locking is in src/storage/locking.ts (Phase 2).
 */

import { chmod, readFile, stat, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AccountId, CopilotSecretRecord, SecretsFile, AccountsFile } from "../types.js";
import { debugStorage, warn } from "../log.js";
import { isUnsafePlaintextConfirmed } from "../flags.js";
import { resolveConfigDir } from "./accounts.js";
import { withLock } from "./locking.js";
import { isRecord, requireIsoTimestamp, requireOptionalString, requireString } from "./validation.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function secretsFilePath(configDir?: string): string {
  return join(configDir ?? resolveConfigDir(), "copilot-secrets.json");
}

export type SecretsFilePermissionStatus = "ok" | "insecure" | "missing" | "unsupported";

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function loadSecrets(configDir?: string): Promise<SecretsFile> {
  const path = secretsFilePath(configDir);
  return loadSecretsFromPath(path);
}

async function loadSecretsFromPath(path: string): Promise<SecretsFile> {
  debugStorage("loading secrets file (path not logged)");

  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return validateSecretsFile(parsed);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      debugStorage("secrets file not found, returning empty");
      return { version: 1, secrets: [] };
    }
    if (isCorruptionError(err)) {
      await quarantineCorruptFile(path, "secrets", err);
      return { version: 1, secrets: [] };
    }
    warn("storage", "Failed to load secrets file (path and content not logged for security)");
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Write (atomic)
// ---------------------------------------------------------------------------

export async function saveSecrets(data: SecretsFile, configDir?: string): Promise<void> {
  const path = secretsFilePath(configDir);
  await saveSecretsToPath(data, path);
}

async function saveSecretsToPath(data: SecretsFile, path: string): Promise<void> {
  if (!isUnsafePlaintextConfirmed()) {
    throw new Error(
      "[copilothydra] Refusing to write secrets to plaintext storage. " +
      "Set COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM=1 to acknowledge that " +
      "plaintext secrets are not safe for production use."
    );
  }
  const tmpPath = path + ".tmp";
  debugStorage("saving secrets file (path not logged)");

  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(data, null, 2) + "\n";

  // Strict permissions: owner read/write only
  await writeFile(tmpPath, json, { encoding: "utf-8", mode: 0o600 });

  if (process.platform === "win32") {
    try {
      const { unlink } = await import("node:fs/promises");
      try { await unlink(path); } catch { /* ignore */ }
      await rename(tmpPath, path);
    } catch (err) {
      warn("storage", `Atomic rename failed on Windows (falling back to direct write): ${String(err)}`);
      await writeFile(path, json, { encoding: "utf-8", mode: 0o600 });
    }
  } else {
    await rename(tmpPath, path);
  }

  await normalizeSecretsFilePermissionsAtPath(path);
}

// ---------------------------------------------------------------------------
// CRUD helpers
// ---------------------------------------------------------------------------

export async function findSecret(
  accountId: AccountId,
  configDir?: string
): Promise<CopilotSecretRecord | undefined> {
  const file = await loadSecrets(configDir);
  return file.secrets.find((s) => s.accountId === accountId);
}

export async function upsertSecret(
  record: CopilotSecretRecord,
  configDir?: string
): Promise<void> {
  await updateSecrets((file) => {
    const idx = file.secrets.findIndex((s) => s.accountId === record.accountId);
    if (idx >= 0) {
      file.secrets[idx] = record;
    } else {
      file.secrets.push(record);
    }
  }, configDir);
}

export async function removeSecret(
  accountId: AccountId,
  configDir?: string
): Promise<void> {
  await updateSecrets((file) => {
    file.secrets = file.secrets.filter((s) => s.accountId !== accountId);
  }, configDir);
}

export async function updateSecrets(
  mutator: (file: SecretsFile) => void | Promise<void>,
  configDir?: string
): Promise<SecretsFile> {
  const path = secretsFilePath(configDir);

  return await withLock(path, async () => {
    const file = await loadSecretsFromPath(path);
    await mutator(file);
    validateSecretsFile(file);
    await saveSecretsToPath(file, path);
    return file;
  });
}

export async function pruneOrphanSecrets(
  accounts: AccountsFile | { accounts: Array<{ id: AccountId }> },
  configDir?: string
): Promise<SecretsFile> {
  const validAccountIds = new Set(accounts.accounts.map((account) => account.id));

  return await updateSecrets((file) => {
    file.secrets = file.secrets.filter((secret) => validAccountIds.has(secret.accountId));
  }, configDir);
}

export async function getSecretsFilePermissionStatus(configDir?: string): Promise<SecretsFilePermissionStatus> {
  return await getSecretsFilePermissionStatusAtPath(secretsFilePath(configDir));
}

export async function normalizeSecretsFilePermissions(configDir?: string): Promise<boolean> {
  return await normalizeSecretsFilePermissionsAtPath(secretsFilePath(configDir));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSecretsFile(data: unknown): SecretsFile {
  if (!isRecord(data) || data["version"] !== 1 || !Array.isArray(data["secrets"])) {
    throw new Error("[copilothydra] secrets file is corrupt or has an unexpected format");
  }

  const secrets = data["secrets"];
  const seenAccountIds = new Set<string>();

  for (const secret of secrets) {
    if (!isRecord(secret)) {
      throw new Error("[copilothydra] secrets file contains a non-object secret entry");
    }

    const accountId = requireString(secret, "accountId", "secret");
    requireString(secret, "githubOAuthToken", "secret");
    const copilotAccessToken = requireOptionalString(secret, "copilotAccessToken", "secret");
    const copilotAccessTokenExpiresAt = requireOptionalString(secret, "copilotAccessTokenExpiresAt", "secret");

    if (copilotAccessTokenExpiresAt !== undefined) {
      requireIsoTimestamp(copilotAccessTokenExpiresAt, "secret", "copilotAccessTokenExpiresAt");
      if (copilotAccessToken === undefined) {
        throw new Error(
          "[copilothydra] secret has invalid token expiry state: copilotAccessTokenExpiresAt requires copilotAccessToken"
        );
      }
    }

    if (seenAccountIds.has(accountId)) {
      throw new Error(`[copilothydra] secrets file contains duplicate account id: ${accountId}`);
    }

    seenAccountIds.add(accountId);
  }

  return data as unknown as SecretsFile;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

async function getSecretsFilePermissionStatusAtPath(path: string): Promise<SecretsFilePermissionStatus> {
  if (process.platform === "win32") {
    return "unsupported";
  }

  try {
    const fileStat = await stat(path);
    return (fileStat.mode & 0o777) === 0o600 ? "ok" : "insecure";
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return "missing";
    }
    throw err;
  }
}

async function normalizeSecretsFilePermissionsAtPath(path: string): Promise<boolean> {
  if (process.platform === "win32") {
    return false;
  }

  try {
    const status = await getSecretsFilePermissionStatusAtPath(path);
    if (status !== "insecure") {
      return false;
    }
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return false;
    }
    throw err;
  }

  try {
    await chmod(path, 0o600);
    return true;
  } catch (err) {
    if (isNodeError(err) && (
      err.code === "ENOENT" ||
      err.code === "EACCES" ||
      err.code === "EPERM" ||
      err.code === "EINVAL" ||
      err.code === "ENOTSUP"
    )) {
      warn("storage", `Unable to normalize secrets file permissions safely: ${String(err)}`);
      return false;
    }
    throw err;
  }
}

function isCorruptionError(err: unknown): boolean {
  return (
    err instanceof SyntaxError ||
    (err instanceof Error && (
      err.message.includes("secrets file is corrupt or has an unexpected format") ||
      err.message.includes("secrets file contains") ||
      err.message.includes("secret is missing required string field") ||
      err.message.includes("secret has invalid optional string field") ||
      err.message.includes("secret has invalid ISO timestamp") ||
      err.message.includes("secret has invalid token expiry state")
    ))
  );
}

async function quarantineCorruptFile(path: string, label: string, err: unknown): Promise<void> {
  const quarantinePath = `${path}.corrupt-${Date.now()}`;
  warn("storage", `Detected corrupt ${label} file. Quarantining existing file.`);

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

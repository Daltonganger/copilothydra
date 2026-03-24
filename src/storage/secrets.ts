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

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { AccountId, CopilotSecretRecord, SecretsFile } from "../types.js";
import { debugStorage, warn } from "../log.js";
import { isUnsafePlaintextConfirmed } from "../flags.js";
import { resolveConfigDir } from "./accounts.js";
import { withLock } from "./locking.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

export function secretsFilePath(configDir?: string): string {
  return join(configDir ?? resolveConfigDir(), "copilot-secrets.json");
}

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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateSecretsFile(data: unknown): SecretsFile {
  if (
    typeof data !== "object" ||
    data === null ||
    (data as Record<string, unknown>)["version"] !== 1 ||
    !Array.isArray((data as Record<string, unknown>)["secrets"])
  ) {
    throw new Error("[copilothydra] secrets file is corrupt or has an unexpected format");
  }
  return data as SecretsFile;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function isCorruptionError(err: unknown): boolean {
  return (
    err instanceof SyntaxError ||
    (err instanceof Error && err.message.includes("secrets file is corrupt or has an unexpected format"))
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

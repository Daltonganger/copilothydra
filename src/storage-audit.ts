/**
 * CopilotHydra — storage/config audit helpers
 *
 * Detect-only audit pass for Phase 2. Unlike repairStorage(), this does not
 * mutate anything; it only reports inconsistencies across accounts, secrets,
 * and OpenCode config.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAccounts } from "./storage/accounts.js";
import { getSecretsFilePermissionStatus, loadSecrets } from "./storage/secrets.js";
import type { SecretsFilePermissionStatus } from "./storage/secrets.js";
import { loadOpenCodeConfig, resolveOpenCodeConfigPath } from "./config/opencode-config.js";
import { buildProviderConfig, isCopilotHydraProvider } from "./config/providers.js";
import { isKnownCopilotModelId } from "./config/models.js";

interface ModelCatalogDrift {
  unknownCopilotModelIds: string[];
  driftedProviderIds: string[];
}

export interface ModelsDevDriftSignal {
  checked: boolean;
  reachable: boolean;
  newCopilotModelIds: string[];
}

export interface AuthDriftEntry {
  providerId: string;
  accountId: string;
}

export interface AuditStorageResult {
  accountCount: number;
  secretCount: number;
  accountsWithoutSecrets: string[];
  orphanSecretAccountIds: string[];
  missingProviderIds: string[];
  staleProviderIds: string[];
  authDriftEntries: AuthDriftEntry[];
  modelCatalogConsistent: boolean;
  modelCatalogDrift: ModelCatalogDrift;
  modelsDevDriftSignal: ModelsDevDriftSignal;
  insecureSecretsFilePermissions: boolean;
  secretsFilePermissionStatus: SecretsFilePermissionStatus;
  ok: boolean;
}

export async function auditStorage(options?: {
  configDir?: string;
  configPath?: string;
  authPath?: string;
}): Promise<AuditStorageResult> {
  const configPath = options?.configPath ?? resolveOpenCodeConfigPath(options?.configDir);
  const [accountsFile, secretsFile, config, secretsFilePermissionStatus] = await Promise.all([
    loadAccounts(options?.configDir),
    loadSecrets(options?.configDir),
    loadOpenCodeConfig(configPath),
    getSecretsFilePermissionStatus(options?.configDir),
  ]);

  const activeAccounts = accountsFile.accounts.filter((account) => account.lifecycleState === "active");
  const accountIds = new Set(accountsFile.accounts.map((account) => account.id));
  const secretAccountIds = new Set(secretsFile.secrets.map((secret) => secret.accountId));
  const providerIds = new Set(Object.keys(config.provider ?? {}).filter(isCopilotHydraProvider));

  const accountsWithoutSecrets = activeAccounts
    .filter((account) => !secretAccountIds.has(account.id))
    .map((account) => account.id);
  const orphanSecretAccountIds = secretsFile.secrets
    .filter((secret) => !accountIds.has(secret.accountId))
    .map((secret) => secret.accountId);
  const missingProviderIds = activeAccounts
    .filter((account) => !providerIds.has(account.providerId))
    .map((account) => account.providerId);
  const staleProviderIds = [...providerIds].filter(
    (providerId) => !activeAccounts.some((account) => account.providerId === providerId),
  );
  const modelCatalogDrift = detectModelCatalogDrift(activeAccounts, config.provider ?? {});
  const modelsDevDriftSignal = await detectModelsDevDrift();
  const modelCatalogConsistent =
    modelCatalogDrift.unknownCopilotModelIds.length === 0 &&
    modelCatalogDrift.driftedProviderIds.length === 0;

  const insecureSecretsFilePermissions = secretsFilePermissionStatus === "insecure";

  // ── Auth drift detection ──
  const authDriftEntries = await detectAuthDrift(activeAccounts, options?.authPath);

  const ok =
    accountsWithoutSecrets.length === 0 &&
    orphanSecretAccountIds.length === 0 &&
    missingProviderIds.length === 0 &&
    staleProviderIds.length === 0 &&
    !insecureSecretsFilePermissions &&
    modelCatalogConsistent &&
    authDriftEntries.length === 0;

  return {
    accountCount: accountsFile.accounts.length,
    secretCount: secretsFile.secrets.length,
    accountsWithoutSecrets,
    orphanSecretAccountIds,
    missingProviderIds,
    staleProviderIds,
    authDriftEntries,
    modelCatalogConsistent,
    modelCatalogDrift,
    modelsDevDriftSignal,
    insecureSecretsFilePermissions,
    secretsFilePermissionStatus,
    ok,
  };
}

async function detectModelsDevDrift(): Promise<ModelsDevDriftSignal> {
  const modelsDevUrl = process.env.COPILOTHYDRA_MODELS_DEV_URL?.trim() || "https://models.dev/models.json";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const response = await fetch(modelsDevUrl, { signal: controller.signal });
      if (!response.ok) {
        return {
          checked: true,
          reachable: false,
          newCopilotModelIds: [],
        };
      }

      const payload = await response.json() as { models?: Array<{ id?: unknown, provider?: unknown }> };
      const newCopilotModelIds = (payload.models ?? [])
        .filter((entry) => entry.provider === "github-copilot" && typeof entry.id === "string")
        .map((entry) => entry.id as string)
        .filter((modelId) => !isKnownCopilotModelId(modelId))
        .sort();

      return {
        checked: true,
        reachable: true,
        newCopilotModelIds,
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return {
      checked: true,
      reachable: false,
      newCopilotModelIds: [],
    };
  }
}

function detectModelCatalogDrift(
  activeAccounts: Awaited<ReturnType<typeof loadAccounts>>["accounts"],
  providerConfig: Record<string, { models?: Record<string, unknown> }>,
): ModelCatalogDrift {
  const unknownCopilotModelIds = new Set<string>();
  const driftedProviderIds = new Set<string>();

  for (const [providerId, providerEntry] of Object.entries(providerConfig)) {
    const models = providerEntry.models ?? {};
    for (const modelId of Object.keys(models)) {
      if (isAuditedCopilotProvider(providerId) && !isKnownCopilotModelId(modelId)) {
        unknownCopilotModelIds.add(modelId);
      }
    }
  }

  for (const account of activeAccounts) {
    const currentProviderEntry = providerConfig[account.providerId];
    if (!currentProviderEntry) continue;

    const expectedModelIds = Object.keys(buildProviderConfig(account).models ?? {}).sort();
    const actualModelIds = Object.keys(currentProviderEntry.models ?? {}).sort();
    if (!sameStringArray(expectedModelIds, actualModelIds)) {
      driftedProviderIds.add(account.providerId);
    }
  }

  return {
    unknownCopilotModelIds: [...unknownCopilotModelIds].sort(),
    driftedProviderIds: [...driftedProviderIds].sort(),
  };
}

// ---------------------------------------------------------------------------
// Auth drift detection
// ---------------------------------------------------------------------------

/**
 * Detect active Hydra accounts whose `providerId` lacks a valid oauth entry
 * in OpenCode's auth.json. These accounts will produce unauthenticated
 * requests (400 Bad Request) when routed through OpenCode.
 */
async function detectAuthDrift(
  activeAccounts: Awaited<ReturnType<typeof loadAccounts>>["accounts"],
  authPath?: string,
): Promise<AuthDriftEntry[]> {
  const path = authPath ?? resolveOpenCodeAuthPath();
  let authData: Record<string, unknown>;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (isRecord(parsed)) {
      authData = parsed;
    } else {
      return activeAccounts.map((a) => ({ providerId: a.providerId, accountId: a.id }));
    }
  } catch (err) {
    // If auth.json doesn't exist or can't be read, every active account is drifted
    if (isNodeError(err) && err.code === "ENOENT") {
      return activeAccounts.map((a) => ({ providerId: a.providerId, accountId: a.id }));
    }
    return activeAccounts.map((a) => ({ providerId: a.providerId, accountId: a.id }));
  }

  return activeAccounts
    .filter((account) => !isValidOAuthEntry(authData[account.providerId]))
    .map((account) => ({ providerId: account.providerId, accountId: account.id }));
}

function resolveOpenCodeAuthPath(): string {
  if (process.env["COPILOTHYDRA_TEST_AUTH_PATH"]) {
    return process.env["COPILOTHYDRA_TEST_AUTH_PATH"];
  }
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

function isValidOAuthEntry(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return (
    rec["type"] === "oauth" &&
    typeof rec["refresh"] === "string" &&
    typeof rec["access"] === "string" &&
    typeof rec["expires"] === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function isAuditedCopilotProvider(providerId: string): boolean {
  return providerId === "github-copilot" || isCopilotHydraProvider(providerId);
}

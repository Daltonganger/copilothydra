/**
 * CopilotHydra — storage/config audit helpers
 *
 * Detect-only audit pass for Phase 2. Unlike repairStorage(), this does not
 * mutate anything; it only reports inconsistencies across accounts, secrets,
 * and OpenCode config.
 */

import { loadAccounts } from "./storage/accounts.js";
import { loadSecrets } from "./storage/secrets.js";
import { loadOpenCodeConfig, resolveOpenCodeConfigPath } from "./config/opencode-config.js";
import { buildProviderConfig, isCopilotHydraProvider } from "./config/providers.js";
import { isKnownCopilotModelId } from "./config/models.js";

interface ModelCatalogDrift {
  unknownCopilotModelIds: string[];
  driftedProviderIds: string[];
}

export interface AuditStorageResult {
  accountCount: number;
  secretCount: number;
  accountsWithoutSecrets: string[];
  orphanSecretAccountIds: string[];
  missingProviderIds: string[];
  staleProviderIds: string[];
  modelCatalogConsistent: boolean;
  modelCatalogDrift: ModelCatalogDrift;
  ok: boolean;
}

export async function auditStorage(options?: {
  configDir?: string;
  configPath?: string;
}): Promise<AuditStorageResult> {
  const configPath = options?.configPath ?? resolveOpenCodeConfigPath(options?.configDir);
  const [accountsFile, secretsFile, config] = await Promise.all([
    loadAccounts(options?.configDir),
    loadSecrets(options?.configDir),
    loadOpenCodeConfig(configPath),
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
  const modelCatalogConsistent =
    modelCatalogDrift.unknownCopilotModelIds.length === 0 &&
    modelCatalogDrift.driftedProviderIds.length === 0;

  const ok =
    accountsWithoutSecrets.length === 0 &&
    orphanSecretAccountIds.length === 0 &&
    missingProviderIds.length === 0 &&
    staleProviderIds.length === 0 &&
    modelCatalogConsistent;

  return {
    accountCount: accountsFile.accounts.length,
    secretCount: secretsFile.secrets.length,
    accountsWithoutSecrets,
    orphanSecretAccountIds,
    missingProviderIds,
    staleProviderIds,
    modelCatalogConsistent,
    modelCatalogDrift,
    ok,
  };
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
      if (providerId.includes("github-copilot") && !isKnownCopilotModelId(modelId)) {
        unknownCopilotModelIds.add(modelId);
      }
    }
  }

  for (const account of activeAccounts) {
    const currentProviderEntry = providerConfig[account.providerId];
    if (!currentProviderEntry?.models) continue;

    const expectedModelIds = Object.keys(buildProviderConfig(account).models ?? {}).sort();
    const actualModelIds = Object.keys(currentProviderEntry.models).sort();
    if (!sameStringArray(expectedModelIds, actualModelIds)) {
      driftedProviderIds.add(account.providerId);
    }
  }

  return {
    unknownCopilotModelIds: [...unknownCopilotModelIds].sort(),
    driftedProviderIds: [...driftedProviderIds].sort(),
  };
}

function sameStringArray(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

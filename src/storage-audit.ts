/**
 * CopilotHydra — storage/config audit helpers
 *
 * Detect-only audit pass for Phase 2. Unlike repairStorage(), this does not
 * mutate anything; it only reports inconsistencies across accounts, secrets,
 * and OpenCode config.
 */

import { loadAccounts } from "./storage/accounts.js";
import { getSecretsFilePermissionStatus, loadSecrets } from "./storage/secrets.js";
import type { SecretsFilePermissionStatus } from "./storage/secrets.js";
import { loadOpenCodeConfig, resolveOpenCodeConfigPath } from "./config/opencode-config.js";
import { isCopilotHydraProvider } from "./config/providers.js";

export interface AuditStorageResult {
  accountCount: number;
  secretCount: number;
  accountsWithoutSecrets: string[];
  orphanSecretAccountIds: string[];
  missingProviderIds: string[];
  staleProviderIds: string[];
  insecureSecretsFilePermissions: boolean;
  secretsFilePermissionStatus: SecretsFilePermissionStatus;
  ok: boolean;
}

export async function auditStorage(options?: {
  configDir?: string;
  configPath?: string;
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

  const insecureSecretsFilePermissions = secretsFilePermissionStatus === "insecure";

  const ok =
    accountsWithoutSecrets.length === 0 &&
    orphanSecretAccountIds.length === 0 &&
    missingProviderIds.length === 0 &&
    staleProviderIds.length === 0 &&
    !insecureSecretsFilePermissions;

  return {
    accountCount: accountsFile.accounts.length,
    secretCount: secretsFile.secrets.length,
    accountsWithoutSecrets,
    orphanSecretAccountIds,
    missingProviderIds,
    staleProviderIds,
    insecureSecretsFilePermissions,
    secretsFilePermissionStatus,
    ok,
  };
}

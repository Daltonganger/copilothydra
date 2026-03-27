/**
 * CopilotHydra — storage/config reconcile helpers
 *
 * Phase 2 helper for explicitly reconciling three persistence surfaces:
 * - account metadata
 * - secrets storage
 * - OpenCode provider config
 */

import { loadAccounts } from "./storage/accounts.js";
import { getSecretsFilePermissionStatus, loadSecrets, normalizeSecretsFilePermissions, pruneOrphanSecrets } from "./storage/secrets.js";
import type { SecretsFilePermissionStatus } from "./storage/secrets.js";
import { syncAccountsToOpenCodeConfig } from "./config/sync.js";

export interface RepairStorageResult {
  accountCount: number;
  secretCountBefore: number;
  secretCountAfter: number;
  prunedSecretCount: number;
  normalizedSecretsFilePermissions: boolean;
  secretsFilePermissionStatusAfter: SecretsFilePermissionStatus;
}

export async function repairStorage(options?: {
  configDir?: string;
  configPath?: string;
}): Promise<RepairStorageResult> {
  const accounts = await loadAccounts(options?.configDir);
  const secretsBefore = await loadSecrets(options?.configDir);
  const secretsAfter = await pruneOrphanSecrets(accounts, options?.configDir);
  const normalizedSecretsFilePermissions = await normalizeSecretsFilePermissions(options?.configDir);
  const secretsFilePermissionStatusAfter = await getSecretsFilePermissionStatus(options?.configDir);
  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);

  return {
    accountCount: accounts.accounts.length,
    secretCountBefore: secretsBefore.secrets.length,
    secretCountAfter: secretsAfter.secrets.length,
    prunedSecretCount: secretsBefore.secrets.length - secretsAfter.secrets.length,
    normalizedSecretsFilePermissions,
    secretsFilePermissionStatusAfter,
  };
}

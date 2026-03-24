/**
 * CopilotHydra — storage/config reconcile helpers
 *
 * Phase 2 helper for explicitly reconciling three persistence surfaces:
 * - account metadata
 * - secrets storage
 * - OpenCode provider config
 */

import { loadAccounts } from "./storage/accounts.js";
import { loadSecrets, pruneOrphanSecrets } from "./storage/secrets.js";
import { syncAccountsToOpenCodeConfig } from "./config/sync.js";

export interface RepairStorageResult {
  accountCount: number;
  secretCountBefore: number;
  secretCountAfter: number;
  prunedSecretCount: number;
}

export async function repairStorage(options?: {
  configDir?: string;
  configPath?: string;
}): Promise<RepairStorageResult> {
  const accounts = await loadAccounts(options?.configDir);
  const secretsBefore = await loadSecrets(options?.configDir);
  const secretsAfter = await pruneOrphanSecrets(accounts, options?.configDir);
  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);

  return {
    accountCount: accounts.accounts.length,
    secretCountBefore: secretsBefore.secrets.length,
    secretCountAfter: secretsAfter.secrets.length,
    prunedSecretCount: secretsBefore.secrets.length - secretsAfter.secrets.length,
  };
}

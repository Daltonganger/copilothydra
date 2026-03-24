/**
 * CopilotHydra — account removal helpers
 *
 * Phase 2 helper that removes an account's metadata, secrets, and provider
 * config entry as one explicit cleanup operation.
 */

import type { AccountId, CopilotAccountMeta } from "./types.js";
import { loadAccounts, removeAccount } from "./storage/accounts.js";
import { pruneOrphanSecrets, removeSecret } from "./storage/secrets.js";
import { syncAccountsToOpenCodeConfig } from "./config/sync.js";

export async function removeAccountCompletely(
  accountId: AccountId,
  options?: {
    configDir?: string;
    configPath?: string;
  }
): Promise<{ removed: CopilotAccountMeta | null }> {
  const before = await loadAccounts(options?.configDir);
  const removed = before.accounts.find((account) => account.id === accountId) ?? null;

  if (!removed) {
    return { removed: null };
  }

  await removeSecret(accountId, options?.configDir);
  await removeAccount(accountId, options?.configDir);

  const after = await loadAccounts(options?.configDir);
  await pruneOrphanSecrets(after, options?.configDir);
  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);

  return { removed };
}

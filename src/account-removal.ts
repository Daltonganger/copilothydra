/**
 * CopilotHydra — account removal helpers
 *
 * Phase 3 extends removal into a two-phase lifecycle:
 * 1. mark account as `pending-removal` and remove it from generated provider config
 * 2. finalize cleanup once in-flight work has drained
 */

import type { AccountId, CopilotAccountMeta } from "./types.js";
import { loadAccounts, removeAccount, updateAccounts } from "./storage/accounts.js";
import { pruneOrphanSecrets, removeSecret } from "./storage/secrets.js";
import { syncAccountsToOpenCodeConfig } from "./config/sync.js";
import { canAccountDrainComplete, markAccountPendingRemoval, unregisterAccount } from "./routing/provider-account-map.js";
import { resetTokenRuntimeState } from "./auth/token-state.js";
import { bestEffortKeychainDelete } from "./storage/copilot-cli-keychain.js";

interface RemovalOptions {
  configDir?: string;
  configPath?: string;
}

export async function beginAccountRemoval(
  accountId: AccountId,
  options?: RemovalOptions,
): Promise<{ account: CopilotAccountMeta | null; alreadyPending: boolean }> {
  let updated: CopilotAccountMeta | null = null;
  let alreadyPending = false;

  await updateAccounts((file) => {
    const account = file.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      return;
    }
    alreadyPending = account.lifecycleState === "pending-removal";
    account.lifecycleState = "pending-removal";
    updated = { ...account };
  }, options?.configDir);

  if (!updated) {
    return { account: null, alreadyPending: false };
  }

  try {
    markAccountPendingRemoval(accountId);
  } catch {
    // The CLI typically runs out-of-process from the plugin runtime, so the
    // in-memory routing registry may not exist here. Persisted lifecycle state
    // is still authoritative across restarts.
  }

  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);
  return { account: updated, alreadyPending };
}

export async function finalizeAccountRemoval(
  accountId: AccountId,
  options?: RemovalOptions,
): Promise<{ removed: CopilotAccountMeta | null }> {
  const before = await loadAccounts(options?.configDir);
  const removed = before.accounts.find((account) => account.id === accountId) ?? null;

  if (!removed) {
    return { removed: null };
  }

  if (removed.lifecycleState !== "pending-removal") {
    throw new Error(
      `[copilothydra] account "${accountId}" must be marked pending-removal before final cleanup`
    );
  }

  if (!canAccountDrainComplete(accountId)) {
    throw new Error(
      `[copilothydra] account "${accountId}" still has in-flight requests and cannot be removed yet`
    );
  }

  await removeSecret(accountId, options?.configDir);
  // Best-effort: remove from OS credential store
  await bestEffortKeychainDelete({
    githubUsername: removed.githubUsername,
    accountLabel: removed.label,
  });
  await removeAccount(accountId, options?.configDir);

  const after = await loadAccounts(options?.configDir);
  await pruneOrphanSecrets(after, options?.configDir);
  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);
  resetTokenRuntimeState(accountId);
  unregisterAccount(accountId);

  return { removed };
}

export async function removeAccountCompletely(
  accountId: AccountId,
  options?: RemovalOptions,
): Promise<{ removed: CopilotAccountMeta | null }> {
  const before = await loadAccounts(options?.configDir);
  const existing = before.accounts.find((account) => account.id === accountId) ?? null;

  if (!existing) {
    return { removed: null };
  }

  if (existing.lifecycleState !== "pending-removal") {
    await beginAccountRemoval(accountId, options);
  }

  return await finalizeAccountRemoval(accountId, options);
}

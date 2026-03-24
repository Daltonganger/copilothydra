/**
 * CopilotHydra — account update helpers
 *
 * Phase 2 helpers for mutating existing account metadata in a lock-wrapped way.
 */

import type { AccountId, CapabilityState, CopilotAccountMeta, PlanTier } from "./types.js";
import { loadAccounts, updateAccounts } from "./storage/accounts.js";
import { syncAccountsToOpenCodeConfig } from "./config/sync.js";

interface UpdateOptions {
  configDir?: string;
  configPath?: string;
}

export async function renameAccount(
  accountId: AccountId,
  label: string,
  options?: UpdateOptions,
): Promise<CopilotAccountMeta> {
  const nextLabel = label.trim();
  if (!nextLabel) {
    throw new Error("[copilothydra] account label cannot be empty");
  }

  const updated = await mutateAccount(accountId, (account) => {
    account.label = nextLabel;
  }, options?.configDir);
  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);
  return updated;
}

export async function updateAccountPlan(
  accountId: AccountId,
  plan: PlanTier,
  options?: UpdateOptions,
): Promise<CopilotAccountMeta> {
  const updated = await mutateAccount(accountId, (account) => {
    account.plan = plan;
    account.capabilityState = "user-declared";
    delete account.lastValidatedAt;
  }, options?.configDir);
  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);
  return updated;
}

export async function revalidateAccount(
  accountId: AccountId,
  options?: UpdateOptions & { now?: string; capabilityState?: CapabilityState },
): Promise<CopilotAccountMeta> {
  const validatedAt = options?.now ?? new Date().toISOString();
  const nextCapabilityState = options?.capabilityState ?? "user-declared";

  const updated = await mutateAccount(accountId, (account) => {
    account.lastValidatedAt = validatedAt;
    account.capabilityState = nextCapabilityState;
  }, options?.configDir);
  await syncAccountsToOpenCodeConfig(options?.configPath, options?.configDir);
  return updated;
}

async function mutateAccount(
  accountId: AccountId,
  mutator: (account: CopilotAccountMeta) => void,
  configDir?: string,
): Promise<CopilotAccountMeta> {
  let updated: CopilotAccountMeta | null = null;

  await updateAccounts((file) => {
    const account = file.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      throw new Error(`[copilothydra] account not found: ${accountId}`);
    }
    mutator(account);
    updated = { ...account };
  }, configDir);

  if (!updated) {
    const reloaded = await loadAccounts(configDir);
    const account = reloaded.accounts.find((candidate) => candidate.id === accountId);
    if (!account) {
      throw new Error(`[copilothydra] account not found after update: ${accountId}`);
    }
    return account;
  }

  return updated;
}

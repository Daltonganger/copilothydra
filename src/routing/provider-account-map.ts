/**
 * CopilotHydra — provider → account routing map
 *
 * The single source of truth for which provider ID maps to which account.
 *
 * This is an in-memory registry built at plugin startup from the accounts file.
 * Rebuilt on restart (restart-based lifecycle for Phase 1).
 *
 * Routing rules:
 * - every outgoing request derives its provider ID
 * - provider ID → account ID is resolved here
 * - if mapping is missing: fail closed (never fallback to another account)
 * - if account is "pending-removal": fail closed for new requests
 * - concurrent requests on the same account are allowed (token is immutable within session)
 */

import type { AccountId, ProviderId, CopilotAccountMeta } from "../types.js";
import { debugRouting, warn } from "../log.js";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Map from providerId → accountId */
const providerToAccount = new Map<ProviderId, AccountId>();

/** Map from accountId → account metadata (for lifecycle checks) */
const accountRegistry = new Map<AccountId, CopilotAccountMeta>();

/** Map from accountId → in-flight request count */
const inFlightByAccount = new Map<AccountId, number>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all accounts from the loaded accounts file.
 * Called once at plugin startup.
 */
export function registerAccounts(accounts: CopilotAccountMeta[]): void {
  providerToAccount.clear();
  accountRegistry.clear();
  inFlightByAccount.clear();

  for (const account of accounts) {
    providerToAccount.set(account.providerId, account.id);
    accountRegistry.set(account.id, account);
    inFlightByAccount.set(account.id, 0);

    if (account.lifecycleState === "pending-removal") {
      warn("routing", `Account "${account.id}" is pending-removal, registered for drain tracking only`);
      continue;
    }

    debugRouting(`registered: provider "${account.providerId}" → account "${account.id}"`);
  }

  debugRouting(`registered ${providerToAccount.size} provider(s)`);
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface RoutingResult {
  accountId: AccountId;
  account: CopilotAccountMeta;
}

export interface RoutingLease extends RoutingResult {
  release(): void;
}

/**
 * Resolve a provider ID to an account.
 *
 * Throws (fail-closed) if:
 * - provider ID is not registered
 * - account is pending-removal
 * - account metadata is missing (should not happen)
 */
export function resolveProvider(providerId: ProviderId): RoutingResult {
  const accountId = providerToAccount.get(providerId);
  if (!accountId) {
    throw new Error(
      `[copilothydra] No account registered for provider "${providerId}". ` +
      "This is a routing error. Refusing to fall back to another account."
    );
  }

  const account = accountRegistry.get(accountId);
  if (!account) {
    // Should not happen if registerAccounts() is called correctly
    throw new Error(
      `[copilothydra] Provider "${providerId}" maps to account "${accountId}" ` +
      "but account metadata is missing from registry. Internal error."
    );
  }

  if (account.lifecycleState === "pending-removal") {
    throw new Error(
      `[copilothydra] Account "${accountId}" (${account.label}) is pending removal. ` +
      "New requests cannot be routed to this account."
    );
  }

  debugRouting(`resolved provider "${providerId}" → account "${accountId}"`);
  return { accountId, account };
}

export function acquireRoutingLease(providerId: ProviderId): RoutingLease {
  const resolved = resolveProvider(providerId);
  const current = inFlightByAccount.get(resolved.accountId) ?? 0;
  inFlightByAccount.set(resolved.accountId, current + 1);
  debugRouting(
    `acquired routing lease for provider "${providerId}" → account "${resolved.accountId}" (in-flight: ${current + 1})`
  );

  let released = false;

  return {
    ...resolved,
    release() {
      if (released) return;
      released = true;

      const next = Math.max(0, (inFlightByAccount.get(resolved.accountId) ?? 1) - 1);
      inFlightByAccount.set(resolved.accountId, next);
      debugRouting(
        `released routing lease for provider "${providerId}" → account "${resolved.accountId}" (in-flight: ${next})`
      );
    },
  };
}

export function markAccountPendingRemoval(accountId: AccountId): void {
  const account = accountRegistry.get(accountId);
  if (!account) {
    throw new Error(`[copilothydra] Cannot mark missing account as pending-removal: ${accountId}`);
  }

  account.lifecycleState = "pending-removal";
  warn("routing", `Account "${accountId}" marked pending-removal; new routing leases will fail closed`);
}

export function unregisterAccount(accountId: AccountId): void {
  const account = accountRegistry.get(accountId);
  if (!account) return;

  providerToAccount.delete(account.providerId);
  accountRegistry.delete(accountId);
  inFlightByAccount.delete(accountId);
  debugRouting(`unregistered account "${accountId}" and provider "${account.providerId}" from routing registry`);
}

export function getInFlightCount(accountId: AccountId): number {
  return inFlightByAccount.get(accountId) ?? 0;
}

export function canAccountDrainComplete(accountId: AccountId): boolean {
  const account = accountRegistry.get(accountId);
  if (!account) return true;
  return account.lifecycleState === "pending-removal" && getInFlightCount(accountId) === 0;
}

// ---------------------------------------------------------------------------
// Inspection helpers
// ---------------------------------------------------------------------------

export function getRegisteredProviderIds(): ProviderId[] {
  return [...providerToAccount.keys()];
}

export function getRegisteredAccountCount(): number {
  return accountRegistry.size;
}

export function getRoutingSnapshot(): Array<{
  accountId: AccountId;
  providerId: ProviderId;
  lifecycleState: CopilotAccountMeta["lifecycleState"];
  inFlight: number;
}> {
  return [...accountRegistry.values()].map((account) => ({
    accountId: account.id,
    providerId: account.providerId,
    lifecycleState: account.lifecycleState,
    inFlight: getInFlightCount(account.id),
  }));
}

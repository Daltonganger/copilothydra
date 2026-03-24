/**
 * CopilotHydra — token state
 *
 * Manages the runtime token state for active accounts.
 * Provides a thread-safe (single-process, async-safe) registry of
 * account → token state, with helpers to check expiry.
 *
 * NOTE: Phase 0 scaffold. Refresh/exchange logic is deferred to Phase 1
 * after Spike B fully characterizes the Copilot token lifecycle.
 */

import type { AccountId, StoredAuthInfo } from "../types.js";
import { debugAuth } from "../log.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenState {
  accountId: AccountId;
  /** GitHub OAuth access token, used as Copilot Bearer token */
  githubOAuthToken: string;
  /**
   * Expiry as Unix timestamp (seconds). 0 = no expiry / unknown.
   * Per Spike B: GitHub device-flow tokens have expires=0 in OpenCode's storage.
   */
  expiresAt: number;
  /** When this state was last set or refreshed */
  setAt: number;
}

// ---------------------------------------------------------------------------
// In-memory token registry
// ---------------------------------------------------------------------------

/** Map from accountId → current token state */
const tokenRegistry = new Map<AccountId, TokenState>();

/**
 * Map from accountId → tail promise for serialized token lifecycle work.
 *
 * Phase 3 goal: prepare for future refresh/exchange logic without allowing
 * same-account token mutations to race each other.
 */
const tokenLifecycleTails = new Map<AccountId, Promise<void>>();

/**
 * Map from accountId → in-flight recovery/refresh promise.
 *
 * Unlike the lifecycle tail queue, this is single-flight deduplication:
 * concurrent callers for the same account share one recovery attempt.
 */
const tokenRecoveryInFlight = new Map<AccountId, Promise<TokenState>>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function setTokenState(state: TokenState): void {
  debugAuth(`setTokenState for account ${state.accountId}`);
  tokenRegistry.set(state.accountId, state);
}

export function getTokenState(accountId: AccountId): TokenState | undefined {
  return tokenRegistry.get(accountId);
}

export function clearTokenState(accountId: AccountId): void {
  debugAuth(`clearTokenState for account ${accountId}`);
  tokenRegistry.delete(accountId);
}

export function getTokenIsolationSnapshot(): Array<{
  accountId: AccountId;
  hasToken: boolean;
  expiresAt: number | undefined;
  setAt: number | undefined;
  lifecycleQueued: boolean;
  recoveryInFlight: boolean;
}> {
  const accountIds = new Set<AccountId>([
    ...tokenRegistry.keys(),
    ...tokenLifecycleTails.keys(),
    ...tokenRecoveryInFlight.keys(),
  ]);

  return [...accountIds].map((accountId) => {
    const state = tokenRegistry.get(accountId);
    return {
      accountId,
      hasToken: Boolean(state),
      expiresAt: state?.expiresAt,
      setAt: state?.setAt,
      lifecycleQueued: tokenLifecycleTails.has(accountId),
      recoveryInFlight: tokenRecoveryInFlight.has(accountId),
    };
  });
}

export function syncTokenStateFromStoredAuth(
  accountId: AccountId,
  auth: StoredAuthInfo | undefined,
): TokenState | undefined {
  if (!auth || auth.type !== "oauth") {
    clearTokenState(accountId);
    return undefined;
  }

  const next: TokenState = {
    accountId,
    githubOAuthToken: auth.refresh,
    expiresAt: auth.expires,
    setAt: Date.now(),
  };
  setTokenState(next);
  return next;
}

/**
 * Returns true if the token is expired (and has a known expiry).
 * Returns false if expires=0 (no expiry / unknown — treat as valid).
 */
export function isTokenExpired(state: TokenState): boolean {
  if (state.expiresAt === 0) return false;
  return Date.now() / 1000 > state.expiresAt;
}

export function requireActiveTokenState(accountId: AccountId): TokenState {
  const state = getTokenState(accountId);
  if (!state) {
    throw new Error(`[copilothydra] No runtime token state registered for account "${accountId}"`);
  }
  if (isTokenExpired(state)) {
    throw new Error(`[copilothydra] Runtime token state for account "${accountId}" is expired`);
  }
  return state;
}

export async function runSerializedTokenLifecycle<T>(
  accountId: AccountId,
  operation: () => Promise<T> | T,
): Promise<T> {
  const previous = tokenLifecycleTails.get(accountId) ?? Promise.resolve();

  let release!: () => void;
  const nextTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentTail = previous.then(() => nextTail);
  tokenLifecycleTails.set(accountId, currentTail);

  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (tokenLifecycleTails.get(accountId) === currentTail) {
      tokenLifecycleTails.delete(accountId);
    }
  }
}

export async function runSingleFlightTokenRecovery(
  accountId: AccountId,
  operation: () => Promise<TokenState>,
): Promise<TokenState> {
  const existing = tokenRecoveryInFlight.get(accountId);
  if (existing) {
    debugAuth(`joining in-flight token recovery for account ${accountId}`);
    return await existing;
  }

  debugAuth(`starting token recovery for account ${accountId}`);
  const recoveryPromise = (async () => await operation())();
  tokenRecoveryInFlight.set(accountId, recoveryPromise);

  try {
    return await recoveryPromise;
  } finally {
    if (tokenRecoveryInFlight.get(accountId) === recoveryPromise) {
      tokenRecoveryInFlight.delete(accountId);
    }
  }
}

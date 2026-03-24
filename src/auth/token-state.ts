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

import type { AccountId } from "../types.js";
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

/**
 * Returns true if the token is expired (and has a known expiry).
 * Returns false if expires=0 (no expiry / unknown — treat as valid).
 */
export function isTokenExpired(state: TokenState): boolean {
  if (state.expiresAt === 0) return false;
  return Date.now() / 1000 > state.expiresAt;
}

/**
 * CopilotHydra — plugin entry point
 *
 * OpenCode loads this file and iterates Object.entries(module), calling every
 * exported function as a Plugin: (input: PluginInput) => Promise<Hooks>.
 *
 * Strategy (confirmed by Spike A):
 * - `Hooks.auth` is singular — one AuthHook per Hooks object
 * - OpenCode stores hooks as Hooks[] and calls each one
 * - Therefore: one named export per registered account → one auth hook per account
 *
 * This module exports:
 * 1. Named plugin functions for each registered account (generated at module load)
 * 2. A fallback `CopilotHydraNoAccounts` export that logs a setup hint if no accounts are found
 *
 * NOTE: Phase 0 / Spike A implementation.
 * The authorize() method uses the real device flow (device-flow.ts).
 * The loader returns Authorization + Openai-Intent headers from stored token.
 */

import type { PluginInput, Hooks, CopilotAccountMeta } from "./types.js";
import { checkCompatibility } from "./auth/compatibility-check.js";
import { loadAccounts } from "./storage/accounts.js";
import { buildAuthLoader } from "./auth/loader.js";
import { requestDeviceCode, pollForAccessToken } from "./auth/device-flow.js";
import { info, warn, error, debug } from "./log.js";
import { validateAccountCount } from "./runtime-checks.js";
import { registerAccounts } from "./routing/provider-account-map.js";
import { setTokenState } from "./auth/token-state.js";
import { createCopilotLoginMethods } from "./auth/login-method.js";

// ---------------------------------------------------------------------------
// Module-level account loading (top-level await in ESM)
// ---------------------------------------------------------------------------

// We load accounts once at module import time so that each plugin function
// created below closes over the same pre-loaded data. This avoids re-reading
// the file on every OpenCode startup hook invocation.
let _accounts: CopilotAccountMeta[] = [];
let _loadError: string | undefined;

try {
  const file = await loadAccounts();
  _accounts = file.accounts.filter((a) => a.lifecycleState === "active");
  validateAccountCount(_accounts);
  registerAccounts(_accounts);
  debug("plugin", `Loaded ${_accounts.length} active account(s)`);
} catch (err_) {
  _loadError = String(err_);
  error("plugin", `Failed to load accounts at module init: ${_loadError}`);
}

// ---------------------------------------------------------------------------
// Factory: build one Plugin function for a single account
// ---------------------------------------------------------------------------

function makeAccountPlugin(account: CopilotAccountMeta): (input: PluginInput) => Promise<Hooks> {
  const fn = async function (input: PluginInput): Promise<Hooks> {
    // Compatibility check (warn-first, never crash)
    const compat = checkCompatibility(input);
    for (const w of compat.warnings) {
      warn("plugin", w);
    }

    debug("plugin", `Registering auth hook for account "${account.label}" (${account.providerId})`);

    const hooks: Hooks = {
      auth: {
        provider: account.providerId,

        // loader: called by OpenCode on each request to get auth headers
        loader: buildAuthLoader(account.id, account.providerId),

        // methods: shown in OpenCode's auth UI for this provider
        methods: [
          {
            type: "oauth",
            label: `Sign in with GitHub (${account.label})`,
            // No prompts needed — GitHub device flow is headless from plugin side;
            // the user_code + URL are conveyed via the AuthOAuthResult.instructions field
            authorize: async (_inputs) => {
              info("auth", `Starting device flow for account "${account.label}"`);
              const deviceCode = await requestDeviceCode();

              return {
                url: deviceCode.verification_uri,
                instructions:
                  `Open ${deviceCode.verification_uri} and enter code: ${deviceCode.user_code}\n` +
                  `(Code expires in ${deviceCode.expires_in}s)`,
                method: "auto" as const,
                callback: async () => {
                  try {
                    const result = await pollForAccessToken(
                      deviceCode.device_code,
                      deviceCode.interval,
                      deviceCode.expires_in
                    );
                    setTokenState({
                      accountId: account.id,
                      githubOAuthToken: result.accessToken,
                      expiresAt: 0,
                      setAt: Date.now(),
                    });
                    return {
                      type: "success" as const,
                      provider: account.providerId, // lets OpenCode re-route if needed
                      refresh: result.accessToken,
                      access: result.accessToken,
                      expires: 0, // GitHub OAuth tokens don't expire (no explicit expiry)
                      accountId: account.id,
                    };
                  } catch (err_) {
                    error("auth", `Device flow failed for "${account.label}": ${String(err_)}`);
                    return { type: "failed" as const };
                  }
                },
              };
            },
          },
        ],
      },
    };

    return hooks;
  };

  // Name the function so OpenCode's log output is readable
  Object.defineProperty(fn, "name", {
    value: `CopilotHydra_${account.id}`,
    writable: false,
  });

  return fn;
}

// ---------------------------------------------------------------------------
// Setup/login plugin
//
// This export is always present so OpenCode can surface CopilotHydra-specific
// login methods under the shared `github-copilot` login entrypoint. Runtime
// request routing still happens through the account-specific slot exports.
// ---------------------------------------------------------------------------

export async function CopilotHydraSetup(input: PluginInput): Promise<Hooks> {
  const compat = checkCompatibility(input);
  for (const w of compat.warnings) {
    warn("plugin", w);
  }

  if (_loadError) {
    error("plugin", `CopilotHydra could not load accounts: ${_loadError}`);
  } else {
    debug(
      "plugin",
      _accounts.length === 0
        ? "CopilotHydra: no accounts configured. OpenCode auth login can now create the first account."
        : "CopilotHydra: exposing GitHub Copilot login method for add-account / re-auth flows.",
    );
      }

  return {
    auth: {
      provider: "github-copilot",
      methods: createCopilotLoginMethods(_accounts),
    },
  };
}

// ---------------------------------------------------------------------------
// Dynamic named exports — one per active account
//
// OpenCode iterates Object.entries(module) and calls every exported function.
// We build one plugin function per account and export them all.
// The setup/login export is always present; account-specific runtime hooks are
// still provided separately through the active-account exports below.
// ---------------------------------------------------------------------------

// Build per-account plugin functions
const _accountPlugins: Record<string, (input: PluginInput) => Promise<Hooks>> = {};

for (const account of _accounts) {
  // Export key: safe identifier derived from account ID
  const exportKey = `CopilotHydra_${account.id}`;
  _accountPlugins[exportKey] = makeAccountPlugin(account);
}

// Re-export everything. The setup helper remains active for auth-login flows,
// while the account exports continue to serve runtime requests.
if (_accounts.length === 0) {
  // Already defined above — re-export as named
  // (CopilotHydraSetup is already exported as a named export above)
} else {
  // CopilotHydraSetup remains exported intentionally so OpenCode can offer the
  // add-account / re-auth methods even when account-specific runtime hooks
  // already exist.
}

// Export all account plugins as named exports
// TypeScript doesn't support dynamic named exports directly, so we use
// Object.defineProperty on the module exports object pattern.
// In ESM/CommonJS interop via tsconfig "module: NodeNext", the exports object
// is not directly accessible. We export a helper that OpenCode can use if
// running via a wrapper, but the primary mechanism is the static exports below.
//
// LIMITATION: Dynamic named exports are not possible in static ESM.
// For N accounts, the user must either:
//   a) Have the plugin generate account-specific sub-modules (Phase 2 approach), OR
//   b) The plugin loader exports a known set of named functions
//
// For Phase 0/Spike A, we export up to 8 account slots statically.
// Each slot checks the _accounts array at call time.

function makeSlotPlugin(slot: number): (input: PluginInput) => Promise<Hooks> {
  const fn = async function (input: PluginInput): Promise<Hooks> {
    const account = _accounts[slot];
    if (!account) return {}; // slot empty
    return makeAccountPlugin(account)(input);
  };
  Object.defineProperty(fn, "name", { value: `CopilotHydraSlot${slot}`, writable: false });
  return fn;
}

// 8 static slots — supports up to 8 simultaneous Copilot accounts.
// Each resolves dynamically from _accounts at call time.
export const CopilotHydraSlot0 = makeSlotPlugin(0);
export const CopilotHydraSlot1 = makeSlotPlugin(1);
export const CopilotHydraSlot2 = makeSlotPlugin(2);
export const CopilotHydraSlot3 = makeSlotPlugin(3);
export const CopilotHydraSlot4 = makeSlotPlugin(4);
export const CopilotHydraSlot5 = makeSlotPlugin(5);
export const CopilotHydraSlot6 = makeSlotPlugin(6);
export const CopilotHydraSlot7 = makeSlotPlugin(7);

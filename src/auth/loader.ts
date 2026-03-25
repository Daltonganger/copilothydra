/**
 * CopilotHydra — auth loader
 *
 * Produces the `AuthLoader` object that OpenCode calls per provider to get
 * the fetch wrapper / base URL / headers for Copilot API requests.
 *
 * One loader instance is registered per account (per provider ID).
 *
 * Architecture confirmed by Spike B:
 * - The loader returns a custom `fetch` function (NOT a headers object).
 *   OpenCode's CopilotAuthPlugin uses the same pattern.
 * - The GitHub OAuth token (device-flow) is used DIRECTLY as Bearer token.
 *   No additional Copilot token exchange is required.
 * - Headers injected per-request:
 *   - Authorization: Bearer <githubOAuthToken>
 *   - Openai-Intent: conversation-edits
 *   - User-Agent: opencode/<version>  — set by OpenCode's own headers; we leave it
 * - OpenCode's chat.headers hook handles x-initiator and Copilot-Vision-Request
 *   based on providerID.includes("github-copilot"), so our IDs (github-copilot-acct-*)
 *   will trigger those correctly without any action from our side.
 */

import type { AccountId, AuthLoader, ProviderId, StoredAuthInfo } from "../types.js";
import { debugAuth } from "../log.js";
import { acquireRoutingLease } from "../routing/provider-account-map.js";
import { handlePlanMismatch, isCapabilityMismatchError } from "../config/capabilities.js";
import {
  isTokenExpired,
  requireActiveTokenState,
  runSerializedTokenLifecycle,
  runSingleFlightTokenRecovery,
  syncTokenStateFromStoredAuth,
} from "./token-state.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Base URL for the standard GitHub Copilot API */
export const COPILOT_BASE_URL = "https://api.githubcopilot.com";

/** OpenCode's GitHub OAuth client ID for the device flow */
export const GITHUB_CLIENT_ID = "Ov23li8tweQw6odWQebz";

// ---------------------------------------------------------------------------
// Loader factory
// ---------------------------------------------------------------------------

/** Return type of the auth loader function registered on each AuthHook */
type LoaderFn = (
  getAuth: () => Promise<StoredAuthInfo | undefined>,
  provider: { id: ProviderId }
) => Promise<AuthLoader>;

/**
 * Build the `auth.loader` function for a specific account's provider hook.
 *
 * The returned function is called by OpenCode each time it needs to resolve
 * auth material for this provider. It receives `getAuth()` which returns
 * the stored oauth token for the provider.
 *
 * Following the same pattern as OpenCode's `CopilotAuthPlugin`:
 * - Returns a custom `fetch` function that adds auth headers per-request
 * - The fetch re-calls getAuth() on each request for freshness
 *
 * @param accountId  - The stable internal account ID (used for logging only)
 * @param providerId - The OpenCode provider ID this loader is registered for
 */
export function buildAuthLoader(
  accountId: AccountId,
  providerId: ProviderId
): LoaderFn {
  return async (getAuth, provider) => {
    debugAuth(`loader called for provider "${provider.id}" (account ${accountId})`);

    // Defensive: confirm OpenCode gave us the provider we expected
    if (provider.id !== providerId) {
      throw new Error(
        `[copilothydra] Auth loader for account "${accountId}" received unexpected provider ID ` +
          `"${provider.id}" (expected "${providerId}"). Refusing to proceed.`
      );
    }

    const stored = await getAuth();
    if (!stored || stored.type !== "oauth") {
      // No token stored yet — return empty loader so OpenCode can prompt login
      debugAuth(`no stored oauth token for provider "${provider.id}", returning empty loader`);
      syncTokenStateFromStoredAuth(accountId, stored);
      return {};
    }

    syncTokenStateFromStoredAuth(accountId, stored);

    // Determine base URL — supports GitHub Enterprise (Spike B confirmed this pattern)
    const baseURL = stored.enterpriseUrl
      ? `https://copilot-api.${stored.enterpriseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
      : COPILOT_BASE_URL;

    debugAuth(`resolved token for provider "${provider.id}" (expires: ${stored.expires})`);

    const loader: AuthLoader = {
      baseURL,
      apiKey: "",
      // Custom fetch: re-reads auth on every request (matches CopilotAuthPlugin pattern)
      fetch: async (request, init) => {
        const requestedModelId = await extractRequestedModelId(request, init);
        const lease = acquireRoutingLease(providerId);
        try {
          if (lease.accountId !== accountId) {
            throw new Error(
              `[copilothydra] Routing ownership mismatch for provider "${providerId}": ` +
                `loader expected account "${accountId}" but registry resolved "${lease.accountId}"`
            );
          }

          const runtimeToken = await runSerializedTokenLifecycle(lease.accountId, async () => {
            const info = await getAuth();
            const synced = syncTokenStateFromStoredAuth(lease.accountId, info);
            if (synced && !isTokenExpired(synced)) {
              return synced;
            }

            return await runSingleFlightTokenRecovery(lease.accountId, async () => {
              const refreshed = await getAuth();
              const recovered = syncTokenStateFromStoredAuth(lease.accountId, refreshed);
              if (!recovered) {
                // Intentional Phase 3 fail-closed behavior: once routing is provider→account
                // isolated, a revoked/missing routed token must NOT fall through as an
                // unauthenticated request. Forwarding without auth could mask routing bugs,
                // blur token/account ownership, or let the host retry in a less explicit way.
                // We throw here so the routed account failure is visible and the lease still
                // releases in `finally`.
                throw new Error(
                  `[copilothydra] No oauth token available for routed account "${lease.accountId}" (${providerId})`
                );
              }

              return requireActiveTokenState(lease.accountId);
            });
          });

          const headers: Record<string, string> = {
            ...(init?.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${runtimeToken.githubOAuthToken}`,
            "Openai-Intent": "conversation-edits",
          };

          const response = await globalThis.fetch(request, { ...init, headers });

          const mismatchText = response.status === 403
            ? await extractCapabilityMismatchText(response)
            : "";
          if (mismatchText && isCapabilityMismatchError({ message: mismatchText })) {
            const mismatch = await handlePlanMismatch(lease.accountId, requestedModelId);
            throw new Error(
              mismatch?.message ??
                `[copilothydra] Capability mismatch detected for routed account "${lease.accountId}".`
            );
          }

          return response;
        } finally {
          lease.release();
        }
      },
    };

    return loader;
  };
}

async function extractCapabilityMismatchText(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const canReadBody =
    contentType.length === 0 ||
    contentType.includes("application/json") ||
    contentType.startsWith("text/");
  if (!canReadBody) {
    return "";
  }

  try {
    const clone = response.clone();
    const text = await clone.text();
    return text;
  } catch {
    return "";
  }
}

async function extractRequestedModelId(
  request: Parameters<typeof globalThis.fetch>[0],
  init?: RequestInit,
): Promise<string | undefined> {
  const initBody = init?.body;
  if (typeof initBody === "string") {
    return extractModelIdFromText(initBody);
  }

  if (request instanceof Request) {
    try {
      const clone = request.clone();
      return extractModelIdFromText(await clone.text());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function extractModelIdFromText(body: string): string | undefined {
  if (!body) return undefined;

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const model = parsed["model"];
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

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
      return {};
    }

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
        const info = await getAuth();
        if (!info || info.type !== "oauth") {
          // Token was revoked between loader init and this request — fall through without auth
          debugAuth(`token revoked mid-flight for "${providerId}", forwarding unauthenticated`);
          return globalThis.fetch(request, init);
        }

        const headers: Record<string, string> = {
          // Spread any existing headers first so we can override
          ...(init?.headers as Record<string, string> | undefined),
          // GitHub OAuth token used directly as Bearer (confirmed Spike B)
          Authorization: `Bearer ${info.refresh}`,
          "Openai-Intent": "conversation-edits",
          // NOTE: x-initiator and Copilot-Vision-Request are added by OpenCode's
          // chat.headers hook which fires on providerID.includes("github-copilot").
          // Our provider IDs are "github-copilot-acct-*" so they will match.
        };

        return globalThis.fetch(request, { ...init, headers });
      },
    };

    return loader;
  };
}

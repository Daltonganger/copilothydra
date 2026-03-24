/**
 * CopilotHydra — provider registration helpers
 *
 * Builds the per-account provider configuration entries that are
 * written into the user's opencode.json config.
 *
 * Key architectural findings (Spike C):
 *
 * 1. SDK RESOLUTION:
 *    OpenCode resolves the SDK factory via `model.api.npm` (NOT provider ID).
 *    Our provider IDs ("github-copilot-acct-<id>") are NOT in BUNDLED_PROVIDERS
 *    or CUSTOM_LOADERS, so we must set `npm` in the config entry.
 *    We use "@ai-sdk/openai-compatible" which is what models.dev uses for
 *    github-copilot itself, and which is already bundled in OpenCode.
 *
 * 2. CONFIG HOOK IS READ-ONLY:
 *    The `Hooks.config` hook receives Config as input and returns `void`.
 *    Plugins CANNOT add providers via the config hook.
 *    Providers must be written directly to opencode.json before OpenCode starts.
 *    CopilotHydra's CLI setup command writes these entries.
 *
 * 3. CUSTOM_LOADERS GAP:
 *    The `CUSTOM_LOADERS["github-copilot"]` in OpenCode handles model routing:
 *    - shouldUseCopilotResponsesApi(modelId) → uses sdk.responses(modelId)
 *    - other models → uses sdk.chat(modelId) or sdk.languageModel(modelId)
 *    Our provider IDs do NOT trigger this custom loader (it's keyed by exact ID).
 *    Mitigation: "@ai-sdk/openai-compatible" uses standard .chat() for all models,
 *    which should work for current Copilot models. GPT-5+ (responses API) will
 *    need a workaround if/when they become relevant.
 *
 * 4. CHAT.HEADERS HOOK:
 *    OpenCode's chat.headers hook checks providerID.includes("github-copilot").
 *    Our IDs ("github-copilot-acct-*") contain "github-copilot" → ✓ matches.
 *    This means x-initiator and Copilot-Vision-Request headers are injected
 *    automatically by OpenCode without any action on our part.
 *
 * 5. MODEL MODELS:
 *    Models are sourced from models.dev + config overrides.
 *    We write explicit model entries per account to ensure they appear in OpenCode's UI.
 */

import type { AccountId, ProviderId, CopilotAccountMeta } from "../types.js";
import { modelsForPlan } from "./models.js";

// ---------------------------------------------------------------------------
// ID helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable OpenCode provider ID from an internal account ID.
 *
 * Format: "github-copilot-acct-<accountId>"
 * Contains "github-copilot" for OpenCode's providerID.includes() checks.
 */
export function buildProviderId(accountId: AccountId): ProviderId {
  return `github-copilot-acct-${accountId}`;
}

/**
 * Extract the account ID from a provider ID.
 * Returns null if the ID is not a CopilotHydra provider ID.
 */
export function accountIdFromProviderId(providerId: ProviderId): AccountId | null {
  const prefix = "github-copilot-acct-";
  if (!providerId.startsWith(prefix)) return null;
  return providerId.slice(prefix.length);
}

/**
 * Returns true if the given provider ID is a CopilotHydra-managed provider.
 */
export function isCopilotHydraProvider(providerId: string): boolean {
  return providerId.startsWith("github-copilot-acct-");
}

// ---------------------------------------------------------------------------
// Provider config shape (mirrors OpenCode's config.ts Provider schema)
// ---------------------------------------------------------------------------

/**
 * Per-model npm/api override — mirrors ModelsDev.Model.provider shape.
 */
export interface ModelProviderOverride {
  /** npm package for SDK factory (overrides provider-level npm) */
  npm?: string;
  /** API base URL for this model */
  api?: string;
}

/**
 * Single model entry in the opencode.json provider.models record.
 * Mirrors ModelsDev.Model.partial() shape.
 */
export interface ModelConfigEntry {
  name?: string;
  /** Per-model SDK/API override */
  provider?: ModelProviderOverride;
}

/**
 * Provider entry written to opencode.json `provider` record.
 *
 * Mirrors OpenCode's config.ts Provider schema (ModelsDev.Provider.partial() + extensions).
 * Key fields:
 *   - npm: npm package for SDK factory (resolved from models.dev if absent)
 *   - api: base URL override
 *   - env: env vars required (display only for external providers, not enforced for oauth)
 *   - models: record of modelID → ModelConfigEntry
 *   - options: passed to SDK factory (apiKey, baseURL, etc.)
 */
export interface ProviderConfigEntry {
  name: string;
  /** npm package name used to look up the SDK factory (via BUNDLED_PROVIDERS) */
  npm?: string;
  /** API base URL for all models under this provider */
  api?: string;
  /** Env vars expected by this provider (informational for our oauth providers) */
  env?: string[];
  /** Model entries keyed by modelID */
  models?: Record<string, ModelConfigEntry>;
  /** Options passed to SDK factory (baseURL, apiKey, etc.) */
  options?: {
    apiKey?: string;
    baseURL?: string;
    enterpriseUrl?: string;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Provider config builder
// ---------------------------------------------------------------------------

/**
 * Build the provider config entry for a single Copilot account.
 *
 * This entry is written into opencode.json under `provider.<providerId>`.
 * It uses "@ai-sdk/openai-compatible" as the SDK package (bundled in OpenCode)
 * with the standard Copilot API base URL.
 *
 * Note: auth (Bearer token) is NOT set here — it is injected per-request
 * by the auth hook loader in src/auth/loader.ts.
 */
export function buildProviderConfig(account: CopilotAccountMeta): ProviderConfigEntry {
  return {
    name: `GitHub Copilot — ${account.label} (${account.githubUsername})`,
    // "@ai-sdk/openai-compatible" is bundled in OpenCode and works for all
    // current Copilot models via the standard chat() endpoint.
    // Note: CUSTOM_LOADERS["github-copilot"] (responses vs chat routing) does
    // NOT apply here since our provider ID differs. This is a known gap — see
    // module doc comment point 3. Standard chat() works for current model set.
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.githubcopilot.com",
    env: [], // OAuth — no env var required; auth is handled by our loader hook
    options: {
      // apiKey is intentionally left empty; our loader injects Authorization header
      apiKey: "",
    },
    models: buildModelEntries(account),
  };
}

// ---------------------------------------------------------------------------
// Model entries
// ---------------------------------------------------------------------------

/**
 * Build the models record for an account based on its declared plan tier.
 *
 * NOTE: Stub for Phase 0 — returns empty object.
 * Phase 4 will populate based on account.plan and account.capabilityState.
 */
function buildModelEntries(_account: CopilotAccountMeta): Record<string, ModelConfigEntry> {
  const modelIds = modelsForPlan(_account.plan);
  return Object.fromEntries(
    modelIds.map((modelId) => [
      modelId,
      {
        name: buildModelDisplayName(_account, modelId),
      } satisfies ModelConfigEntry,
    ])
  );
}

export function buildModelDisplayName(account: CopilotAccountMeta, modelId: string): string {
  return `${modelId} (${account.label})`;
}

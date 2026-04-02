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
 *    We use a Hydra-local `file://` provider factory module so account-scoped
 *    provider IDs can still mirror built-in Copilot routing.
 *
 * 2. CONFIG HOOK IS READ-ONLY:
 *    The `Hooks.config` hook receives Config as input and returns `void`.
 *    Plugins CANNOT add providers via the config hook.
 *    Providers must be written directly to opencode.json before OpenCode starts.
 *    CopilotHydra's CLI setup command writes these entries.
 *
 * 3. CUSTOM_LOADERS GAP:
 *    OpenCode special-cases exact provider ID `github-copilot` to route GPT-5+
 *    models through responses and other models through chat.
 *    Our provider IDs do NOT trigger that exact-ID loader, so CopilotHydra points
 *    provider `npm` at a local module whose `languageModel()` mirrors the same split.
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
import { getCopilotCatalogModel, modelsForPlan } from "./models.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * Provider ID used by CopilotHydraSetup for login / add-account / re-auth.
 * Distinct from built-in "github-copilot" so that disabling the built-in
 * provider (to hide its models) does NOT also hide the Hydra auth entrypoint.
 */
export const COPILOT_HYDRA_SETUP_PROVIDER_ID = "github-copilot-hydra" as const;

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

function resolveHydraCopilotProviderModuleHref(): string {
  return new URL("../sdk/hydra-copilot-provider.js", import.meta.url).href;
}

// ---------------------------------------------------------------------------
// Provider config builder
// ---------------------------------------------------------------------------

/**
 * Build the provider config entry for a single Copilot account.
 *
 * This entry is written into opencode.json under `provider.<providerId>`.
 * It uses a Hydra-local provider factory with the standard Copilot API base URL.
 *
 * Note: auth (Bearer token) is NOT set here — it is injected per-request
 * by the auth hook loader in src/auth/loader.ts.
 */
export function buildProviderConfig(account: CopilotAccountMeta): ProviderConfigEntry {
  return {
    name: account.label,
    // Use a local Hydra provider factory so `github-copilot-acct-*` keeps
    // multi-account isolation while matching built-in Copilot routing parity.
    npm: resolveHydraCopilotProviderModuleHref(),
    api: "https://api.githubcopilot.com",
    env: [], // OAuth — no env var required; auth is handled by our loader hook
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
  const includeUnverified =
    _account.capabilityState === "user-declared" && _account.allowUnverifiedModels === true;
  const modelIds = modelsForPlan(_account.plan, { includeUnverified });

  return Object.fromEntries(
    modelIds.map((modelId) => [
      modelId,
      {
        name: buildModelDisplayName(_account, modelId),
      } satisfies ModelConfigEntry,
    ])
  );
}

export function buildModelDisplayName(_account: CopilotAccountMeta, modelId: string): string {
  const catalogName = getCopilotCatalogModel(modelId)?.name;
  return catalogName ?? modelId;
}

/**
 * CopilotHydra — model tier tables
 *
 * Maps plan tiers to available Copilot model IDs.
 *
 * IMPORTANT: This table is still not authoritative runtime entitlement truth.
 * It is a maintained compatibility table based on GitHub's published
 * "Supported AI models per Copilot plan" documentation.
 * It MUST remain replaceable by verified capability discovery / mismatch
 * handling because GitHub may change model availability over time.
 *
 * Policy:
 * - document table as user-declared baseline only
 * - expose the documented plan baseline
 * - keep mismatch handling for runtime entitlement failures
 * - reserve explicit override support for future gray-area models if docs/API
 *   drift again
 *
 * References:
 * - Spike D: capability truth research
 * - docs/compatibility-matrix.md
 */

import type { PlanTier } from "../types.js";

export interface CopilotCatalogModelEntry {
  id: string;
  name: string;
}

export const COPILOT_MODEL_CATALOG: Record<string, CopilotCatalogModelEntry> = {
  "claude-haiku-4.5": { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
  "claude-opus-4.5": { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
  "claude-opus-4.6": { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
  "claude-opus-4.6-fast": { id: "claude-opus-4.6-fast", name: "Claude Opus 4.6 Fast" },
  "claude-opus-41": { id: "claude-opus-41", name: "Claude Opus 4.1" },
  "claude-sonnet-4": { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  "claude-sonnet-4.5": { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
  "claude-sonnet-4.6": { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
  "gemini-2.5-pro": { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  "gemini-3-flash-preview": { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
  "gemini-3-pro-preview": { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
  "gemini-3.1-pro-preview": { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
  "gpt-4.1": { id: "gpt-4.1", name: "GPT-4.1" },
  "gpt-4o": { id: "gpt-4o", name: "GPT-4o" },
  "gpt-5": { id: "gpt-5", name: "GPT-5" },
  "gpt-5-mini": { id: "gpt-5-mini", name: "GPT-5-mini" },
  "gpt-5.1": { id: "gpt-5.1", name: "GPT-5.1" },
  "gpt-5.1-codex": { id: "gpt-5.1-codex", name: "GPT-5.1-Codex" },
  "gpt-5.1-codex-max": { id: "gpt-5.1-codex-max", name: "GPT-5.1-Codex-max" },
  "gpt-5.1-codex-mini": { id: "gpt-5.1-codex-mini", name: "GPT-5.1-Codex-mini" },
  "gpt-5.2": { id: "gpt-5.2", name: "GPT-5.2" },
  "gpt-5.2-codex": { id: "gpt-5.2-codex", name: "GPT-5.2-Codex" },
  "gpt-5.3-codex": { id: "gpt-5.3-codex", name: "GPT-5.3-Codex" },
  "gpt-5.4": { id: "gpt-5.4", name: "GPT-5.4" },
  "gpt-5.4-mini": { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
  goldeneye: { id: "goldeneye", name: "Goldeneye" },
  "grok-code-fast-1": { id: "grok-code-fast-1", name: "Grok Code Fast 1" },
  "raptor-mini": { id: "raptor-mini", name: "Raptor Mini" },
};

export const PLAN_TIER_ORDER: PlanTier[] = ["free", "student", "pro", "pro+"];

export interface PlanModelEntry {
  id: string;
  requiresExplicitOverride?: boolean;
}

// ---------------------------------------------------------------------------
// Model tier table
// ---------------------------------------------------------------------------

/**
 * Copilot model IDs known to be available on each plan tier.
 *
 * These model IDs are what OpenCode expects to pass to the SDK.
 * They are based on GitHub Docs and may drift.
 *
 * Spike D conclusion:
 * - GitHub's plan matrix is a stronger baseline than generic catalog presence.
 * - But published plan support still does not prove a specific account can use a
 *   model at runtime.
 * - Therefore this table remains a user-declared compatibility map, not verified
 *   truth.
 *
 * TODO (Phase 4): augment with runtime validation and mismatch feedback.
 */
export const MODEL_TIER_TABLE: Record<PlanTier, PlanModelEntry[]> = {
  free: [
    { id: "claude-haiku-4.5" },
    { id: "goldeneye" },
    { id: "gpt-4.1" },
    { id: "gpt-5-mini" },
    { id: "grok-code-fast-1" },
    { id: "raptor-mini" },
  ],
  student: [
    { id: "claude-haiku-4.5" },
    { id: "gemini-2.5-pro" },
    { id: "gemini-3-flash-preview" },
    { id: "gemini-3-pro-preview" },
    { id: "gemini-3.1-pro-preview" },
    { id: "gpt-4.1" },
    { id: "gpt-5-mini" },
    { id: "gpt-5.1" },
    { id: "gpt-5.1-codex" },
    { id: "gpt-5.1-codex-mini" },
    { id: "gpt-5.1-codex-max" },
    { id: "gpt-5.2" },
    { id: "gpt-5.2-codex" },
    { id: "gpt-5.3-codex" },
    { id: "grok-code-fast-1" },
    { id: "raptor-mini" },
  ],
  pro: [
    { id: "claude-haiku-4.5" },
    { id: "claude-opus-4.5" },
    { id: "claude-opus-4.6" },
    { id: "claude-sonnet-4" },
    { id: "claude-sonnet-4.5" },
    { id: "claude-sonnet-4.6" },
    { id: "gemini-2.5-pro" },
    { id: "gemini-3-flash-preview" },
    { id: "gemini-3-pro-preview" },
    { id: "gemini-3.1-pro-preview" },
    { id: "gpt-4.1" },
    { id: "gpt-5-mini" },
    { id: "gpt-5.1" },
    { id: "gpt-5.1-codex" },
    { id: "gpt-5.1-codex-mini" },
    { id: "gpt-5.1-codex-max" },
    { id: "gpt-5.2" },
    { id: "gpt-5.2-codex" },
    { id: "gpt-5.3-codex" },
    { id: "gpt-5.4" },
    { id: "gpt-5.4-mini" },
    { id: "grok-code-fast-1" },
    { id: "raptor-mini" },
  ],
  "pro+": [
    { id: "claude-haiku-4.5" },
    { id: "claude-opus-4.5" },
    { id: "claude-opus-4.6" },
    { id: "claude-opus-4.6-fast" },
    { id: "claude-sonnet-4" },
    { id: "claude-sonnet-4.5" },
    { id: "claude-sonnet-4.6" },
    { id: "gemini-2.5-pro" },
    { id: "gemini-3-flash-preview" },
    { id: "gemini-3-pro-preview" },
    { id: "gemini-3.1-pro-preview" },
    { id: "gpt-4.1" },
    { id: "gpt-5-mini" },
    { id: "gpt-5.1" },
    { id: "gpt-5.1-codex" },
    { id: "gpt-5.1-codex-mini" },
    { id: "gpt-5.1-codex-max" },
    { id: "gpt-5.2" },
    { id: "gpt-5.2-codex" },
    { id: "gpt-5.3-codex" },
    { id: "gpt-5.4" },
    { id: "gpt-5.4-mini" },
    { id: "grok-code-fast-1" },
    { id: "raptor-mini" },
  ],
};

/**
 * Returns the model IDs available for a given plan tier.
 *
 * Important: the caller is responsible for checking account.capabilityState.
 * Today the documented plan baseline is exposed directly. If future model rows
 * become uncertain again, callers can still use includeUnverified=false together
 * with requiresExplicitOverride entries.
 *
 * This function intentionally does NOT attempt runtime entitlement detection.
 */
export function modelsForPlan(
  plan: PlanTier,
  options?: { includeUnverified?: boolean }
): string[] {
  const includeUnverified = options?.includeUnverified ?? true;
  return (MODEL_TIER_TABLE[plan] ?? [])
    .filter((entry) => includeUnverified || !entry.requiresExplicitOverride)
    .filter((entry) => isKnownCopilotModelId(entry.id))
    .map((entry) => entry.id);
}

export function getOverrideRequiredModelsForPlan(plan: PlanTier): string[] {
  return (MODEL_TIER_TABLE[plan] ?? [])
    .filter((entry) => entry.requiresExplicitOverride)
    .map((entry) => entry.id);
}

export function modelRequiresExplicitOverride(plan: PlanTier, modelId: string): boolean {
  return (MODEL_TIER_TABLE[plan] ?? []).some(
    (entry) => entry.id === modelId && entry.requiresExplicitOverride,
  );
}

export function suggestDowngradePlanForModel(currentPlan: PlanTier, modelId: string): PlanTier | undefined {
  const currentIndex = PLAN_TIER_ORDER.indexOf(currentPlan);
  if (currentIndex <= 0) return undefined;

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = PLAN_TIER_ORDER[index];
    if (!candidate) {
      continue;
    }
    if (!modelsForPlan(candidate, { includeUnverified: true }).includes(modelId)) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Returns true if a model should use the Copilot Responses API instead of chat.
 *
 * Mirrors the `shouldUseCopilotResponsesApi` logic from OpenCode's provider.ts:
 * GPT-5+ models use responses API, except gpt-5-mini.
 */
export function shouldUseCopilotResponsesApi(modelId: string): boolean {
  if (modelId.startsWith("gpt-5") && modelId !== "gpt-5-mini") return true;
  return false;
}

export function getCopilotCatalogModel(modelId: string): CopilotCatalogModelEntry | undefined {
  return COPILOT_MODEL_CATALOG[modelId];
}

export function isKnownCopilotModelId(modelId: string): boolean {
  return Object.hasOwn(COPILOT_MODEL_CATALOG, modelId);
}

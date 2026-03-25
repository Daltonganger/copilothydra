/**
 * CopilotHydra — model tier tables
 *
 * Maps plan tiers to available Copilot model IDs.
 *
 * IMPORTANT: This table is NOT authoritative truth about model availability.
 * It is a maintained compatibility table based on known Copilot plan behavior.
 * It MUST be replaceable by verified capability discovery (Phase 4).
 *
 * Policy:
 * - document table as user-declared baseline only
 * - expose only models for which account has explicit plan evidence
 * - require explicit user override for uncertain/unverified models
 *
 * References:
 * - Spike D: capability truth research
 * - docs/compatibility-matrix.md
 */

import type { PlanTier } from "../types.js";

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
 * They are based on observed Copilot behavior and may drift.
 *
 * Spike D conclusion:
 * - GitHub's public model catalog is NOT proof that a given account may use a model.
 * - Catalog presence != account entitlement.
 * - Therefore this table remains a user-declared compatibility map, not verified truth.
 *
 * TODO (Phase 4): augment with runtime validation and mismatch feedback.
 */
export const MODEL_TIER_TABLE: Record<PlanTier, PlanModelEntry[]> = {
  free: [
    { id: "gpt-4o-mini" },
    { id: "claude-3.5-haiku" },
    { id: "o3-mini" },
  ],
  student: [
    { id: "gpt-4o-mini" },
    { id: "gpt-4o", requiresExplicitOverride: true },
    { id: "claude-3.5-haiku" },
    { id: "claude-3.5-sonnet", requiresExplicitOverride: true },
    { id: "o3-mini" },
  ],
  pro: [
    { id: "gpt-4o-mini" },
    { id: "gpt-4o" },
    { id: "claude-3.5-haiku" },
    { id: "claude-3.5-sonnet" },
    { id: "claude-3.7-sonnet", requiresExplicitOverride: true },
    { id: "o1", requiresExplicitOverride: true },
    { id: "o1-mini", requiresExplicitOverride: true },
    { id: "o3-mini" },
  ],
  "pro+": [
    { id: "gpt-4o-mini" },
    { id: "gpt-4o" },
    { id: "claude-3.5-haiku" },
    { id: "claude-3.5-sonnet" },
    { id: "claude-3.7-sonnet", requiresExplicitOverride: true },
    { id: "o1", requiresExplicitOverride: true },
    { id: "o1-mini", requiresExplicitOverride: true },
    { id: "o3-mini" },
    // Pro+ may include additional premium models
  ],
};

/**
 * Returns the model IDs available for a given plan tier.
 *
 * Important: the caller is responsible for checking account.capabilityState.
 * If capabilityState is "user-declared", callers must require explicit
 * user acknowledgement before exposing uncertain models.
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

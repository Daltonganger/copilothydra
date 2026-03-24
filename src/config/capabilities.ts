/**
 * CopilotHydra — capability verification (stub)
 *
 * Phase 0 scaffold for per-account capability discovery.
 *
 * Spike D conclusion:
 * - There is NO reliable official API to detect an individual user's Copilot
 *   plan tier / model entitlements directly.
 * - GitHub Models catalog data shows model existence, NOT per-account access.
 * - Some SDKs may expose runtime `listModels()`-style helpers, but those are
 *   not sufficient as a stable entitlement proof for this plugin architecture.
 *
 * v1 policy: manual plan declaration with explicit user override.
 * Automatic capability verification is deferred to Phase 4 and should be
 * treated as best-effort runtime validation, not ground truth discovery.
 *
 * See PLAN.md Phase 4 and docs/feasibility-notes.md (Spike D results).
 */

import type { CopilotAccountMeta, CapabilityState, PlanTier } from "../types.js";
import { warn } from "../log.js";

// ---------------------------------------------------------------------------
// Mismatch detection (stub)
// ---------------------------------------------------------------------------

/**
 * Called when a model request is rejected in a way that suggests plan mismatch.
 *
 * Policy:
 * 1. Mark account as "mismatch" capabilityState
 * 2. Surface clear error to user
 * 3. Ask whether to overwrite stored plan with more restrictive one
 *
 * Runtime signals worth treating as mismatch candidates (Spike D):
 * - HTTP 403 with messages like:
 *   - "not authorized to use this Copilot feature"
 *   - "Model not enabled for your account / org / plan"
 *   - "Access denied by organization policy"
 *   - "You don't have access to GitHub Copilot"
 *
 * Important: 401 usually means auth/token failure, not plan mismatch.
 *
 * TODO (Phase 4): implement full mismatch detection and overwrite prompt.
 */
export function handlePlanMismatch(
  account: CopilotAccountMeta,
  _rejectedModelId: string
): void {
  warn(
    "capabilities",
    `Plan mismatch detected for account "${account.id}" (${account.label}). ` +
    `Declared plan is "${account.plan}" but model was rejected. ` +
    `Account state should be marked as "mismatch". This is a Phase 4 TODO.`
  );
}

// ---------------------------------------------------------------------------
// Capability state helpers
// ---------------------------------------------------------------------------

/**
 * Returns a user-facing label for a capability state.
 */
export function capabilityStateLabel(state: CapabilityState): string {
  switch (state) {
    case "user-declared": return "user-declared";
    case "verified":      return "verified";
    case "mismatch":      return "⚠ mismatch";
  }
}

/**
 * Returns a user-facing label for a plan tier.
 */
export function planLabel(plan: PlanTier): string {
  switch (plan) {
    case "free":    return "FREE";
    case "student": return "STUDENT";
    case "pro":     return "PRO";
    case "pro+":    return "PRO+";
  }
}

/**
 * Returns true when an error looks like a capability / entitlement mismatch
 * rather than a generic auth failure.
 *
 * This is intentionally conservative: we only match well-known 403-style
 * entitlement phrases from Spike D research.
 */
export function isCapabilityMismatchError(error: unknown): boolean {
  const message = extractErrorText(error).toLowerCase();
  if (!message) return false;

  return (
    message.includes("not authorized to use this copilot feature") ||
    message.includes("model not enabled for your account") ||
    message.includes("model not enabled for your org") ||
    message.includes("model not enabled for your plan") ||
    message.includes("access denied by organization policy") ||
    message.includes("you don't have access to github copilot") ||
    message.includes("access to this endpoint is forbidden")
  );
}

function extractErrorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";

  const record = error as Record<string, unknown>;
  const direct = record["message"];
  if (typeof direct === "string") return direct;

  const body = record["body"];
  if (typeof body === "string") return body;
  if (body && typeof body === "object") {
    const nested = (body as Record<string, unknown>)["message"];
    if (typeof nested === "string") return nested;
  }

  return "";
}

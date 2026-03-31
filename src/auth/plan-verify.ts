/**
 * CopilotHydra — Plan pre-verification
 *
 * Lightweight dry-run check against the Copilot API that warns if the
 * user-declared plan might not match the actual account. Called after
 * successful OAuth during the add-account / re-auth device flow.
 *
 * Non-blocking: mismatches emit a warning but do not block the account.
 */

import type { PlanTier } from "../types.js";
import { warn, info } from "../log.js";

export interface PlanVerifyResult {
  checked: boolean;
  declaredPlan: PlanTier;
  /** true if API check passed or was skipped */
  ok: boolean;
  /** human-readable message if a potential mismatch was detected */
  mismatchHint?: string;
}

/**
 * Fetches the Copilot user endpoint and checks if the declared plan
 * is plausible based on the API response.
 *
 * Uses `https://api.github.com/copilot_internal/user` with the OAuth token as Bearer.
 *
 * The endpoint returns a JSON object. We look for plan-related fields
 * to compare. If the field is not present or the endpoint returns an error,
 * we skip verification gracefully.
 */
export async function verifyDeclaredPlan(
  githubOAuthToken: string,
  declaredPlan: PlanTier,
): Promise<PlanVerifyResult> {
  try {
    const response = await fetch("https://api.github.com/copilot_internal/user", {
      headers: {
        Authorization: `token ${githubOAuthToken}`,
        Accept: "application/json",
        "User-Agent": "CopilotHydra",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      // 401/403 = token not valid for this endpoint, skip gracefully
      return { checked: false, declaredPlan, ok: true };
    }

    const data = (await response.json()) as Record<string, unknown>;

    // Extract plan hint from known field names
    const apiPlanRaw =
      (typeof data["plan_type"] === "string" ? data["plan_type"] : undefined) ??
      (typeof data["subscription_type"] === "string" ? data["subscription_type"] : undefined) ??
      (typeof data["copilot_plan"] === "string" ? data["copilot_plan"] : undefined);

    if (!apiPlanRaw) {
      // Field not present in response — skip gracefully
      return { checked: true, declaredPlan, ok: true };
    }

    // Normalize: "copilot_pro_plus" → "pro+", "copilot_pro" → "pro", etc.
    const normalizedApiPlan = normalizeCopilotApiPlan(apiPlanRaw);

    if (!normalizedApiPlan) {
      // Unknown API plan string, skip
      return { checked: true, declaredPlan, ok: true };
    }

    if (normalizedApiPlan !== declaredPlan) {
      const hint = `Declared plan is "${declaredPlan}" but Copilot API suggests "${normalizedApiPlan}". Consider using set-plan to correct this.`;
      warn("auth", `Plan pre-verification hint: ${hint}`);
      return {
        checked: true,
        declaredPlan,
        ok: false,
        mismatchHint: hint,
      };
    }

    info("auth", `Plan pre-verification passed: declared "${declaredPlan}" matches API.`);
    return { checked: true, declaredPlan, ok: true };
  } catch {
    // Network error, timeout, parse error — skip gracefully
    return { checked: false, declaredPlan, ok: true };
  }
}

function normalizeCopilotApiPlan(raw: string): PlanTier | undefined {
  const lower = raw.toLowerCase();
  if (lower.includes("pro_plus") || lower.includes("pro+") || lower.includes("proplus")) return "pro+";
  if (lower.includes("pro")) return "pro";
  if (lower.includes("student") || lower.includes("edu")) return "student";
  if (lower.includes("free") || lower.includes("individual")) return "free";
  return undefined;
}

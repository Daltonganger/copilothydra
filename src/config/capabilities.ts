/**
 * CopilotHydra — capability verification helpers
 *
 * v1 policy remains conservative:
 * - plan exposure starts user-declared
 * - runtime 403 entitlement failures can mark an account as mismatched
 * - user can then explicitly accept a stricter stored plan
 */

import type { AccountId, CapabilityState, CopilotAccountMeta, PlanTier } from "../types.js";
import { warn } from "../log.js";
import { markAccountCapabilityMismatch } from "../account-update.js";
import { loadAccounts } from "../storage/accounts.js";
import { extractErrorText } from "../error-text.js";
import { isKnownCopilotModelId, modelsForPlan, suggestDowngradePlanForModel } from "./models.js";

export interface PlanMismatchResult {
  account: CopilotAccountMeta;
  suggestedPlan?: PlanTier;
  message: string;
}

export async function handlePlanMismatch(
  accountId: AccountId,
  rejectedModelId?: string,
): Promise<PlanMismatchResult | null> {
  const account = await findAccountById(accountId);
  if (!account) {
    warn("capabilities", `Plan mismatch detected for unknown account "${accountId}".`);
    return null;
  }

  const suggestedPlan = resolveMismatchSuggestedPlan(account, rejectedModelId);

  const updated = await markAccountCapabilityMismatch(account.id, {
    ...(rejectedModelId ? { rejectedModelId } : {}),
    ...(suggestedPlan ? { suggestedPlan } : {}),
  });

  const message = buildMismatchMessage(updated, rejectedModelId, suggestedPlan);
  warn("capabilities", message);

  return {
    account: updated,
    ...(suggestedPlan ? { suggestedPlan } : {}),
    message,
  };
}

export function capabilityStateLabel(state: CapabilityState): string {
  switch (state) {
    case "user-declared": return "user-declared";
    case "verified": return "verified";
    case "mismatch": return "⚠ mismatch";
  }
}

export function planLabel(plan: PlanTier): string {
  switch (plan) {
    case "free": return "FREE";
    case "student": return "STUDENT";
    case "pro": return "PRO";
    case "pro+": return "PRO+";
  }
}

export function isCapabilityMismatchError(error: unknown): boolean {
  const message = extractErrorText(error).toLowerCase();
  if (!message) return false;

  return (
    message.includes("not authorized to use this copilot feature") ||
    message.includes("the requested model is not supported") ||
    message.includes("requested model is not supported") ||
    message.includes("model not enabled for your account") ||
    message.includes("model not enabled for your org") ||
    message.includes("model not enabled for your plan") ||
    message.includes("access denied by organization policy") ||
    message.includes("you don't have access to github copilot") ||
    message.includes("access to this endpoint is forbidden")
  );
}

export function buildMismatchMessage(
  account: CopilotAccountMeta,
  rejectedModelId?: string,
  suggestedPlan?: PlanTier,
): string {
  const modelPart = rejectedModelId
    ? ` Model "${rejectedModelId}" was rejected for declared plan "${account.plan}".`
    : ` Declared plan "${account.plan}" no longer matches runtime capability.`;
  const suggestionPart = suggestedPlan
    ? ` A lower plan tier may match your actual entitlement: "${suggestedPlan}". Run \`copilothydra review-mismatch ${account.id}\` to apply the suggested plan or keep the current declaration.`
    : ` No automatic plan suggestion is available (the rejected model may be enterprise-only or org-restricted). Review the account manually with \`copilothydra review-mismatch ${account.id}\`.`;

  return `[copilothydra] Capability mismatch detected for account "${account.label}" (${account.githubUsername}).${modelPart}${suggestionPart}`;
}

async function findAccountById(accountId: AccountId): Promise<CopilotAccountMeta | undefined> {
  const accounts = await loadAccounts();
  return accounts.accounts.find((candidate) => candidate.id === accountId);
}

function resolveMismatchSuggestedPlan(
  account: CopilotAccountMeta,
  rejectedModelId?: string,
): PlanTier | undefined {
  if (!rejectedModelId) {
    return undefined;
  }

  if (!isKnownCopilotModelId(rejectedModelId)) {
    return undefined;
  }

  const includeUnverified =
    account.capabilityState === "verified" ||
    (account.capabilityState === "user-declared" && account.allowUnverifiedModels === true);

  if (!modelsForPlan(account.plan, { includeUnverified }).includes(rejectedModelId)) {
    return undefined;
  }

  return suggestDowngradePlanForModel(account.plan, rejectedModelId);
}

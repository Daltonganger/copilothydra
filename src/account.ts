/**
 * CopilotHydra — account creation helpers
 */

import { randomBytes } from "node:crypto";
import type { CapabilityState, CopilotAccountMeta, PlanTier } from "./types.js";
import { buildProviderId } from "./config/providers.js";

export function createAccountMeta(input: {
  label: string;
  githubUsername: string;
  plan: PlanTier;
  capabilityState?: CapabilityState;
}): CopilotAccountMeta {
  const id = createAccountId();
  return {
    id,
    providerId: buildProviderId(id),
    label: input.label.trim(),
    githubUsername: input.githubUsername.trim(),
    plan: input.plan,
    capabilityState: input.capabilityState ?? "user-declared",
    lifecycleState: "active",
    addedAt: new Date().toISOString(),
  };
}

export function createAccountId(): string {
  return `acct_${randomBytes(3).toString("hex")}`;
}

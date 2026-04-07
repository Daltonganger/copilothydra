/**
 * CopilotHydra — account creation helpers
 */

import { randomBytes } from "node:crypto";
import { buildProviderId } from "./config/providers.js";
import type { CapabilityState, CopilotAccountMeta, PlanTier } from "./types.js";

export function createAccountMeta(input: {
	label: string;
	githubUsername: string;
	plan: PlanTier;
	capabilityState?: CapabilityState;
	allowUnverifiedModels?: boolean;
}): CopilotAccountMeta {
	const id = createAccountId();
	return {
		id,
		providerId: buildProviderId(input.githubUsername),
		label: input.label.trim(),
		githubUsername: input.githubUsername.trim(),
		plan: input.plan,
		capabilityState: input.capabilityState ?? "user-declared",
		allowUnverifiedModels: input.allowUnverifiedModels ?? false,
		lifecycleState: "active",
		addedAt: new Date().toISOString(),
	};
}

export function createAccountId(): string {
	return `acct_${randomBytes(3).toString("hex")}`;
}

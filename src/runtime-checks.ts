/**
 * CopilotHydra — runtime checks
 *
 * Early fail-closed / warn-first checks for the single-account reference path.
 */

import type { CopilotAccountMeta } from "./types.js";
import { warn } from "./log.js";
import { getOverrideRequiredModelsForPlan } from "./config/models.js";

export interface RuntimeCheckResult {
  warnings: string[];
}

export function checkAccountRuntimeReadiness(account: CopilotAccountMeta): RuntimeCheckResult {
  const warnings: string[] = [];
  if (account.capabilityState === "mismatch") {
    warnings.push(
      `Account "${account.label}" is marked as mismatch; review the stored plan before continuing.`
    );
  }

  const includeUnverified =
    account.capabilityState === "verified" ||
    (account.capabilityState === "user-declared" && account.allowUnverifiedModels === true);
  const hiddenUnverifiedModels = includeUnverified ? [] : getOverrideRequiredModelsForPlan(account.plan);

  if (hiddenUnverifiedModels.length > 0) {
    warnings.push(
      `Account "${account.label}" is hiding uncertain models until explicitly overridden: ` +
        hiddenUnverifiedModels.join(", ")
    );
  }

  if (warnings.length > 0) {
    for (const message of warnings) {
      warn("runtime", message);
    }
  }

  return { warnings };
}

export function validateAccountCount(accounts: CopilotAccountMeta[]): void {
  if (accounts.length > 8) {
    throw new Error(
      `[copilothydra] ${accounts.length} active accounts configured, but only 8 static plugin slots exist.`
    );
  }
}

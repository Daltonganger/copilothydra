/**
 * CopilotHydra — runtime checks
 *
 * Early fail-closed / warn-first checks for the single-account reference path.
 */

import type { CopilotAccountMeta } from "./types.js";
import { warn } from "./log.js";
import {
  getOverrideRequiredModelsForPlan,
  modelsForPlan,
  shouldUseCopilotResponsesApi,
} from "./config/models.js";

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
  const modelIds = modelsForPlan(account.plan, { includeUnverified });
  const hiddenUnverifiedModels = includeUnverified ? [] : getOverrideRequiredModelsForPlan(account.plan);

  if (hiddenUnverifiedModels.length > 0) {
    warnings.push(
      `Account "${account.label}" is hiding uncertain models until explicitly overridden: ` +
        hiddenUnverifiedModels.join(", ")
    );
  }

  const responseModels = modelIds.filter((modelId) => shouldUseCopilotResponsesApi(modelId));
  if (responseModels.length > 0) {
    warnings.push(
      `Account "${account.label}" exposes GPT-5+/responses models (${responseModels.join(", ")}), ` +
        "but custom provider IDs do not automatically use OpenCode's github-copilot custom loader."
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

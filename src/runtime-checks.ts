/**
 * CopilotHydra — runtime checks
 *
 * Early fail-closed / warn-first checks for the single-account reference path.
 */

import type { CopilotAccountMeta } from "./types.js";
import { warn } from "./log.js";
import { shouldUseCopilotResponsesApi, modelsForPlan } from "./config/models.js";

export interface RuntimeCheckResult {
  warnings: string[];
}

export function checkAccountRuntimeReadiness(account: CopilotAccountMeta): RuntimeCheckResult {
  const warnings: string[] = [];
  const modelIds = modelsForPlan(account.plan);

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

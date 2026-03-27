#!/usr/bin/env node
/**
 * CopilotHydra — Phase 1 bootstrap CLI
 *
 * This is not the full Phase 5 TUI. It is a minimal interactive bootstrap
 * flow to complete the single-account reference path:
 * - create one account metadata record
 * - sync provider config into OpenCode config
 * - explain that OpenCode reload/restart is required for config changes
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { PlanTier } from "./types.js";
import { createAccountMeta } from "./account.js";
import { findAccountByGitHubUsername, loadAccounts, upsertAccount } from "./storage/accounts.js";
import { beginAccountRemoval, finalizeAccountRemoval } from "./account-removal.js";
import { repairStorage } from "./storage-repair.js";
import { revalidateAccount, renameAccount, updateAccountPlan } from "./account-update.js";
import { auditStorage } from "./storage-audit.js";
import { isTTY, launchMenu } from "./ui/menu.js";
import { syncAccountsToOpenCodeConfig } from "./config/sync.js";
import { getOverrideRequiredModelsForPlan } from "./config/models.js";
import { buildMismatchMessage, capabilityStateLabel, planLabel } from "./config/capabilities.js";
import { resolveOpenCodeConfigPath } from "./config/opencode-config.js";
import { checkAccountRuntimeReadiness, validateAccountCount, validateCanAddAccount } from "./runtime-checks.js";
import { fetchAccountUsageSnapshot, formatUsageSnapshotLines } from "./auth/usage-snapshot.js";

const VALID_PLANS: PlanTier[] = ["free", "student", "pro", "pro+"];

async function main(): Promise<void> {
  const command = process.argv[2] ?? "menu";

  switch (command) {
    case "menu":
      await launchMenu();
      return;
    case "add-account":
      await addAccountInteractive();
      return;
    case "list-accounts":
      await listAccounts();
      return;
    case "sync-config":
      await syncConfigOnly();
      return;
    case "remove-account":
      await removeAccountCommand(process.argv[3]);
      return;
    case "rename-account":
      await renameAccountCommand(process.argv[3], process.argv.slice(4).join(" "));
      return;
    case "set-plan":
      await setPlanCommand(process.argv[3], process.argv[4]);
      return;
    case "revalidate-account":
      await revalidateAccountCommand(process.argv[3]);
      return;
    case "review-mismatch":
      await reviewMismatchCommand(process.argv[3], process.argv.slice(4));
      return;
    case "repair-storage":
      await repairStorageCommand();
      return;
    case "audit-storage":
      await auditStorageCommand();
      return;
    case "usage-snapshot":
      await usageSnapshotCommand(process.argv[3]);
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function addAccountInteractive(): Promise<void> {
  if (!isTTY()) {
    throw new Error("[copilothydra] add-account requires an interactive terminal (TTY)");
  }

  const existing = await loadAccounts();
  validateCanAddAccount(existing.accounts);

  const rl = createInterface({ input, output });
  try {
    const label = await promptRequired(rl, "Account label", "Personal");
    const githubUsername = await promptRequired(rl, "GitHub username", "alice");
    const plan = await promptPlan(rl);
    const allowUnverifiedModels = await promptAllowUnverifiedModels(rl, plan);

    const existingForUsername = await findAccountByGitHubUsername(githubUsername);
    if (existingForUsername) {
      throw new Error(
        `[copilothydra] an account for GitHub username "${githubUsername}" already exists ` +
          `(label: ${existingForUsername.label})`
      );
    }

    const account = createAccountMeta({ label, githubUsername, plan, allowUnverifiedModels });
    checkAccountRuntimeReadiness(account);

    await upsertAccount(account);
    await syncAccountsToOpenCodeConfig();

    output.write(`\nAdded account: ${account.label} (${account.githubUsername})\n`);
    output.write(`Provider ID: ${account.providerId}\n`);
    if (!account.allowUnverifiedModels) {
      const hiddenModels = getOverrideRequiredModelsForPlan(account.plan);
      if (hiddenModels.length > 0) {
        output.write(`Hidden uncertain models until explicit override: ${hiddenModels.join(", ")}\n`);
      }
    }
    output.write(`OpenCode config updated: ${resolveOpenCodeConfigPath()}\n`);
    output.write("Reload/restart OpenCode to pick up the new provider and model entries.\n");
    output.write("Then authenticate that provider through OpenCode's auth flow.\n");
  } finally {
    rl.close();
  }
}

async function listAccounts(): Promise<void> {
  const accounts = (await loadAccounts()).accounts;
  if (accounts.length === 0) {
    output.write("No CopilotHydra accounts configured.\n");
    return;
  }

  for (const account of accounts) {
    output.write(
      `${account.label} | ${account.githubUsername} | ${account.plan} | ${capabilityStateLabel(account.capabilityState)} | ${account.providerId} | ${account.lifecycleState}\n`
    );
  }
}

async function usageSnapshotCommand(identifier?: string): Promise<void> {
  const accounts = (await loadAccounts()).accounts;
  if (accounts.length === 0) {
    output.write("No CopilotHydra accounts configured.\n");
    return;
  }

  const selectedAccounts = identifier
    ? accounts.filter((account) => account.id === identifier || account.providerId === identifier)
    : accounts;

  if (selectedAccounts.length === 0) {
    throw new Error(`[copilothydra] account not found: ${identifier}`);
  }

  for (const account of selectedAccounts) {
    const snapshot = await fetchAccountUsageSnapshot(account);
    for (const line of formatUsageSnapshotLines(snapshot)) {
      output.write(`${line}\n`);
    }
  }
}

async function syncConfigOnly(): Promise<void> {
  const accounts = await loadAccounts();
  validateAccountCount(accounts.accounts);
  for (const account of accounts.accounts) {
    checkAccountRuntimeReadiness(account);
  }
  await syncAccountsToOpenCodeConfig();
  output.write(`Synced provider entries to ${resolveOpenCodeConfigPath()}\n`);
  output.write("Reload/restart OpenCode to apply provider changes.\n");
}

async function removeAccountCommand(identifier?: string): Promise<void> {
  if (!identifier) {
    throw new Error("[copilothydra] remove-account requires an account id or provider id");
  }

  const accounts = await loadAccounts();
  const account = accounts.accounts.find(
    (candidate) => candidate.id === identifier || candidate.providerId === identifier
  );

  if (!account) {
    throw new Error(`[copilothydra] account not found: ${identifier}`);
  }

  if (account.lifecycleState !== "pending-removal") {
    const started = await beginAccountRemoval(account.id);
    if (!started.account) {
      throw new Error(`[copilothydra] account disappeared before removal start: ${identifier}`);
    }

    output.write(`Marked account pending removal: ${started.account.label} (${started.account.githubUsername})\n`);
    output.write(`Provider ID blocked/removed from config: ${started.account.providerId}\n`);
    output.write("Run the same remove-account command again after drain/restart to finalize cleanup.\n");
    return;
  }

  const result = await finalizeAccountRemoval(account.id);
  if (!result.removed) {
    throw new Error(`[copilothydra] account disappeared before final removal: ${identifier}`);
  }

  output.write(`Removed account: ${result.removed.label} (${result.removed.githubUsername})\n`);
  output.write(`Provider ID removed: ${result.removed.providerId}\n`);
  output.write("Reload/restart OpenCode to apply provider changes.\n");
}

async function renameAccountCommand(identifier?: string, label?: string): Promise<void> {
  if (!identifier) {
    throw new Error("[copilothydra] rename-account requires an account id or provider id");
  }
  if (!label?.trim()) {
    throw new Error("[copilothydra] rename-account requires a non-empty new label");
  }

  const account = await resolveAccountByIdentifier(identifier);
  const updated = await renameAccount(account.id, label);
  output.write(`Renamed account: ${account.label} -> ${updated.label}\n`);
  output.write(`Provider ID: ${updated.providerId}\n`);
  output.write("Reload/restart OpenCode to apply provider label changes.\n");
}

async function setPlanCommand(identifier?: string, planValue?: string): Promise<void> {
  if (!identifier) {
    throw new Error("[copilothydra] set-plan requires an account id or provider id");
  }
  if (!planValue || !VALID_PLANS.includes(planValue as PlanTier)) {
    throw new Error("[copilothydra] set-plan requires one of: free, student, pro, pro+");
  }

  const account = await resolveAccountByIdentifier(identifier);
  const allowUnverifiedModels = hasFlag("--allow-unverified-models");
  const updated = await updateAccountPlan(account.id, planValue as PlanTier, {
    allowUnverifiedModels,
  });
  checkAccountRuntimeReadiness(updated);
  output.write(`Updated plan for ${updated.label}: ${account.plan} -> ${updated.plan}\n`);
  output.write(`Capability state reset to: ${updated.capabilityState}\n`);
  output.write(`Allow unverified models: ${updated.allowUnverifiedModels === true ? "yes" : "no"}\n`);
  if (!updated.allowUnverifiedModels) {
    const hiddenModels = getOverrideRequiredModelsForPlan(updated.plan);
    if (hiddenModels.length > 0) {
      output.write(`Hidden uncertain models until explicit override: ${hiddenModels.join(", ")}\n`);
    }
  }
  output.write("Reload/restart OpenCode to apply provider model changes.\n");
}

async function revalidateAccountCommand(identifier?: string): Promise<void> {
  if (!identifier) {
    throw new Error("[copilothydra] revalidate-account requires an account id or provider id");
  }

  const account = await resolveAccountByIdentifier(identifier);
  const updated = await revalidateAccount(account.id);
  output.write(`Revalidated account: ${updated.label} (${updated.githubUsername})\n`);
  output.write(`Capability state: ${updated.capabilityState}\n`);
  output.write(`Last validated at: ${updated.lastValidatedAt}\n`);
}

async function reviewMismatchCommand(identifier?: string, args: string[] = []): Promise<void> {
  if (!identifier) {
    throw new Error("[copilothydra] review-mismatch requires an account id or provider id");
  }

  const account = await resolveAccountByIdentifier(identifier);
  if (account.capabilityState !== "mismatch") {
    output.write(`Account ${account.label} is not currently marked as mismatch.\n`);
    return;
  }

  const suggestedPlan = account.mismatchSuggestedPlan;
  const forcedPlanArg = args.find((value) => VALID_PLANS.includes(value as PlanTier));
  const applySuggested = args.includes("--apply-suggested");

  output.write(`${buildMismatchMessage(account, account.mismatchModelId, suggestedPlan)}\n`);
  if (account.mismatchDetectedAt) {
    output.write(`Mismatch detected at: ${account.mismatchDetectedAt}\n`);
  }

  let nextPlan: PlanTier | undefined = forcedPlanArg as PlanTier | undefined;
  if (!nextPlan && applySuggested) {
    nextPlan = suggestedPlan;
  }

  if (!nextPlan && suggestedPlan && isTTY()) {
    const rl = createInterface({ input, output });
    try {
      while (true) {
        const value = (await rl.question(
          `Overwrite stored plan with suggested stricter plan ${planLabel(suggestedPlan)}? [y/N]: `,
        )).trim().toLowerCase();

        if (value === "" || value === "n" || value === "no") break;
        if (value === "y" || value === "yes") {
          nextPlan = suggestedPlan;
          break;
        }
      }
    } finally {
      rl.close();
    }
  }

  if (!nextPlan) {
    if (suggestedPlan) {
      output.write(`Stored plan preserved at ${planLabel(account.plan)}.\n`);
    } else {
      output.write("No stricter automatic downgrade suggestion is available for this mismatch.\n");
    }
    return;
  }

  const updated = await updateAccountPlan(account.id, nextPlan, { allowUnverifiedModels: false });
  output.write(`Updated stored plan for ${updated.label}: ${account.plan} -> ${updated.plan}\n`);
  output.write(`Capability state reset to: ${updated.capabilityState}\n`);
  output.write("Reload/restart OpenCode to apply provider model changes.\n");
}

async function repairStorageCommand(): Promise<void> {
  const result = await repairStorage();
  output.write(`Accounts retained: ${result.accountCount}\n`);
  output.write(`Secrets before repair: ${result.secretCountBefore}\n`);
  output.write(`Secrets after repair: ${result.secretCountAfter}\n`);
  output.write(`Pruned orphan secrets: ${result.prunedSecretCount}\n`);
  output.write(`Secrets file permissions normalized: ${result.normalizedSecretsFilePermissions ? "yes" : "no"}\n`);
  output.write(`Secrets file permissions after repair: ${result.secretsFilePermissionStatusAfter}\n`);
  output.write(`OpenCode config reconciled: ${resolveOpenCodeConfigPath()}\n`);
  output.write("Reload/restart OpenCode to apply provider changes if any stale providers were removed.\n");
}

async function auditStorageCommand(): Promise<void> {
  const result = await auditStorage();
  output.write(`Accounts found: ${result.accountCount}\n`);
  output.write(`Secrets found: ${result.secretCount}\n`);
  output.write(`Accounts without secrets: ${result.accountsWithoutSecrets.length}\n`);
  output.write(`Orphan secrets: ${result.orphanSecretAccountIds.length}\n`);
  output.write(`Missing provider entries: ${result.missingProviderIds.length}\n`);
  output.write(`Stale provider entries: ${result.staleProviderIds.length}\n`);
  output.write(`Model catalog consistent: ${result.modelCatalogConsistent ? "yes" : "no"}\n`);
  output.write(`Secrets file permissions: ${result.secretsFilePermissionStatus}\n`);

  output.write(`Model catalog consistent: ${result.modelCatalogConsistent ? "yes" : "no"}\n`);
  if (result.modelCatalogDrift.unknownCopilotModelIds.length > 0) {
    output.write(`Unknown Copilot model ids in config: ${result.modelCatalogDrift.unknownCopilotModelIds.join(", ")}\n`);
  }
  if (result.modelCatalogDrift.driftedProviderIds.length > 0) {
    output.write(`Providers with drifted model sets: ${result.modelCatalogDrift.driftedProviderIds.join(", ")}\n`);
  }
  if (result.modelsDevDriftSignal.checked) {
    output.write(`models.dev reachable: ${result.modelsDevDriftSignal.reachable ? "yes" : "no"}\n`);
    if (result.modelsDevDriftSignal.newCopilotModelIds.length > 0) {
      output.write(`New Copilot model ids seen via models.dev: ${result.modelsDevDriftSignal.newCopilotModelIds.join(", ")}\n`);
    }
  }

  if (result.ok) {
    output.write("Storage audit is clean. No repair needed.\n");
    if (result.modelsDevDriftSignal.newCopilotModelIds.length > 0) {
      output.write("models.dev reports newer Copilot model ids than Hydra currently catalogs. Review GitHub docs and update Hydra manually if appropriate.\n");
    }
    return;
  }

  const hasStorageIssues =
    result.accountsWithoutSecrets.length > 0 ||
    result.orphanSecretAccountIds.length > 0 ||
    result.missingProviderIds.length > 0 ||
    result.staleProviderIds.length > 0 ||
    result.insecureSecretsFilePermissions;

  if (hasStorageIssues) {
    output.write("Storage audit detected storage inconsistencies. Run `copilothydra repair-storage` to reconcile storage issues.\n");
  }

  if (!result.modelCatalogConsistent) {
    output.write(
      "Model catalog drift is detect-only. Review Hydra's local model catalog in `src/config/models.ts`, update the tier tables if needed, then run `copilothydra sync-config` and restart OpenCode.\n",
    );
  }
}

async function resolveAccountByIdentifier(identifier: string) {
  const accounts = await loadAccounts();
  const account = accounts.accounts.find(
    (candidate) => candidate.id === identifier || candidate.providerId === identifier,
  );

  if (!account) {
    throw new Error(`[copilothydra] account not found: ${identifier}`);
  }

  return account;
}

async function promptRequired(
  rl: ReturnType<typeof createInterface>,
  label: string,
  example: string
): Promise<string> {
  while (true) {
    const value = (await rl.question(`${label} [${example}]: `)).trim();
    if (value.length > 0) return value;
  }
}

async function promptPlan(rl: ReturnType<typeof createInterface>): Promise<PlanTier> {
  while (true) {
    const value = (await rl.question("Plan [free/student/pro/pro+]: ")).trim().toLowerCase();
    if (VALID_PLANS.includes(value as PlanTier)) {
      return value as PlanTier;
    }
  }
}

async function promptAllowUnverifiedModels(
  rl: ReturnType<typeof createInterface>,
  plan: PlanTier,
): Promise<boolean> {
  const uncertainModels = getOverrideRequiredModelsForPlan(plan);
  if (uncertainModels.length === 0) {
    return false;
  }

  while (true) {
    const value = (await rl.question(
      `Expose uncertain models too (${uncertainModels.join(", ")})? [y/N]: `,
    )).trim().toLowerCase();

    if (value === "" || value === "n" || value === "no") return false;
    if (value === "y" || value === "yes") return true;
  }
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exit(1);
});

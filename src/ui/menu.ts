/**
 * CopilotHydra — TUI menu
 *
 * Phase 5 foundation:
 * - non-TTY clean failure
 * - empty-state screen
 * - account overview screen with plan/capability/lifecycle visibility
 * - simple line-based main menu actions
 *
 * Future Phase 5 slices will add full account actions and richer interaction.
 */

import type { CopilotAccountMeta, PlanTier } from "../types.js";
import { createAccountMeta } from "../account.js";
import { findAccountByGitHubUsername, loadAccounts, upsertAccount } from "../storage/accounts.js";
import { capabilityStateLabel, planLabel } from "../config/capabilities.js";
import { syncAccountsToOpenCodeConfig } from "../config/sync.js";
import { resolveOpenCodeConfigPath } from "../config/opencode-config.js";
import {
  checkAccountRuntimeReadiness,
  validateAccountCount,
  validateCanAddAccount,
  countActiveAccounts,
  MAX_ACTIVE_ACCOUNTS,
} from "../runtime-checks.js";
import { renameAccount, revalidateAccount, updateAccountPlan } from "../account-update.js";
import { beginAccountRemoval, finalizeAccountRemoval } from "../account-removal.js";
import { canAccountDrainComplete } from "../routing/provider-account-map.js";
import { confirm, promptText, selectOne } from "./select.js";

interface MenuActionOption {
  key: "add-account" | "rename-account" | "revalidate-account" | "remove-account" | "review-mismatch" | "sync-config" | "refresh" | "exit";
  label: string;
  description?: string;
}

interface AccountOption {
  key: string;
  label: string;
  githubUsername: string;
  lifecycleState: CopilotAccountMeta["lifecycleState"];
  description?: string;
}

interface MenuDependencies {
  isTTY(): boolean;
  loadAccounts(): Promise<{ accounts: CopilotAccountMeta[] }>;
  findAccountByGitHubUsername(githubUsername: string): Promise<CopilotAccountMeta | undefined>;
  validateAccountCount(accounts: CopilotAccountMeta[]): void;
  validateCanAddAccount(accounts: CopilotAccountMeta[]): void;
  selectOne<T extends { label: string; description?: string }>(prompt: string, options: T[]): Promise<T | null>;
  confirm(prompt: string): Promise<boolean>;
  promptText(prompt: string, options?: { defaultValue?: string }): Promise<string | null>;
  createAccountMeta(input: {
    label: string;
    githubUsername: string;
    plan: PlanTier;
  }): CopilotAccountMeta;
  upsertAccount(account: CopilotAccountMeta): Promise<void>;
  renameAccount(accountId: string, label: string): Promise<CopilotAccountMeta>;
  revalidateAccount(accountId: string): Promise<CopilotAccountMeta>;
  beginAccountRemoval(accountId: string): Promise<{ account: CopilotAccountMeta | null; alreadyPending: boolean }>;
  finalizeAccountRemoval(accountId: string): Promise<{ removed: CopilotAccountMeta | null }>;
  canAccountDrainComplete(accountId: string): boolean;
  updateAccountPlan(accountId: string, plan: PlanTier): Promise<CopilotAccountMeta>;
  syncAccountsToOpenCodeConfig(): Promise<void>;
  resolveOpenCodeConfigPath(): string;
  checkAccountRuntimeReadiness(account: CopilotAccountMeta): void;
  write(message: string): void;
}

const DEFAULT_DEPS: MenuDependencies = {
  isTTY,
  loadAccounts,
  findAccountByGitHubUsername,
  validateAccountCount,
  validateCanAddAccount,
  selectOne,
  confirm,
  promptText,
  createAccountMeta,
  upsertAccount,
  renameAccount,
  revalidateAccount,
  beginAccountRemoval,
  finalizeAccountRemoval,
  canAccountDrainComplete,
  updateAccountPlan,
  syncAccountsToOpenCodeConfig,
  resolveOpenCodeConfigPath,
  checkAccountRuntimeReadiness,
  write: (message) => process.stdout.write(message),
};

export function isTTY(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function launchMenu(overrides: Partial<MenuDependencies> = {}): Promise<void> {
  const deps: MenuDependencies = { ...DEFAULT_DEPS, ...overrides };

  if (!deps.isTTY()) {
    throw new Error("[copilothydra] account management requires an interactive terminal (TTY)");
  }

  let restartRequired = false;

  while (true) {
    const accounts = (await deps.loadAccounts()).accounts;
    deps.validateAccountCount(accounts);

    deps.write(renderAccountManagerScreen(accounts, { restartRequired }));

    const choice = await deps.selectOne("Main menu", buildMenuOptions(accounts));
    if (!choice || choice.key === "exit") {
      deps.write("Exiting CopilotHydra account manager.\n");
      return;
    }

    switch (choice.key) {
      case "add-account":
      {
        try {
          deps.validateCanAddAccount(accounts);
        } catch (err_) {
          deps.write(`${String(err_)}\n`);
          break;
        }

        const label = await deps.promptText("Account label");
        if (!label) {
          deps.write("Add account cancelled.\n");
          break;
        }

        const githubUsername = await deps.promptText("GitHub username");
        if (!githubUsername) {
          deps.write("Add account cancelled.\n");
          break;
        }

        const existingForUsername = await deps.findAccountByGitHubUsername(githubUsername);
        if (existingForUsername) {
          deps.write(
            `[copilothydra] an account for GitHub username "${githubUsername}" already exists ` +
            `(label: ${existingForUsername.label})\n`,
          );
          break;
        }

        const planOption = await deps.selectOne("Plan tier", buildPlanOptions());
        if (!planOption) {
          deps.write("Add account cancelled.\n");
          break;
        }

        const account = deps.createAccountMeta({
          label,
          githubUsername,
          plan: planOption.key,
        });
        deps.checkAccountRuntimeReadiness(account);

        await deps.upsertAccount(account);
        await deps.syncAccountsToOpenCodeConfig();
        restartRequired = true;
        deps.write(`Added account: ${account.label} (${account.githubUsername})\n`);
        deps.write(`Provider ID: ${account.providerId}\n`);
        deps.write(`OpenCode config updated: ${deps.resolveOpenCodeConfigPath()}\n`);
        deps.write("Reload/restart OpenCode to pick up the new provider and model entries.\n");
        deps.write("Then authenticate that provider through OpenCode's auth flow.\n");
        break;
      }
      case "rename-account": {
        const account = await deps.selectOne("Rename which account?", buildAccountOptions(accounts));
        if (!account) {
          deps.write("Rename cancelled.\n");
          break;
        }

        const nextLabel = await deps.promptText("New label", { defaultValue: account.label });
        if (!nextLabel) {
          deps.write("Rename cancelled.\n");
          break;
        }

        const updated = await deps.renameAccount(account.key, nextLabel);
        restartRequired = true;
        deps.write(`Renamed account: ${account.label} -> ${updated.label}\n`);
        deps.write("Reload/restart OpenCode to apply provider label changes.\n");
        break;
      }
      case "revalidate-account": {
        const account = await deps.selectOne("Revalidate which account?", buildAccountOptions(accounts));
        if (!account) {
          deps.write("Revalidate cancelled.\n");
          break;
        }

        const updated = await deps.revalidateAccount(account.key);
        restartRequired = true;
        deps.write(`Revalidated account: ${updated.label} (${updated.githubUsername})\n`);
        deps.write(`Capability state: ${updated.capabilityState}\n`);
        deps.write(`Last validated at: ${updated.lastValidatedAt}\n`);
        deps.write("Reload/restart OpenCode to apply provider changes.\n");
        break;
      }
      case "remove-account": {
        const account = await deps.selectOne("Remove which account?", buildAccountOptions(accounts));
        if (!account) {
          deps.write("Remove cancelled.\n");
          break;
        }

        if (account.lifecycleState === "pending-removal") {
          if (!deps.canAccountDrainComplete(account.key)) {
            deps.write(
              `Account ${account.label} is still draining in-flight requests. ` +
              "Try final removal again after those requests finish.\n",
            );
            break;
          }

          const shouldFinalize = await deps.confirm(
            `Finalize removal for ${account.label}?`,
          );
          if (!shouldFinalize) {
            deps.write("Final removal cancelled.\n");
            break;
          }

          const finalized = await deps.finalizeAccountRemoval(account.key);
          if (!finalized.removed) {
            deps.write("Account was already fully removed.\n");
            break;
          }

          restartRequired = true;
          deps.write(`Removed account: ${finalized.removed.label} (${finalized.removed.githubUsername})\n`);
          deps.write("Reload/restart OpenCode to apply provider removal.\n");
          break;
        }

        const shouldBegin = await deps.confirm(`Mark ${account.label} for removal?`);
        if (!shouldBegin) {
          deps.write("Remove cancelled.\n");
          break;
        }

        const begun = await deps.beginAccountRemoval(account.key);
        if (!begun.account) {
          deps.write("Account was not found for removal.\n");
          break;
        }

        restartRequired = true;
        deps.write(
          begun.alreadyPending
            ? `Account already pending removal: ${begun.account.label} (${begun.account.githubUsername})\n`
            : `Marked account pending removal: ${begun.account.label} (${begun.account.githubUsername})\n`,
        );
        deps.write("Run remove again after in-flight requests drain to finalize cleanup.\n");
        deps.write("Reload/restart OpenCode to apply provider changes.\n");
        break;
      }
      case "review-mismatch": {
        const mismatchAccounts = accounts.filter((account) => account.capabilityState === "mismatch");
        if (mismatchAccounts.length === 0) {
          deps.write("No mismatched accounts to review.\n");
          break;
        }

        const account = await deps.selectOne(
          "Review mismatch for which account?",
          buildAccountOptions(mismatchAccounts),
        );
        if (!account) {
          deps.write("Mismatch review cancelled.\n");
          break;
        }

        const selected = mismatchAccounts.find((candidate) => candidate.id === account.key);
        if (!selected) {
          deps.write("Selected mismatch account no longer exists.\n");
          break;
        }

        deps.write(`${buildTuiMismatchMessage(selected)}\n`);
        if (!selected.mismatchSuggestedPlan) {
          deps.write(`Stored plan preserved at ${planLabel(selected.plan)}.\n`);
          break;
        }

        const shouldApply = await deps.confirm(
          `Apply suggested downgrade to ${planLabel(selected.mismatchSuggestedPlan)}?`,
        );
        if (!shouldApply) {
          deps.write(`Stored plan preserved at ${planLabel(selected.plan)}.\n`);
          break;
        }

        const updated = await deps.updateAccountPlan(selected.id, selected.mismatchSuggestedPlan);
        restartRequired = true;
        deps.write(
          `Updated stored plan for ${updated.label} (${updated.githubUsername}): ` +
          `${planLabel(selected.plan)} -> ${planLabel(updated.plan)}\n`,
        );
        deps.write(`Capability state reset to: ${updated.capabilityState}\n`);
        deps.write("Reload/restart OpenCode to apply provider changes.\n");
        break;
      }
      case "sync-config":
        for (const account of accounts) {
          deps.checkAccountRuntimeReadiness(account);
        }
        await deps.syncAccountsToOpenCodeConfig();
        restartRequired = true;
        deps.write(`Synced provider entries to ${deps.resolveOpenCodeConfigPath()}\n`);
        deps.write("Reload/restart OpenCode to apply provider changes.\n");
        break;
      case "refresh":
        break;
    }
  }
}

export function renderAccountManagerScreen(
  accounts: CopilotAccountMeta[],
  options?: { restartRequired?: boolean }
): string {
  const lines = [
    "GitHub Copilot Multi-Account Manager",
    "====================================",
    "",
  ];

  if (options?.restartRequired) {
    lines.push("Restart required: reload/restart OpenCode before provider changes take effect.", "");
  }

  if (accounts.length === 0) {
    lines.push(
      "No CopilotHydra accounts configured yet.",
      "Primary action: Add account",
      "After adding an account, reload/restart OpenCode and complete auth there.",
      ""
    );
    return lines.join("\n") + "\n";
  }

  lines.push("Accounts", "--------");
  for (const account of accounts) {
    lines.push(formatAccountSummary(account));
  }

  lines.push(
    "",
    "Legend",
    "------",
    "- capability state is always shown as verified, user-declared, or mismatch",
    "- pending-removal accounts stay visible until drain/final cleanup finishes",
    ""
  );

  return lines.join("\n") + "\n";
}

export function formatAccountSummary(account: CopilotAccountMeta): string {
  const details = [
    `[${planLabel(account.plan)}]`,
    capabilityStateLabel(account.capabilityState),
    account.lifecycleState,
  ];

  const mismatchNote = account.capabilityState === "mismatch"
    ? ` | review mismatch${account.mismatchSuggestedPlan ? ` → suggested ${planLabel(account.mismatchSuggestedPlan)}` : ""}`
    : "";

  return `- ${account.label} (${account.githubUsername}) ${details.join(" | ")}${mismatchNote}`;
}

export function buildMenuOptions(accounts: CopilotAccountMeta[]): MenuActionOption[] {
  const options: MenuActionOption[] = [];
  if (countActiveAccounts(accounts) < MAX_ACTIVE_ACCOUNTS) {
    options.push({
      key: "add-account",
      label: accounts.length === 0 ? "Add account" : "Add another account",
      description: "Interactive account setup",
    });
  }

  if (accounts.length > 0) {
    options.push(
      {
        key: "rename-account",
        label: "Rename account",
        description: "Update the user-facing account label",
      },
      {
        key: "revalidate-account",
        label: "Revalidate account",
        description: "Refresh validation timestamp and clear mismatch state when appropriate",
      },
      {
        key: "remove-account",
        label: "Remove account",
        description: "Mark an account for removal or finalize cleanup after drain",
      },
      {
        key: "review-mismatch",
        label: "Review mismatch",
        description: "Review a mismatch and optionally apply the suggested stricter plan",
      },
    );
  }

  options.push(
    {
      key: "sync-config",
      label: "Sync provider config",
      description: "Rewrite OpenCode provider entries from stored accounts",
    },
    {
      key: "refresh",
      label: "Refresh screen",
      description: "Reload account state from disk",
    },
    {
      key: "exit",
      label: "Exit",
      description: "Close the account manager",
    },
  );

  return options;
}

export function buildAccountOptions(accounts: CopilotAccountMeta[]): AccountOption[] {
  return accounts.map((account) => ({
    key: account.id,
    label: `${account.label} (${account.githubUsername})`,
    githubUsername: account.githubUsername,
    lifecycleState: account.lifecycleState,
    description: `${planLabel(account.plan)} | ${capabilityStateLabel(account.capabilityState)} | ${account.lifecycleState}`,
  }));
}

function buildPlanOptions(): Array<{ key: PlanTier; label: string; description?: string }> {
  return [
    { key: "free", label: "FREE", description: "Baseline declared model set" },
    { key: "student", label: "STUDENT", description: "Student declared model set" },
    { key: "pro", label: "PRO", description: "Pro declared model set" },
    { key: "pro+", label: "PRO+", description: "Highest declared model set" },
  ];
}

function buildTuiMismatchMessage(account: CopilotAccountMeta): string {
  const messageParts = [
    `Capability mismatch detected for ${account.label} (${account.githubUsername}).`,
    account.mismatchModelId ? `Observed provider model: ${account.mismatchModelId}.` : undefined,
    account.mismatchSuggestedPlan
      ? `Suggested stored plan based on this model: ${planLabel(account.mismatchSuggestedPlan)}.`
      : undefined,
  ].filter(Boolean);

  return messageParts.join(" ");
}

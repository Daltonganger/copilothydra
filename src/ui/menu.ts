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

import type { CopilotAccountMeta } from "../types.js";
import { loadAccounts } from "../storage/accounts.js";
import { capabilityStateLabel, planLabel } from "../config/capabilities.js";
import { syncAccountsToOpenCodeConfig } from "../config/sync.js";
import { resolveOpenCodeConfigPath } from "../config/opencode-config.js";
import { checkAccountRuntimeReadiness, validateAccountCount } from "../runtime-checks.js";
import { renameAccount, revalidateAccount } from "../account-update.js";
import { promptText, selectOne } from "./select.js";

interface MenuActionOption {
  key: "add-account" | "rename-account" | "revalidate-account" | "sync-config" | "refresh" | "exit";
  label: string;
  description?: string;
}

interface AccountOption {
  key: string;
  label: string;
  description?: string;
}

interface MenuDependencies {
  isTTY(): boolean;
  loadAccounts(): Promise<{ accounts: CopilotAccountMeta[] }>;
  validateAccountCount(accounts: CopilotAccountMeta[]): void;
  selectOne<T extends { label: string; description?: string }>(prompt: string, options: T[]): Promise<T | null>;
  promptText(prompt: string, options?: { defaultValue?: string }): Promise<string | null>;
  renameAccount(accountId: string, label: string): Promise<CopilotAccountMeta>;
  revalidateAccount(accountId: string): Promise<CopilotAccountMeta>;
  syncAccountsToOpenCodeConfig(): Promise<void>;
  resolveOpenCodeConfigPath(): string;
  checkAccountRuntimeReadiness(account: CopilotAccountMeta): void;
  write(message: string): void;
}

const DEFAULT_DEPS: MenuDependencies = {
  isTTY,
  loadAccounts,
  validateAccountCount,
  selectOne,
  promptText,
  renameAccount,
  revalidateAccount,
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
        deps.write(
          "Add account will be wired into the TUI in the next Phase 5 PR. " +
            "Use `copilothydra add-account` for now.\n"
        );
        break;
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
  const options: MenuActionOption[] = [
    {
      key: "add-account",
      label: accounts.length === 0 ? "Add account" : "Add another account",
      description: "Interactive account setup",
    },
  ];

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
    description: `${planLabel(account.plan)} | ${capabilityStateLabel(account.capabilityState)} | ${account.lifecycleState}`,
  }));
}

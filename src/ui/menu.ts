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
import { selectOne } from "./select.js";

interface MenuActionOption {
  key: "add-account" | "sync-config" | "refresh" | "exit";
  label: string;
  description?: string;
}

export function isTTY(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export async function launchMenu(): Promise<void> {
  if (!isTTY()) {
    throw new Error("[copilothydra] account management requires an interactive terminal (TTY)");
  }

  let restartRequired = false;

  while (true) {
    const accounts = (await loadAccounts()).accounts;
    validateAccountCount(accounts);

    process.stdout.write(renderAccountManagerScreen(accounts, { restartRequired }));

    const choice = await selectOne("Main menu", buildMenuOptions(accounts));
    if (!choice || choice.key === "exit") {
      process.stdout.write("Exiting CopilotHydra account manager.\n");
      return;
    }

    switch (choice.key) {
      case "add-account":
        process.stdout.write(
          "Add account will be wired into the TUI in the next Phase 5 PR. " +
            "Use `copilothydra add-account` for now.\n"
        );
        break;
      case "sync-config":
        for (const account of accounts) {
          checkAccountRuntimeReadiness(account);
        }
        await syncAccountsToOpenCodeConfig();
        restartRequired = true;
        process.stdout.write(`Synced provider entries to ${resolveOpenCodeConfigPath()}\n`);
        process.stdout.write("Reload/restart OpenCode to apply provider changes.\n");
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

function buildMenuOptions(accounts: CopilotAccountMeta[]): MenuActionOption[] {
  const options: MenuActionOption[] = [
    {
      key: "add-account",
      label: accounts.length === 0 ? "Add account" : "Add another account",
      description: "Interactive account setup",
    },
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
  ];

  return options;
}

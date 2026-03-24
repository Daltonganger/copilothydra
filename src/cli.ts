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
import { loadAccounts, upsertAccount } from "./storage/accounts.js";
import { removeAccountCompletely } from "./account-removal.js";
import { isTTY } from "./ui/menu.js";
import { syncAccountsToOpenCodeConfig } from "./config/sync.js";
import { resolveOpenCodeConfigPath } from "./config/opencode-config.js";
import { checkAccountRuntimeReadiness, validateAccountCount } from "./runtime-checks.js";

const VALID_PLANS: PlanTier[] = ["free", "student", "pro", "pro+"];

async function main(): Promise<void> {
  const command = process.argv[2] ?? "add-account";

  switch (command) {
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
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function addAccountInteractive(): Promise<void> {
  if (!isTTY()) {
    throw new Error("[copilothydra] add-account requires an interactive terminal (TTY)");
  }

  const existing = await loadAccounts();
  validateAccountCount(existing.accounts);

  const rl = createInterface({ input, output });
  try {
    const label = await promptRequired(rl, "Account label", "Personal");
    const githubUsername = await promptRequired(rl, "GitHub username", "alice");
    const plan = await promptPlan(rl);

    const account = createAccountMeta({ label, githubUsername, plan });
    checkAccountRuntimeReadiness(account);

    await upsertAccount(account);
    await syncAccountsToOpenCodeConfig();

    output.write(`\nAdded account: ${account.label} (${account.githubUsername})\n`);
    output.write(`Provider ID: ${account.providerId}\n`);
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
      `${account.label} | ${account.githubUsername} | ${account.plan} | ${account.providerId} | ${account.lifecycleState}\n`
    );
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

  const result = await removeAccountCompletely(account.id);
  if (!result.removed) {
    throw new Error(`[copilothydra] account disappeared before removal: ${identifier}`);
  }

  output.write(`Removed account: ${result.removed.label} (${result.removed.githubUsername})\n`);
  output.write(`Provider ID removed: ${result.removed.providerId}\n`);
  output.write("Reload/restart OpenCode to apply provider changes.\n");
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

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(message + "\n");
  process.exit(1);
});

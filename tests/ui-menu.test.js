import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cleanupDir, makeTempDir } from "./helpers.js";

test("renderAccountManagerScreen shows empty-state guidance", async () => {
  const { renderAccountManagerScreen } = await import(`../dist/ui/menu.js?${Date.now()}`);

  const screen = renderAccountManagerScreen([]);
  assert.match(screen, /GitHub Copilot Multi-Account Manager/);
  assert.match(screen, /No CopilotHydra accounts configured yet/);
  assert.match(screen, /Primary action: Add account/);
});

test("renderAccountManagerScreen shows account capability and lifecycle states", async () => {
  const { renderAccountManagerScreen } = await import(`../dist/ui/menu.js?${Date.now()}`);

  const screen = renderAccountManagerScreen([
    {
      id: "acct_one",
      providerId: "github-copilot-acct-acct_one",
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: "2026-03-25T00:00:00.000Z",
    },
    {
      id: "acct_two",
      providerId: "github-copilot-acct-acct_two",
      label: "Work",
      githubUsername: "bob",
      plan: "student",
      capabilityState: "mismatch",
      mismatchSuggestedPlan: "free",
      lifecycleState: "pending-removal",
      addedAt: "2026-03-25T00:00:00.000Z",
    },
  ], { restartRequired: true });

  assert.match(screen, /Restart required/);
  assert.match(screen, /Personal \(alice\) \[PRO\] \| user-declared \| active/);
  assert.match(screen, /Work \(bob\) \[STUDENT\] \| ⚠ mismatch \| pending-removal/);
  assert.match(screen, /suggested FREE/);
});

test("buildMenuOptions exposes rename and revalidate actions when accounts exist", async () => {
  const { buildMenuOptions } = await import(`../dist/ui/menu.js?${Date.now()}`);

  const options = buildMenuOptions([
    {
      id: "acct_one",
      providerId: "github-copilot-acct-acct_one",
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: "2026-03-25T00:00:00.000Z",
    },
  ]);

  assert.deepEqual(options.map((option) => option.key), [
    "add-account",
    "rename-account",
    "revalidate-account",
    "sync-config",
    "refresh",
    "exit",
  ]);
});

test("launchMenu can rename an account through the TUI action flow", async () => {
  const tempDir = await makeTempDir();

  try {
    const stamp = Date.now();
    const { createAccountMeta } = await import(`../dist/account.js?${stamp}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${stamp}`);
    const { launchMenu } = await import(`../dist/ui/menu.js?${stamp}`);

    const account = createAccountMeta({ label: "Personal", githubUsername: "alice", plan: "free" });
    await upsertAccount(account, tempDir);

    const writes = [];
    let mainMenuCalls = 0;
    await launchMenu({
      isTTY: () => true,
      loadAccounts: () => loadAccounts(tempDir),
      renameAccount: (accountId, label) => import(`../dist/account-update.js?${Date.now()}`).then((mod) => mod.renameAccount(accountId, label, { configDir: tempDir, configPath: path.join(tempDir, "opencode.json") })),
      selectOne: async (prompt, options) => {
        if (prompt === "Main menu") {
          mainMenuCalls += 1;
          if (mainMenuCalls === 1) {
            return options.find((option) => option.key === "rename-account") ?? null;
          }
          return options.find((option) => option.key === "exit") ?? null;
        }
        if (prompt === "Rename which account?") {
          return options[0] ?? null;
        }
        return null;
      },
      promptText: async () => "Renamed",
      write: (message) => {
        writes.push(message);
      },
    });

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts[0].label, "Renamed");
    assert.match(writes.join(""), /Renamed account: Personal \(alice\) -> Renamed/);
  } finally {
    await cleanupDir(tempDir);
  }
});

test("launchMenu can revalidate an account through the TUI action flow", async () => {
  const tempDir = await makeTempDir();

  try {
    const stamp = Date.now();
    const { createAccountMeta } = await import(`../dist/account.js?${stamp}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${stamp}`);
    const { launchMenu } = await import(`../dist/ui/menu.js?${stamp}`);

    const account = createAccountMeta({ label: "Personal", githubUsername: "alice", plan: "free" });
    account.capabilityState = "mismatch";
    account.mismatchDetectedAt = "2026-03-25T00:00:00.000Z";
    account.mismatchModelId = "o1";
    account.mismatchSuggestedPlan = "student";
    await upsertAccount(account, tempDir);

    const writes = [];
    let mainMenuCalls = 0;
    await launchMenu({
      isTTY: () => true,
      loadAccounts: () => loadAccounts(tempDir),
      revalidateAccount: (accountId) => import(`../dist/account-update.js?${Date.now()}`).then((mod) => mod.revalidateAccount(accountId, { configDir: tempDir, configPath: path.join(tempDir, "opencode.json"), now: "2026-03-26T00:00:00.000Z" })),
      selectOne: async (prompt, options) => {
        if (prompt === "Main menu") {
          mainMenuCalls += 1;
          if (mainMenuCalls === 1) {
            return options.find((option) => option.key === "revalidate-account") ?? null;
          }
          return options.find((option) => option.key === "exit") ?? null;
        }
        if (prompt === "Revalidate which account?") {
          return options[0] ?? null;
        }
        return null;
      },
      write: (message) => {
        writes.push(message);
      },
    });

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts[0].capabilityState, "user-declared");
    assert.equal(accounts.accounts[0].mismatchSuggestedPlan, undefined);
    assert.equal(accounts.accounts[0].lastValidatedAt, "2026-03-26T00:00:00.000Z");
    assert.match(writes.join(""), /Revalidated account: Personal \(alice\)/);
  } finally {
    await cleanupDir(tempDir);
  }
});

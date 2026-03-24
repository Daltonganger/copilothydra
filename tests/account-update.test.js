import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

test("renameAccount updates label and synced OpenCode model labels", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);
    const { renameAccount } = await import(`../dist/account-update.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Personal", githubUsername: "alice", plan: "free" });
    await upsertAccount(account, tempDir);
    await syncAccountsToOpenCodeConfig(configPath, tempDir);

    const updated = await renameAccount(account.id, "Work", { configDir: tempDir, configPath });
    assert.equal(updated.label, "Work");

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts[0].label, "Work");

    const config = await readJson(configPath);
    assert.match(config.provider[account.providerId].name, /Work/);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("updateAccountPlan resets capability state and clears lastValidatedAt", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateAccountPlan } = await import(`../dist/account-update.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Personal", githubUsername: "alice", plan: "free" });
    account.capabilityState = "mismatch";
    account.lastValidatedAt = "2026-01-01T00:00:00.000Z";
    await upsertAccount(account, tempDir);

    const updated = await updateAccountPlan(account.id, "pro", { configDir: tempDir, configPath });
    assert.equal(updated.plan, "pro");
    assert.equal(updated.capabilityState, "user-declared");
    assert.equal(updated.lastValidatedAt, undefined);

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts[0].plan, "pro");
    assert.equal(accounts.accounts[0].capabilityState, "user-declared");
    assert.equal(accounts.accounts[0].lastValidatedAt, undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("cli rename-account, set-plan, and revalidate-account update stored metadata", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Personal", githubUsername: "alice", plan: "free" });
    await upsertAccount(account, tempDir);
    await syncAccountsToOpenCodeConfig(configPath, tempDir);

    let result = spawnSync(process.execPath, ["dist/cli.js", "rename-account", account.id, "Renamed"], {
      cwd: path.resolve("."),
      env: { ...process.env, OPENCODE_CONFIG_DIR: tempDir, OPENCODE_CONFIG: configPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = spawnSync(process.execPath, ["dist/cli.js", "set-plan", account.id, "pro"], {
      cwd: path.resolve("."),
      env: { ...process.env, OPENCODE_CONFIG_DIR: tempDir, OPENCODE_CONFIG: configPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    result = spawnSync(process.execPath, ["dist/cli.js", "revalidate-account", account.providerId], {
      cwd: path.resolve("."),
      env: { ...process.env, OPENCODE_CONFIG_DIR: tempDir, OPENCODE_CONFIG: configPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Last validated at:/);

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts[0].label, "Renamed");
    assert.equal(accounts.accounts[0].plan, "pro");
    assert.equal(accounts.accounts[0].capabilityState, "user-declared");
    assert.ok(accounts.accounts[0].lastValidatedAt);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

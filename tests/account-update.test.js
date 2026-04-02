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

test("renameAccount rejects duplicate labels and keeps stored metadata unchanged", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);
    const { renameAccount } = await import(`../dist/account-update.js?${Date.now()}`);

    const first = createAccountMeta({ label: "Personal", githubUsername: "alice", plan: "free" });
    const second = createAccountMeta({ label: "Work", githubUsername: "bob", plan: "pro" });
    await upsertAccount(first, tempDir);
    await upsertAccount(second, tempDir);
    await syncAccountsToOpenCodeConfig(configPath, tempDir);

    await assert.rejects(
      () => renameAccount(second.id, " personal ", { configDir: tempDir, configPath }),
      /an account with label ".*" already exists/
    );

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts.find((account) => account.id === second.id)?.label, "Work");

    const config = await readJson(configPath);
    assert.equal(config.provider[first.providerId].name, "Personal");
    assert.equal(config.provider[second.providerId].name, "Work");
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
    assert.equal(updated.allowUnverifiedModels, false);
    assert.equal(updated.lastValidatedAt, undefined);

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts[0].plan, "pro");
    assert.equal(accounts.accounts[0].capabilityState, "user-declared");
    assert.equal(accounts.accounts[0].allowUnverifiedModels, false);
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

    result = spawnSync(process.execPath, ["dist/cli.js", "set-plan", account.id, "pro", "--allow-unverified-models"], {
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
    assert.equal(accounts.accounts[0].allowUnverifiedModels, true);
    assert.ok(accounts.accounts[0].lastValidatedAt);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("markAccountCapabilityMismatch stores mismatch metadata and review-mismatch can apply suggestion", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { markAccountCapabilityMismatch } = await import(`../dist/account-update.js?${Date.now()}`);

    const account = createAccountMeta({
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
      allowUnverifiedModels: true,
    });
    await upsertAccount(account, tempDir);

    const mismatched = await markAccountCapabilityMismatch(account.id, {
      configDir: tempDir,
      configPath,
      now: "2026-03-25T12:00:00.000Z",
      rejectedModelId: "o1",
      suggestedPlan: "student",
    });

    assert.equal(mismatched.capabilityState, "mismatch");
    assert.equal(mismatched.allowUnverifiedModels, false);
    assert.equal(mismatched.mismatchModelId, "o1");
    assert.equal(mismatched.mismatchSuggestedPlan, "student");

    let result = spawnSync(process.execPath, ["dist/cli.js", "review-mismatch", account.id, "--apply-suggested"], {
      cwd: path.resolve("."),
      env: { ...process.env, OPENCODE_CONFIG_DIR: tempDir, OPENCODE_CONFIG: configPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Updated stored plan/);

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts[0].plan, "student");
    assert.equal(accounts.accounts[0].capabilityState, "user-declared");
    assert.equal(accounts.accounts[0].mismatchModelId, undefined);
    assert.equal(accounts.accounts[0].mismatchSuggestedPlan, undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("list-accounts shows capability state and review-mismatch can preserve stored plan", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { markAccountCapabilityMismatch } = await import(`../dist/account-update.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Mismatch", githubUsername: "alice", plan: "pro" });
    await upsertAccount(account, tempDir);
    await markAccountCapabilityMismatch(account.id, {
      configDir: tempDir,
      configPath,
      now: "2026-03-25T13:00:00.000Z",
      rejectedModelId: "o1",
      suggestedPlan: "student",
    });

    let result = spawnSync(process.execPath, ["dist/cli.js", "list-accounts"], {
      cwd: path.resolve("."),
      env: { ...process.env, OPENCODE_CONFIG_DIR: tempDir, OPENCODE_CONFIG: configPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /⚠ mismatch/);

    result = spawnSync(process.execPath, ["dist/cli.js", "review-mismatch", account.id], {
      cwd: path.resolve("."),
      env: { ...process.env, OPENCODE_CONFIG_DIR: tempDir, OPENCODE_CONFIG: configPath },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Stored plan preserved at PRO/);

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts[0].plan, "pro");
    assert.equal(accounts.accounts[0].capabilityState, "mismatch");
    assert.equal(accounts.accounts[0].mismatchSuggestedPlan, "student");
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

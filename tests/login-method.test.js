import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

const PLUGIN_INPUT = {
  client: {},
  project: {},
  worktree: {},
  directory: process.cwd(),
  serverUrl: "http://localhost:4096",
  $: {},
};

test("CopilotHydraSetup exposes a GitHub Copilot auth method for OpenCode auth login", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    const { CopilotHydraSetup } = await import(`../dist/index.js?${Date.now()}`);
    const hooks = await CopilotHydraSetup(PLUGIN_INPUT);

    assert.equal(hooks.auth?.provider, "github-copilot");
    assert.equal(hooks.auth?.methods.length, 1);
    assert.equal(hooks.auth?.methods[0].type, "oauth");
    assert.match(hooks.auth?.methods[0].label ?? "", /CopilotHydra/);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("login method can create a new account from OpenCode auth login inputs", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    const { createCopilotLoginMethod } = await import(`../dist/auth/login-method.js?${Date.now()}`);

    let tokenState;
    const method = createCopilotLoginMethod({
      requestDeviceCode: async () => ({
        device_code: "device-1",
        user_code: "ABCD-EFGH",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
      pollForAccessToken: async () => ({ accessToken: "gho_test_token", scope: "read:user" }),
      setTokenState: (next) => {
        tokenState = next;
      },
    });

    const started = await method.authorize({
      githubUsername: "alice",
      label: "Personal",
      plan: "pro",
      allowUnverifiedModels: "no",
    });

    assert.match(started.instructions, /reload\/restart OpenCode/i);

    const finished = await started.callback();
    assert.equal(finished.type, "success");
    assert.match(finished.provider ?? "", /^github-copilot-acct-/);
    assert.equal(tokenState.githubOAuthToken, "gho_test_token");

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    const config = await readJson(path.join(tempDir, "opencode.json"));
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].githubUsername, "alice");
    assert.ok(config.provider[accounts.accounts[0].providerId]);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("login method can re-auth an existing account without requiring new-account prompts", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { createCopilotLoginMethod } = await import(`../dist/auth/login-method.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Work", githubUsername: "bob", plan: "student" });
    await upsertAccount(account, tempDir);

    let tokenState;
    const method = createCopilotLoginMethod({
      requestDeviceCode: async () => ({
        device_code: "device-2",
        user_code: "IJKL-MNOP",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      }),
      pollForAccessToken: async () => ({ accessToken: "gho_existing_token", scope: "read:user" }),
      setTokenState: (next) => {
        tokenState = next;
      },
    });

    const started = await method.authorize({ githubUsername: "bob" });
    assert.doesNotMatch(started.instructions, /reload\/restart OpenCode/i);

    const finished = await started.callback();
    assert.equal(finished.type, "success");
    assert.equal(finished.provider, account.providerId);
    assert.equal(tokenState.accountId, account.id);

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].label, "Work");
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTempDir, readJson, cleanupDir } from "./helpers.js";

test("single-account sync writes provider config while keeping github-copilot available for Hydra login", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);

    const account = createAccountMeta({
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
    });

    await upsertAccount(account, tempDir);
    await syncAccountsToOpenCodeConfig(path.join(tempDir, "opencode.json"));

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    const config = await readJson(path.join(tempDir, "opencode.json"));
    const managedState = await readJson(path.join(tempDir, "copilothydra-opencode-state.json"));

    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].providerId, account.providerId);
    assert.ok(config.provider);
    assert.ok(config.provider[account.providerId]);
    assert.equal(config.disabled_providers, undefined);
    assert.deepEqual(managedState, {});
    assert.equal(config.provider[account.providerId].options, undefined);
    assert.equal(config.provider[account.providerId].models["gpt-5.4"].name, "GPT-5.4");
    assert.equal(config.provider[account.providerId].models["gpt-5-mini"].name, "GPT-5-mini");
    assert.equal(config.provider[account.providerId].models["claude-opus-4.6-fast"], undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

test("single-account sync keeps documented baseline stable even when override flag is enabled", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);

    const account = createAccountMeta({
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
      allowUnverifiedModels: true,
    });

    await upsertAccount(account, tempDir);
    await syncAccountsToOpenCodeConfig(path.join(tempDir, "opencode.json"));

    const config = await readJson(path.join(tempDir, "opencode.json"));
    assert.equal(config.provider[account.providerId].options, undefined);
    assert.equal(config.provider[account.providerId].models["gpt-5.4"].name, "GPT-5.4");
    assert.equal(config.provider[account.providerId].models["gpt-5-mini"].name, "GPT-5-mini");
    assert.equal(
      config.provider[account.providerId].models["claude-opus-4.6-fast"],
      undefined
    );
    assert.equal(config.provider[account.providerId].models["gemini-3.1-pro-preview"].name, "Gemini 3.1 Pro Preview");
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

test("single-account sync removes legacy Hydra-managed github-copilot disable state", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { saveOpenCodeConfig, saveCopilotHydraOpenCodeState } = await import(
      `../dist/config/opencode-config.js?${Date.now()}`
    );
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);

    const account = createAccountMeta({
      label: "Personal",
      githubUsername: "alice",
      plan: "pro",
    });

    await upsertAccount(account, tempDir);
    await saveOpenCodeConfig(
      {
        disabled_providers: ["github-copilot", "opencode"],
      },
      path.join(tempDir, "opencode.json"),
    );
    await saveCopilotHydraOpenCodeState(
      {
        managedDisabledProviders: ["github-copilot"],
      },
      path.join(tempDir, "copilothydra-opencode-state.json"),
    );

    await syncAccountsToOpenCodeConfig(path.join(tempDir, "opencode.json"));

    const config = await readJson(path.join(tempDir, "opencode.json"));
    const managedState = await readJson(path.join(tempDir, "copilothydra-opencode-state.json"));

    assert.deepEqual(config.disabled_providers, ["opencode"]);
    assert.ok(config.provider[account.providerId]);
    assert.deepEqual(managedState, {});
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

test("sync removes only CopilotHydra-managed standalone disable state when no accounts remain", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const { saveOpenCodeConfig, saveCopilotHydraOpenCodeState } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);

    await saveOpenCodeConfig(
      {
        disabled_providers: ["github-copilot", "opencode"],
      },
      path.join(tempDir, "opencode.json"),
    );
    await saveCopilotHydraOpenCodeState(
      {
        managedDisabledProviders: ["github-copilot"],
      },
      path.join(tempDir, "copilothydra-opencode-state.json"),
    );

    await syncAccountsToOpenCodeConfig(path.join(tempDir, "opencode.json"));

    const config = await readJson(path.join(tempDir, "opencode.json"));
    const managedState = await readJson(path.join(tempDir, "copilothydra-opencode-state.json"));
    assert.deepEqual(config.disabled_providers, ["opencode"]);
    assert.deepEqual(managedState, {});
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

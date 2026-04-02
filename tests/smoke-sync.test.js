import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTempDir, readJson, cleanupDir } from "./helpers.js";

test("single-account sync writes provider config and disables built-in github-copilot while Hydra accounts exist", async () => {
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
    assert.equal(account.providerId, "github-copilot-user-alice");
    assert.equal(accounts.accounts[0].providerId, account.providerId);
    assert.ok(config.provider);
    assert.ok(config.provider[account.providerId]);
    assert.deepEqual(config.disabled_providers, ["github-copilot"]);
    assert.deepEqual(managedState, { managedDisabledProviders: ["github-copilot"] });
    assert.equal(config.provider[account.providerId].options, undefined);
    assert.equal(config.provider[account.providerId].models["gpt-5.4"].name, "GPT-5.4");
    assert.equal(config.provider[account.providerId].models["gpt-5-mini"].name, "GPT-5-mini");
    assert.equal(config.provider[account.providerId].models["claude-opus-4.6-fast"], undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

test("portable provider IDs preserve valid GitHub username characters without punctuation collisions", async () => {
  const { buildProviderId } = await import(`../dist/config/providers.js?${Date.now()}`);

  assert.equal(buildProviderId(" User-Name "), "github-copilot-user-user-name");
  assert.throws(
    () => buildProviderId("user.name"),
    /provider ID requires a GitHub username using only letters, numbers, or hyphens/
  );
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
    assert.deepEqual(config.disabled_providers, ["github-copilot"]);
    assert.deepEqual(
      (await readJson(path.join(tempDir, "copilothydra-opencode-state.json"))),
      { managedDisabledProviders: ["github-copilot"] },
    );
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

test("single-account sync replaces legacy Hydra-managed github-copilot disable state with new managed state", async () => {
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

    // Legacy state is cleaned and replaced with fresh managed disable
    assert.deepEqual(config.disabled_providers, ["opencode", "github-copilot"]);
    assert.ok(config.provider[account.providerId]);
    assert.deepEqual(managedState, { managedDisabledProviders: ["github-copilot"] });
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

test("sync migrates legacy account/provider IDs to portable username-based IDs", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);
    const { loadAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        path.join(tempDir, "copilot-accounts.json"),
        JSON.stringify({
          version: 1,
          accounts: [
            {
              id: "acct_legacy",
              providerId: "github-copilot-acct-acct_legacy",
              label: "Legacy",
              githubUsername: "PortableUser",
              plan: "pro",
              capabilityState: "user-declared",
              lifecycleState: "active",
              addedAt: new Date().toISOString(),
            },
          ],
        }, null, 2),
        "utf8",
      )
    );

    await import(`../dist/config/opencode-config.js?${Date.now()}`).then(({ saveOpenCodeConfig }) =>
      saveOpenCodeConfig(
        {
          provider: {
            "github-copilot-acct-acct_legacy": { name: "legacy" },
            external: { name: "external" },
          },
        },
        path.join(tempDir, "opencode.json"),
      )
    );

    const migrated = await loadAccounts(tempDir);
    assert.equal(migrated.accounts[0].providerId, "github-copilot-user-portableuser");

    await syncAccountsToOpenCodeConfig(path.join(tempDir, "opencode.json"), tempDir);

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    const config = await readJson(path.join(tempDir, "opencode.json"));

    assert.equal(accounts.accounts[0].providerId, "github-copilot-user-portableuser");
    assert.equal(config.provider["github-copilot-acct-acct_legacy"], undefined);
    assert.ok(config.provider["github-copilot-user-portableuser"]);
    assert.ok(config.provider.external);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

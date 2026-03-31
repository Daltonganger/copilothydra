import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

const PLUGIN_INPUT = {
  client: {},
  project: {},
  worktree: {},
  directory: process.cwd(),
  serverUrl: "http://localhost:4096",
  $: {},
};

async function captureStderr(action) {
  const chunks = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = ((chunk, encoding, callback) => {
    chunks.push(typeof chunk === "string" ? chunk : chunk.toString(typeof encoding === "string" ? encoding : undefined));
    if (typeof encoding === "function") {
      encoding();
    } else if (typeof callback === "function") {
      callback();
    }
    return true;
  });

  try {
    const result = await action();
    return { result, output: chunks.join("") };
  } finally {
    process.stderr.write = originalWrite;
  }
}

test("CopilotHydraSetup does not emit normal startup noise without debug flags", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'copilothydra-plugin-load-'));
process.env.OPENCODE_CONFIG_DIR = tempDir;
process.env.OPENCODE_CONFIG = path.join(tempDir, 'opencode.json');
const { CopilotHydraSetup } = await import('./dist/index.js');
await CopilotHydraSetup({ client: {}, project: {}, worktree: {}, directory: process.cwd(), serverUrl: 'http://localhost:4096', $: {} });
await rm(tempDir, { recursive: true, force: true });`,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        COPILOTHYDRA_DEBUG: "",
        COPILOTHYDRA_DEBUG_AUTH: "",
        COPILOTHYDRA_DEBUG_ROUTING: "",
        COPILOTHYDRA_DEBUG_STORAGE: "",
      },
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr.trim(), "");
});

test("CopilotHydraSetup exposes a GitHub Copilot auth method for OpenCode auth login", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    const { CopilotHydraSetup } = await import(`../dist/index.js?${Date.now()}`);
    const hooks = await CopilotHydraSetup(PLUGIN_INPUT);

    assert.equal(hooks.auth?.provider, "github-copilot");
    assert.equal(hooks.auth?.methods.length, 1);
    assert.deepEqual(
      hooks.auth?.methods.map((method) => method.label),
      ["GitHub Copilot (CopilotHydra) — Add new account"],
    );
    assert.deepEqual(
      hooks.auth?.methods.map((method) => method.prompts?.map((prompt) => prompt.key) ?? []),
      [["githubUsername", "label", "plan", "allowUnverifiedModels"]],
    );
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("CopilotHydraSetup restores host-native Copilot state when no Hydra accounts remain", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    const { saveOpenCodeConfig, saveCopilotHydraOpenCodeState } = await import(
      `../dist/config/opencode-config.js?${Date.now()}`
    );

    await saveOpenCodeConfig(
      {
        disabled_providers: ["github-copilot", "opencode"],
        provider: {
          "github-copilot-acct-stale": { name: "Stale Hydra" },
        },
      },
      path.join(tempDir, "opencode.json"),
    );
    await saveCopilotHydraOpenCodeState(
      {
        managedDisabledProviders: ["github-copilot"],
      },
      path.join(tempDir, "copilothydra-opencode-state.json"),
    );

    const { CopilotHydraSetup } = await import(`../dist/index.js?${Date.now()}`);
    const hooks = await CopilotHydraSetup(PLUGIN_INPUT);

    assert.equal(hooks.auth?.provider, "github-copilot");

    const config = await readJson(path.join(tempDir, "opencode.json"));
    const managedState = await readJson(path.join(tempDir, "copilothydra-opencode-state.json"));

    assert.deepEqual(config.disabled_providers, ["opencode"]);
    assert.equal(config.provider, undefined);
    assert.deepEqual(managedState, {});
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
    const { createCopilotLoginMethods } = await import(`../dist/auth/login-method.js?${Date.now()}`);

    let tokenState;
    const [method] = createCopilotLoginMethods([], {
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

    assert.equal(started.url, "https://github.com/login/device");
    assert.equal(started.instructions, "Enter this code:\nABCD-EFGH\n(Code expires in 900s; account: Personal / alice)\n\nAfter authorization completes, reload or restart OpenCode so the new provider entry is picked up.");
    assert.doesNotMatch(started.instructions, /https:\/\/github\.com\/login\/device/i);
    assert.match(started.instructions, /reload or restart OpenCode/i);

    const { result: finished, output } = await captureStderr(() => started.callback());
    assert.equal(finished.type, "success");
    assert.match(finished.provider ?? "", /^github-copilot-acct-/);
    assert.equal(tokenState.githubOAuthToken, "gho_test_token");
    assert.match(output, /Authorization succeeded for "Personal"/);
    assert.match(output, /reload\/restart OpenCode/i);

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    const secrets = await readJson(path.join(tempDir, "copilot-secrets.json"));
    const config = await readJson(path.join(tempDir, "opencode.json"));
    assert.equal(accounts.accounts.length, 1);
    assert.deepEqual(secrets.secrets, [
      {
        accountId: accounts.accounts[0].id,
        githubOAuthToken: "gho_test_token",
      },
    ]);
    assert.equal(accounts.accounts[0].githubUsername, "alice");
    assert.ok(config.provider[accounts.accounts[0].providerId]);
    assert.equal(config.disabled_providers, undefined);
    assert.equal(config.provider[accounts.accounts[0].providerId].models["gpt-5.4"].name, "GPT-5.4");
    assert.equal(config.provider[accounts.accounts[0].providerId].models["gpt-5-mini"].name, "GPT-5-mini");
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
    const { createCopilotLoginMethods } = await import(`../dist/auth/login-method.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Work", githubUsername: "bob", plan: "student" });
    await upsertAccount(account, tempDir);

    let tokenState;
    const methods = createCopilotLoginMethods([account], {
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

    const [method] = methods;
    assert.equal(method.label, "GitHub Copilot (CopilotHydra) — Re-auth existing account");
    assert.equal(method.prompts?.[0]?.type, "text");
    assert.equal(method.prompts?.[0]?.key, "githubUsername");
    assert.equal(method.prompts?.[0]?.placeholder, "bob");

    const started = await method.authorize({ githubUsername: account.githubUsername });
    assert.equal(started.url, "https://github.com/login/device");
    assert.equal(started.instructions, "Enter this code:\nIJKL-MNOP\n(Code expires in 900s; account: Work / bob)");
    assert.doesNotMatch(started.instructions, /https:\/\/github\.com\/login\/device/i);
    assert.doesNotMatch(started.instructions, /reload\/restart OpenCode/i);

    const { result: finished, output } = await captureStderr(() => started.callback());
    assert.equal(finished.type, "success");
    assert.equal(finished.provider, account.providerId);
    assert.equal(tokenState.accountId, account.id);
    assert.doesNotMatch(output, /reload\/restart OpenCode/i);

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    const secrets = await readJson(path.join(tempDir, "copilot-secrets.json"));
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].label, "Work");
    assert.deepEqual(secrets.secrets, [
      {
        accountId: account.id,
        githubOAuthToken: "gho_existing_token",
      },
    ]);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
}

test("fetchAccountUsageSnapshot recovers missing local secret from OpenCode auth.json and persists it", async () => {
  const tempDir = await makeTempDir("copilothydra-usage-recover-");
  const originalFetch = globalThis.fetch;
  const originalXdgDataHome = process.env.XDG_DATA_HOME;

  process.env.XDG_DATA_HOME = tempDir;

  try {
    const { fetchAccountUsageSnapshot } = await import(`../dist/auth/usage-snapshot.js?${Date.now()}`);
    const { findSecret } = await import(`../dist/storage/secrets.js?${Date.now()}`);

    await fs.mkdir(path.join(tempDir, "opencode"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "opencode", "auth.json"),
      JSON.stringify({
        "github-copilot-acct-acct_usage_recover": {
          type: "oauth",
          access: "gho_access_recovered",
          refresh: "gho_refresh_recovered",
          expires: 0,
          accountId: "acct_usage_recover",
        },
      }, null, 2),
      "utf8",
    );

    let capturedRequest = null;
    globalThis.fetch = async (url, init) => {
      capturedRequest = { url: String(url), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({ copilot_plan: "individual_pro", quota_snapshots: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const snapshot = await fetchAccountUsageSnapshot({
      id: "acct_usage_recover",
      providerId: "github-copilot-acct-acct_usage_recover",
      label: "Recovered",
      githubUsername: "recover-user",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date().toISOString(),
    }, tempDir);

    assert.equal(snapshot.plan, "individual_pro");
    assert.equal(capturedRequest.headers.get("authorization"), "token gho_refresh_recovered");

    const secret = await findSecret("acct_usage_recover", tempDir);
    assert.deepEqual(secret, {
      accountId: "acct_usage_recover",
      githubOAuthToken: "gho_refresh_recovered",
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalXdgDataHome === undefined) {
      delete process.env.XDG_DATA_HOME;
    } else {
      process.env.XDG_DATA_HOME = originalXdgDataHome;
    }
    await cleanupDir(tempDir);
  }
});
});

test("new-account method rejects duplicate usernames so re-auth stays separate", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { createCopilotLoginMethods } = await import(`../dist/auth/login-method.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Existing", githubUsername: "alice", plan: "pro" });
    await upsertAccount(account, tempDir);

    const [, method] = createCopilotLoginMethods([account], {
      requestDeviceCode: async () => {
        throw new Error("device flow should not start");
      },
    });

    await assert.rejects(
      method.authorize({
        githubUsername: "alice",
        label: "Duplicate",
        plan: "pro",
        allowUnverifiedModels: "no",
      }),
      /already exists; use the re-auth method instead/,
    );
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("createCopilotLoginMethods omits re-auth when there are no existing accounts", async () => {
  const { createCopilotLoginMethods } = await import(`../dist/auth/login-method.js?${Date.now()}`);

  const methods = createCopilotLoginMethods([]);

  assert.equal(methods.length, 1);
  assert.equal(methods[0].label, "GitHub Copilot (CopilotHydra) — Add new account");
});

test("createCopilotLoginMethods omits add-account when 8 active accounts already exist", async () => {
  const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
  const { createCopilotLoginMethods } = await import(`../dist/auth/login-method.js?${Date.now()}`);

  const accounts = Array.from({ length: 8 }, (_, index) =>
    createAccountMeta({
      label: `Account ${index + 1}`,
      githubUsername: `user${index + 1}`,
      plan: "free",
    })
  );

  const labels = createCopilotLoginMethods(accounts).map((method) => method.label);
  assert.deepEqual(labels, ["GitHub Copilot (CopilotHydra) — Re-auth existing account"]);
});

test("createCopilotLoginMethods still offers add-account when only 7 active accounts exist and one is pending-removal", async () => {
  const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
  const { createCopilotLoginMethods } = await import(`../dist/auth/login-method.js?${Date.now()}`);

  const accounts = Array.from({ length: 8 }, (_, index) => {
    const account = createAccountMeta({
      label: `Account ${index + 1}`,
      githubUsername: `user${index + 1}`,
      plan: "free",
    });
    if (index === 7) {
      account.lifecycleState = "pending-removal";
    }
    return account;
  });

  const labels = createCopilotLoginMethods(accounts).map((method) => method.label);
  assert.deepEqual(labels, [
    "GitHub Copilot (CopilotHydra) — Re-auth existing account",
    "GitHub Copilot (CopilotHydra) — Add new account",
  ]);
});

test("new-account authorize fails when another active account was added after methods were created", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount, loadAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { createCopilotLoginMethods } = await import(`../dist/auth/login-method.js?${Date.now()}`);

    const initialAccounts = Array.from({ length: 7 }, (_, index) =>
      createAccountMeta({
        label: `Account ${index + 1}`,
        githubUsername: `user${index + 1}`,
        plan: "free",
      })
    );
    for (const account of initialAccounts) {
      await upsertAccount(account, tempDir);
    }

    const methods = createCopilotLoginMethods(await loadAccounts(tempDir).then((file) => file.accounts));
    const addAccountMethod = methods.find((method) => method.label === "GitHub Copilot (CopilotHydra) — Add new account");
    assert.ok(addAccountMethod);

    await upsertAccount(createAccountMeta({
      label: "Account 8",
      githubUsername: "user8",
      plan: "free",
    }), tempDir);

    await assert.rejects(
      addAccountMethod.authorize({
        githubUsername: "user9",
        label: "Account 9",
        plan: "free",
        allowUnverifiedModels: "no",
      }),
      /Cannot add another active account: 8 active accounts already configured/
    );

    const accounts = await loadAccounts(tempDir);
    assert.equal(accounts.accounts.length, 8);
    assert.equal(accounts.accounts.some((account) => account.githubUsername === "user9"), false);
   } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("CopilotHydraSetup does not rewrite clean host config when no Hydra takeover state exists", async () => {
  const tempDir = await makeTempDir();
  const configPath = path.join(tempDir, "opencode.jsonc");
  const statePath = path.join(tempDir, "copilothydra-opencode-state.json");
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = configPath;

  const originalConfig = `{
  // keep this comment
  "plugin": []
}\n`;

  try {
    await fs.writeFile(configPath, originalConfig, "utf8");

    const { CopilotHydraSetup } = await import(`../dist/index.js?${Date.now()}`);
    const hooks = await CopilotHydraSetup(PLUGIN_INPUT);

    assert.equal(hooks.auth?.provider, "github-copilot");
    assert.equal(await fs.readFile(configPath, "utf8"), originalConfig);
    await assert.rejects(fs.stat(statePath), /ENOENT/);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

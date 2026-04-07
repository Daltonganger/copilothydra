import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { cleanupDir, makeTempDir } from "./helpers.js";

test("auditStorage reports orphan secrets, missing providers, and stale providers without mutating files", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);

    const accountWithSecret = createAccountMeta({ label: "Keep", githubUsername: "keep", plan: "free" });
    const accountMissingSecret = createAccountMeta({ label: "NeedSecret", githubUsername: "needsecret", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(accountWithSecret, accountMissingSecret);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: accountWithSecret.id, githubOAuthToken: "token-keep" });
      file.secrets.push({ accountId: "acct_orphan", githubOAuthToken: "token-orphan" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [accountWithSecret.providerId]: buildProviderConfig(accountWithSecret),
          "github-copilot-acct-stale": { name: "stale" },
          external: { name: "external" },
        },
      },
      configPath,
    );

    globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await auditStorage({ configDir: tempDir, configPath });
    assert.equal(result.ok, false);
    assert.deepEqual(result.accountsWithoutSecrets, [accountMissingSecret.id]);
    assert.deepEqual(result.orphanSecretAccountIds, ["acct_orphan"]);
    assert.deepEqual(result.missingProviderIds, [accountMissingSecret.providerId]);
    assert.deepEqual(result.staleProviderIds, ["github-copilot-acct-stale"]);
    assert.equal(result.modelCatalogConsistent, true);
    assert.deepEqual(result.modelCatalogDrift, {
      unknownCopilotModelIds: [],
      driftedProviderIds: [],
    });
    assert.deepEqual(result.modelsDevDriftSignal, {
      checked: true,
      reachable: true,
      newCopilotModelIds: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("cli audit-storage reports detected inconsistencies and repair hint", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Audit", githubUsername: "audit", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          "github-copilot-acct-stale": { name: "stale" },
        },
      },
      configPath,
    );

    const result = spawnSync(process.execPath, ["dist/cli.js", "audit-storage"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: tempDir,
        OPENCODE_CONFIG: configPath,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Accounts without secrets: 1/);
    assert.match(result.stdout, /Stale provider entries: 1/);
    assert.match(result.stdout, /Model catalog consistent: yes/);
    assert.match(result.stdout, /repair-storage/);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("auditStorage reports unknown Copilot model ids and drifted Hydra provider model sets without mutating files", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Drift", githubUsername: "drift", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token-drift" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: {
            name: "Drift",
            models: {
              "github-new-hotness": { name: "GitHub New Hotness" },
            },
          },
          "github-copilot": {
            name: "Built-in",
            models: {
              "github-unknown-model": { name: "Unknown" },
            },
          },
        },
      },
      configPath,
    );

    globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const originalConfig = await fs.readFile(configPath, "utf8");
    const result = await auditStorage({ configDir: tempDir, configPath });
    const afterConfig = await fs.readFile(configPath, "utf8");

    assert.equal(result.ok, false);
    assert.equal(result.modelCatalogConsistent, false);
    assert.deepEqual(result.modelCatalogDrift.unknownCopilotModelIds, [
      "github-new-hotness",
      "github-unknown-model",
    ]);
    assert.deepEqual(result.modelCatalogDrift.driftedProviderIds, [account.providerId]);
    assert.equal(result.modelsDevDriftSignal.reachable, true);
    assert.deepEqual(result.modelsDevDriftSignal.newCopilotModelIds, []);
    assert.equal(afterConfig, originalConfig);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("auditStorage reports new Copilot model ids seen via models.dev without mutating files", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    await saveOpenCodeConfig({ provider: {} }, configPath);

    globalThis.fetch = async (url) => {
      assert.equal(String(url), "https://models.dev/models.json");
      return new Response(JSON.stringify({
        models: [
          { id: "gpt-5.4", provider: "github-copilot" },
          { id: "github-future-model", provider: "github-copilot" },
          { id: "not-copilot", provider: "openai" },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const originalConfig = await import(`node:fs/promises`).then((fs) => fs.readFile(configPath, "utf8"));
    const result = await auditStorage({ configDir: tempDir, configPath });
    const afterConfig = await import(`node:fs/promises`).then((fs) => fs.readFile(configPath, "utf8"));

    assert.equal(result.ok, true);
    assert.deepEqual(result.modelsDevDriftSignal, {
      checked: true,
      reachable: true,
      newCopilotModelIds: ["github-future-model"],
    });
    assert.equal(afterConfig, originalConfig);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("auditStorage fails open when models.dev is unavailable", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    await saveOpenCodeConfig({ provider: {} }, configPath);

    globalThis.fetch = async () => {
      throw new Error("network down");
    };

    const result = await auditStorage({ configDir: tempDir, configPath });
    assert.equal(result.ok, true);
    assert.deepEqual(result.modelsDevDriftSignal, {
      checked: true,
      reachable: false,
      newCopilotModelIds: [],
    });
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("auditStorage marks provider entries with missing models as drifted", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);

    const account = createAccountMeta({ label: "MissingModels", githubUsername: "missingmodels", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token-missing-models" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: {
            name: "MissingModels",
          },
        },
      },
      configPath,
    );

    const result = await auditStorage({ configDir: tempDir, configPath });
    assert.equal(result.modelCatalogConsistent, false);
    assert.deepEqual(result.modelCatalogDrift.driftedProviderIds, [account.providerId]);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("auditStorage ignores non-Copilot providers whose ids merely contain github-copilot", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);

    await saveOpenCodeConfig(
      {
        provider: {
          "proxy-github-copilot-helper": {
            name: "Proxy",
            models: {
              "github-new-hotness": { name: "Proxy Model" },
            },
          },
        },
      },
      process.env.OPENCODE_CONFIG,
    );

    const result = await auditStorage({ configDir: tempDir, configPath: process.env.OPENCODE_CONFIG });
    assert.deepEqual(result.modelCatalogDrift.unknownCopilotModelIds, []);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("cli audit-storage reports model catalog drift details and manual remediation guidance", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);

    const account = createAccountMeta({ label: "DriftCli", githubUsername: "driftcli", plan: "free" });
    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);
    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token-cli" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: {
            name: "DriftCli",
            models: {
              "github-new-hotness": { name: "GitHub New Hotness" },
            },
          },
          "github-copilot": {
            name: "Built-in",
            models: {
              "github-unknown-model": { name: "Unknown" },
            },
          },
        },
      },
      configPath,
    );

    const result = spawnSync(process.execPath, ["dist/cli.js", "audit-storage"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: tempDir,
        OPENCODE_CONFIG: configPath,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Model catalog consistent: no/);
    assert.match(result.stdout, /Unknown Copilot model ids in config:/);
    assert.match(result.stdout, /Providers with drifted model sets:/);
    assert.match(result.stdout, /src\/config\/models\.ts/);
    assert.match(result.stdout, /copilothydra sync-config/);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

// ---------------------------------------------------------------------------
// Auth drift tests
// ---------------------------------------------------------------------------

test("auditStorage reports auth drift when active accounts lack oauth entries in auth.json", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const configPath = path.join(tempDir, "opencode.json");
    const authPath = path.join(tempDir, "auth.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);
    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);

    const accountWithAuth = createAccountMeta({ label: "HasAuth", githubUsername: "hasauth", plan: "free" });
    const accountWithoutAuth = createAccountMeta({ label: "NoAuth", githubUsername: "noauth", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(accountWithAuth, accountWithoutAuth);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: accountWithAuth.id, githubOAuthToken: "token-a" });
      file.secrets.push({ accountId: accountWithoutAuth.id, githubOAuthToken: "token-b" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [accountWithAuth.providerId]: buildProviderConfig(accountWithAuth),
          [accountWithoutAuth.providerId]: buildProviderConfig(accountWithoutAuth),
        },
      },
      configPath,
    );

    // Write auth.json with entry only for accountWithAuth
    await fs.writeFile(authPath, JSON.stringify({
      [accountWithAuth.providerId]: {
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: 0,
      },
    }, null, 2));

    globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await auditStorage({ configDir: tempDir, configPath, authPath });

    assert.equal(result.ok, false);
    assert.equal(result.authDriftEntries.length, 1);
    assert.equal(result.authDriftEntries[0].providerId, accountWithoutAuth.providerId);
    assert.equal(result.authDriftEntries[0].accountId, accountWithoutAuth.id);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("auditStorage reports all active accounts as auth drift when auth.json is missing", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const configPath = path.join(tempDir, "opencode.json");
    const authPath = path.join(tempDir, "nonexistent-auth.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);
    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);

    const account = createAccountMeta({ label: "NoFile", githubUsername: "nofile", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: buildProviderConfig(account),
        },
      },
      configPath,
    );

    globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await auditStorage({ configDir: tempDir, configPath, authPath });

    assert.equal(result.ok, false);
    assert.equal(result.authDriftEntries.length, 1);
    assert.equal(result.authDriftEntries[0].providerId, account.providerId);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("auditStorage reports no auth drift when all active accounts have valid oauth entries", async () => {
  const tempDir = await makeTempDir();
  const originalFetch = globalThis.fetch;

  try {
    const configPath = path.join(tempDir, "opencode.json");
    const authPath = path.join(tempDir, "auth.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);
    const { auditStorage } = await import(`../dist/storage-audit.js?${Date.now()}`);

    const account = createAccountMeta({ label: "AuthOk", githubUsername: "authok", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: buildProviderConfig(account),
        },
      },
      configPath,
    );

    await fs.writeFile(authPath, JSON.stringify({
      [account.providerId]: {
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: 0,
      },
    }, null, 2));

    globalThis.fetch = async () => new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await auditStorage({ configDir: tempDir, configPath, authPath });

    assert.equal(result.ok, true);
    assert.equal(result.authDriftEntries.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("cli audit-storage reports auth drift entries and remediation hint", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    const authPath = path.join(tempDir, "auth.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);

    const account = createAccountMeta({ label: "AuthDriftCli", githubUsername: "authdriftcli", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: buildProviderConfig(account),
        },
      },
      configPath,
    );

    // auth.json is empty — no entry for the account's providerId
    await fs.writeFile(authPath, JSON.stringify({}, null, 2));

    const result = spawnSync(process.execPath, ["dist/cli.js", "audit-storage"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: tempDir,
        OPENCODE_CONFIG: configPath,
        COPILOTHYDRA_TEST_AUTH_PATH: authPath,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Auth drift \(providers missing oauth\): 1/);
    assert.match(result.stdout, /Auth drift detected/);
    assert.match(result.stdout, /copilothydra sync-config/);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("cli status reports auth drift in a dedicated section", async () => {
  const tempDir = await makeTempDir();

  try {
    const configPath = path.join(tempDir, "opencode.json");
    const authPath = path.join(tempDir, "auth.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);

    const account = createAccountMeta({ label: "StatusAuthDrift", githubUsername: "statusauthdrift", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: buildProviderConfig(account),
        },
      },
      configPath,
    );

    await fs.writeFile(authPath, JSON.stringify({}, null, 2));

    const result = spawnSync(process.execPath, ["dist/cli.js", "status"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: tempDir,
        OPENCODE_CONFIG: configPath,
        COPILOTHYDRA_TEST_AUTH_PATH: authPath,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Auth/);
    assert.match(result.stdout, /1 provider\(s\) missing oauth entry/);
    assert.match(result.stdout, /copilothydra sync-config/);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

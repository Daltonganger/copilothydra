import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { cleanupDir, makeTempDir } from "./helpers.js";

test("auditStorage reports orphan secrets, missing providers, and stale providers without mutating files", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";
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
  } finally {
    delete process.env.OPENCODE_CONFIG;
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

test("cli audit-storage reports detected inconsistencies and repair hint", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";
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
        COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM: "1",
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
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

test("auditStorage reports unknown Copilot model ids and drifted Hydra provider model sets without mutating files", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";
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
    assert.equal(afterConfig, originalConfig);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

test("auditStorage marks provider entries with missing models as drifted", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";
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
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
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
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";
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
        COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM: "1",
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
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

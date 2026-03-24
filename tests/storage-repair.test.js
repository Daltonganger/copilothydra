import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

test("repairStorage prunes orphan secrets and removes stale CopilotHydra provider entries", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";

    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { repairStorage } = await import(`../dist/storage-repair.js?${Date.now()}`);

    const keep = createAccountMeta({ label: "Keep", githubUsername: "keep", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(keep);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: keep.id, githubOAuthToken: "token-keep" });
      file.secrets.push({ accountId: "acct_orphan", githubOAuthToken: "token-orphan" });
    }, tempDir);

    await saveOpenCodeConfig(
      {
        provider: {
          [keep.providerId]: { name: "keep" },
          "github-copilot-acct-stale": { name: "stale" },
          external: { name: "external" },
        },
      },
      configPath
    );

    const result = await repairStorage({ configDir: tempDir, configPath });
    assert.equal(result.accountCount, 1);
    assert.equal(result.secretCountBefore, 2);
    assert.equal(result.secretCountAfter, 1);
    assert.equal(result.prunedSecretCount, 1);

    const secrets = await readJson(path.join(tempDir, "copilot-secrets.json"));
    assert.deepEqual(secrets.secrets.map((entry) => entry.accountId), [keep.id]);

    const config = await readJson(configPath);
    assert.ok(config.provider[keep.providerId]);
    assert.equal(config.provider["github-copilot-acct-stale"], undefined);
    assert.ok(config.provider.external);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

test("cli repair-storage reconciles storage and reports repair summary", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";

    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);

    const account = createAccountMeta({ label: "CLI", githubUsername: "cli", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);
    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token-good" });
      file.secrets.push({ accountId: "acct_orphan", githubOAuthToken: "token-bad" });
    }, tempDir);
    await saveOpenCodeConfig(
      {
        provider: {
          [account.providerId]: { name: "keep" },
          "github-copilot-acct-stale": { name: "stale" },
        },
      },
      configPath
    );

    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["dist/cli.js", "repair-storage"], {
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
    assert.match(result.stdout, /Pruned orphan secrets: 1/);

    const config = await readJson(configPath);
    assert.ok(config.provider[account.providerId]);
    assert.equal(config.provider["github-copilot-acct-stale"], undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

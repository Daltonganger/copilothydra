import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

test("pruneOrphanSecrets removes secrets for missing accounts", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets, pruneOrphanSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);

    const keep = createAccountMeta({ label: "Keep", githubUsername: "keep", plan: "free" });
    const drop = createAccountMeta({ label: "Drop", githubUsername: "drop", plan: "pro" });

    await updateAccounts((file) => {
      file.accounts.push(keep);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: keep.id, githubOAuthToken: "token-keep" });
      file.secrets.push({ accountId: drop.id, githubOAuthToken: "token-drop" });
    }, tempDir);

    await pruneOrphanSecrets({ accounts: [{ id: keep.id }] }, tempDir);

    const secrets = await readJson(path.join(tempDir, "copilot-secrets.json"));
    assert.equal(secrets.secrets.length, 1);
    assert.equal(secrets.secrets[0].accountId, keep.id);
  } finally {
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

test("removeAccountCompletely removes account, secret, and OpenCode provider entry", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";

    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);
    const { removeAccountCompletely } = await import(`../dist/account-removal.js?${Date.now()}`);

    const keep = createAccountMeta({ label: "Keep", githubUsername: "keep", plan: "free" });
    const remove = createAccountMeta({ label: "Remove", githubUsername: "remove", plan: "pro" });

    await updateAccounts((file) => {
      file.accounts.push(keep, remove);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: keep.id, githubOAuthToken: "token-keep" });
      file.secrets.push({ accountId: remove.id, githubOAuthToken: "token-remove" });
    }, tempDir);

    await syncAccountsToOpenCodeConfig(configPath, tempDir);
    const beforeConfig = await readJson(configPath);
    assert.ok(beforeConfig.provider[keep.providerId]);
    assert.ok(beforeConfig.provider[remove.providerId]);

    const result = await removeAccountCompletely(remove.id, { configDir: tempDir, configPath });
    assert.equal(result.removed?.id, remove.id);

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.deepEqual(accounts.accounts.map((entry) => entry.id), [keep.id]);

    const secrets = await readJson(path.join(tempDir, "copilot-secrets.json"));
    assert.deepEqual(secrets.secrets.map((entry) => entry.accountId), [keep.id]);

    const afterConfig = await readJson(configPath);
    assert.ok(afterConfig.provider[keep.providerId]);
    assert.equal(afterConfig.provider?.[remove.providerId], undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

test("cli remove-account removes a configured account by id", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";

    const configPath = path.join(tempDir, "opencode.json");
    process.env.OPENCODE_CONFIG = configPath;

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { syncAccountsToOpenCodeConfig } = await import(`../dist/config/sync.js?${Date.now()}`);

    const account = createAccountMeta({ label: "CLI", githubUsername: "cli-user", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);
    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token-cli" });
    }, tempDir);
    await syncAccountsToOpenCodeConfig(configPath, tempDir);

    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, ["dist/cli.js", "remove-account", account.id], {
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

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts.length, 0);

    const secrets = await readJson(path.join(tempDir, "copilot-secrets.json"));
    assert.equal(secrets.secrets.length, 0);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { makeTempDir, readJson, cleanupDir } from "./helpers.js";

test("single-account sync writes provider config with account-specific model labels", async () => {
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

    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].providerId, account.providerId);
    assert.ok(config.provider);
    assert.ok(config.provider[account.providerId]);
    assert.equal(
      config.provider[account.providerId].models["gpt-4o"].name,
      "gpt-4o (Personal)"
    );
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makeTempDir, cleanupDir } from "./helpers.js";

test("backfill-keychain writes existing active account secrets into keychain", async () => {
  const tempDir = await makeTempDir();
  const configPath = path.join(tempDir, "opencode.json");

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);

    const account = createAccountMeta({
      label: "Backfill Test",
      githubUsername: "backfill-user",
      plan: "pro",
    });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "token-backfill" });
    }, tempDir);

    await saveOpenCodeConfig(
      { provider: { [account.providerId]: buildProviderConfig(account) } },
      configPath,
    );

    const result = spawnSync(process.execPath, ["dist/cli.js", "backfill-keychain"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: tempDir,
        OPENCODE_CONFIG: configPath,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Backfilled native keychain entries: 1/);
    assert.match(result.stdout, /Skipped accounts without secrets: 0/);

    // On macOS, verify the token landed in the OS keychain
    if (process.platform === "darwin") {
      const { getCopilotCLIKeychainToken, deleteCopilotCLIKeychainToken } =
        await import(`../dist/storage/copilot-cli-keychain.js?verify=${Date.now()}`);

      const retrieved = await getCopilotCLIKeychainToken("backfill-user");
      assert.equal(retrieved, "token-backfill", "Keychain token should match");

      // Cleanup keychain entry
      await deleteCopilotCLIKeychainToken("backfill-user");
    }
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

test("backfill-keychain skips accounts without secrets", async () => {
  const tempDir = await makeTempDir();
  const configPath = path.join(tempDir, "opencode.json");

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { saveOpenCodeConfig } = await import(`../dist/config/opencode-config.js?${Date.now()}`);
    const { buildProviderConfig } = await import(`../dist/config/providers.js?${Date.now()}`);

    const account = createAccountMeta({
      label: "No Secret",
      githubUsername: "skip-user",
      plan: "free",
    });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    // No secrets written for this account

    await saveOpenCodeConfig(
      { provider: { [account.providerId]: buildProviderConfig(account) } },
      configPath,
    );

    const result = spawnSync(process.execPath, ["dist/cli.js", "backfill-keychain"], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        OPENCODE_CONFIG_DIR: tempDir,
        OPENCODE_CONFIG: configPath,
      },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Backfilled native keychain entries: 0/);
    assert.match(result.stdout, /Skipped accounts without secrets: 1/);
    assert.match(result.stdout, /opencode auth login/);
  } finally {
    delete process.env.OPENCODE_CONFIG;
    await cleanupDir(tempDir);
  }
});

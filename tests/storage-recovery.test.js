import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

test("corrupt accounts file is quarantined and replaced with empty state on next write", async () => {
  const tempDir = await makeTempDir();

  try {
    const accountsPath = path.join(tempDir, "copilot-accounts.json");
    await fs.writeFile(accountsPath, "{ definitely not valid json", "utf8");

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Recovered", githubUsername: "alice", plan: "free" });

    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    const entries = await fs.readdir(tempDir);
    assert.ok(entries.some((entry) => entry.startsWith("copilot-accounts.json.corrupt-")));

    const accounts = await readJson(accountsPath);
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].label, "Recovered");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("secret updates run as a lock-wrapped read-modify-write transaction", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";

    const { updateSecrets } = await import(`../dist/storage/secrets.js?secrets-tx=${Date.now()}`);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: "acct_a", githubOAuthToken: "token-a" });
      file.secrets.push({ accountId: "acct_b", githubOAuthToken: "token-b" });
    }, tempDir);

    const secrets = await readJson(path.join(tempDir, "copilot-secrets.json"));
    assert.equal(secrets.secrets.length, 2);
    assert.deepEqual(
      secrets.secrets.map((entry) => entry.accountId).sort(),
      ["acct_a", "acct_b"]
    );
  } finally {
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

test("corrupt secrets file is quarantined and replaced with empty state on next write", async () => {
  const tempDir = await makeTempDir();

  try {
    process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM = "1";

    const secretsPath = path.join(tempDir, "copilot-secrets.json");
    await fs.writeFile(secretsPath, '{"version":1,"secrets":"wrong-shape"}', "utf8");

    const { updateSecrets } = await import(`../dist/storage/secrets.js?secrets-recovery=${Date.now()}`);

    await updateSecrets((file) => {
      file.secrets.push({ accountId: "acct_ok", githubOAuthToken: "token-ok" });
    }, tempDir);

    const entries = await fs.readdir(tempDir);
    assert.ok(entries.some((entry) => entry.startsWith("copilot-secrets.json.corrupt-")));

    const secrets = await readJson(secretsPath);
    assert.equal(secrets.secrets.length, 1);
    assert.equal(secrets.secrets[0].accountId, "acct_ok");
  } finally {
    delete process.env.COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM;
    await cleanupDir(tempDir);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

test("duplicate account ids trigger quarantine and recovery on next write", async () => {
  const tempDir = await makeTempDir();

  try {
    const accountsPath = path.join(tempDir, "copilot-accounts.json");
    await fs.writeFile(
      accountsPath,
      JSON.stringify({
        version: 1,
        accounts: [
          {
            id: "acct_dup",
            providerId: "github-copilot-acct-acct_dup",
            label: "A",
            githubUsername: "alice",
            plan: "free",
            capabilityState: "user-declared",
            lifecycleState: "active",
            addedAt: new Date().toISOString(),
          },
          {
            id: "acct_dup",
            providerId: "github-copilot-acct-acct_other",
            label: "B",
            githubUsername: "bob",
            plan: "pro",
            capabilityState: "user-declared",
            lifecycleState: "active",
            addedAt: new Date().toISOString(),
          },
        ],
      }),
      "utf8"
    );

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Recovered", githubUsername: "recovered", plan: "free" });
    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    const entries = await fs.readdir(tempDir);
    assert.ok(entries.some((entry) => entry.startsWith("copilot-accounts.json.corrupt-")));

    const accounts = await readJson(accountsPath);
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].id, account.id);
  } finally {
    await cleanupDir(tempDir);
  }
});

test("duplicate secret account ids trigger quarantine and recovery on next write", async () => {
  const tempDir = await makeTempDir();

  try {
    const secretsPath = path.join(tempDir, "copilot-secrets.json");
    await fs.writeFile(
      secretsPath,
      JSON.stringify({
        version: 1,
        secrets: [
          { accountId: "acct_dup", githubOAuthToken: "token-a" },
          { accountId: "acct_dup", githubOAuthToken: "token-b" },
        ],
      }),
      "utf8"
    );

    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);
    await updateSecrets((file) => {
      file.secrets.push({ accountId: "acct_ok", githubOAuthToken: "token-ok" });
    }, tempDir);

    const entries = await fs.readdir(tempDir);
    assert.ok(entries.some((entry) => entry.startsWith("copilot-secrets.json.corrupt-")));

    const secrets = await readJson(secretsPath);
    assert.equal(secrets.secrets.length, 1);
    assert.equal(secrets.secrets[0].accountId, "acct_ok");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("malformed account entries without required fields trigger quarantine and recovery", async () => {
  const tempDir = await makeTempDir();

  try {
    const accountsPath = path.join(tempDir, "copilot-accounts.json");
    await fs.writeFile(
      accountsPath,
      JSON.stringify({
        version: 1,
        accounts: [{ id: "acct_bad" }],
      }),
      "utf8"
    );

    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    const account = createAccountMeta({ label: "Recovered2", githubUsername: "recover2", plan: "student" });
    await updateAccounts((file) => {
      file.accounts.push(account);
    }, tempDir);

    const recovered = await readJson(accountsPath);
    assert.equal(recovered.accounts.length, 1);
    assert.equal(recovered.accounts[0].id, account.id);
  } finally {
    await cleanupDir(tempDir);
  }
});

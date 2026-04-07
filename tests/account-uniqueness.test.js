import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

test("upsertAccount rejects duplicate GitHub usernames case-insensitively", async () => {
  const tempDir = await makeTempDir();

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    await upsertAccount(
      createAccountMeta({ label: "Personal", githubUsername: "Alice", plan: "free" }),
      tempDir
    );

    await assert.rejects(
      () =>
        upsertAccount(
          createAccountMeta({ label: "Work", githubUsername: "alice", plan: "pro" }),
          tempDir
        ),
      /already exists/
    );

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].githubUsername, "Alice");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("upsertAccount rejects duplicate account labels case-insensitively", async () => {
  const tempDir = await makeTempDir();

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    await upsertAccount(
      createAccountMeta({ label: "Work", githubUsername: "alice", plan: "free" }),
      tempDir
    );

    await assert.rejects(
      () =>
        upsertAccount(
          createAccountMeta({ label: " work ", githubUsername: "bob", plan: "pro" }),
          tempDir
        ),
      /an account with label ".*" already exists/
    );

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].label, "Work");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("duplicate GitHub usernames in accounts file trigger quarantine and recovery", async () => {
  const tempDir = await makeTempDir();

  try {
    const accountsPath = path.join(tempDir, "copilot-accounts.json");
    await fs.writeFile(
      accountsPath,
      JSON.stringify({
        version: 1,
        accounts: [
          {
            id: "acct_a",
            providerId: "github-copilot-acct-acct_a",
            label: "A",
            githubUsername: "Alice",
            plan: "free",
            capabilityState: "user-declared",
            lifecycleState: "active",
            addedAt: new Date().toISOString(),
          },
          {
            id: "acct_b",
            providerId: "github-copilot-acct-acct_b",
            label: "B",
            githubUsername: "alice",
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

    const recovered = createAccountMeta({ label: "Recovered", githubUsername: "carol", plan: "student" });
    await updateAccounts((file) => {
      file.accounts.push(recovered);
    }, tempDir);

    const entries = await fs.readdir(tempDir);
    assert.ok(entries.some((entry) => entry.startsWith("copilot-accounts.json.corrupt-")));

    const accounts = await readJson(accountsPath);
    assert.equal(accounts.accounts.length, 1);
    assert.equal(accounts.accounts[0].githubUsername, "carol");
  } finally {
    await cleanupDir(tempDir);
  }
});

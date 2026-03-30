import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson, writeJson } from "./helpers.js";

test("accounts with invalid enum values or timestamps are quarantined and recovered", async () => {
  const tempDir = await makeTempDir();

  try {
    const { loadAccounts, updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    const accountsPath = path.join(tempDir, "copilot-accounts.json");
    await writeJson(accountsPath, {
      version: 1,
      accounts: [
        {
          id: "acct_bad",
          providerId: "github-copilot-acct-acct_bad",
          label: "Broken",
          githubUsername: "broken",
          plan: "enterprise",
          capabilityState: "verified",
          lifecycleState: "active",
          addedAt: "not-a-date",
        },
      ],
    });

    const loaded = await loadAccounts(tempDir);
    assert.deepEqual(loaded, { version: 1, accounts: [] });

    await updateAccounts((file) => {
      file.accounts.push({
        id: "acct_good",
        providerId: "github-copilot-acct-acct_good",
        label: "Good",
        githubUsername: "good",
        plan: "free",
        capabilityState: "user-declared",
        lifecycleState: "active",
        addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
      });
    }, tempDir);

    const recovered = await readJson(accountsPath);
    assert.equal(recovered.accounts.length, 1);

    const entries = await fs.readdir(tempDir);
    assert.ok(entries.some((entry) => entry.startsWith("copilot-accounts.json.corrupt-")));
  } finally {
    await cleanupDir(tempDir);
  }
});

test("secrets with invalid optional token fields are quarantined and recovered", async () => {
  const tempDir = await makeTempDir();

  try {
    const { loadSecrets, updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);

    const secretsPath = path.join(tempDir, "copilot-secrets.json");
    await writeJson(secretsPath, {
      version: 1,
      secrets: [
        {
          accountId: "acct_bad",
          githubOAuthToken: "github-token",
          copilotAccessTokenExpiresAt: "not-a-date",
        },
      ],
    });

    const loaded = await loadSecrets(tempDir);
    assert.deepEqual(loaded, { version: 1, secrets: [] });

    await updateSecrets((file) => {
      file.secrets.push({
        accountId: "acct_good",
        githubOAuthToken: "github-token",
        copilotAccessToken: "copilot-token",
        copilotAccessTokenExpiresAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
      });
    }, tempDir);

    const recovered = await readJson(secretsPath);
    assert.equal(recovered.secrets.length, 1);
  } finally {
    await cleanupDir(tempDir);
  }
});

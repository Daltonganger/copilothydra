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
    await cleanupDir(tempDir);
  }
});

test("corrupt secrets file is quarantined and replaced with empty state on next write", async () => {
  const tempDir = await makeTempDir();

  try {
    
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
    await cleanupDir(tempDir);
  }
});

test("new secrets file is created with 0o600 permissions", async () => {
  if (process.platform === "win32") return; // permissions unsupported on Windows

  const tempDir = await makeTempDir("copilothydra-perms-");

  try {
    const { updateSecrets, getSecretsFilePermissionStatus } = await import(
      `../dist/storage/secrets.js?perms-new=${Date.now()}`
    );

    await updateSecrets((file) => {
      file.secrets.push({ accountId: "acct_perm", githubOAuthToken: "tok" });
    }, tempDir);

    const status = await getSecretsFilePermissionStatus(tempDir);
    assert.equal(status, "ok");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("getSecretsFilePermissionStatus returns insecure for 0o644 secrets file", async () => {
  if (process.platform === "win32") return;

  const tempDir = await makeTempDir("copilothydra-perms-");

  try {
    const { updateSecrets, getSecretsFilePermissionStatus } = await import(
      `../dist/storage/secrets.js?perms-insecure=${Date.now()}`
    );

    // Write a valid secrets file first
    await updateSecrets((file) => {
      file.secrets.push({ accountId: "acct_insecure", githubOAuthToken: "tok2" });
    }, tempDir);

    // Manually set insecure permissions
    const secretsPath = path.join(tempDir, "copilot-secrets.json");
    await fs.chmod(secretsPath, 0o644);

    const status = await getSecretsFilePermissionStatus(tempDir);
    assert.equal(status, "insecure");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("normalizeSecretsFilePermissions fixes 0o644 secrets file back to 0o600", async () => {
  if (process.platform === "win32") return;

  const tempDir = await makeTempDir("copilothydra-perms-");

  try {
    const { updateSecrets, getSecretsFilePermissionStatus, normalizeSecretsFilePermissions } = await import(
      `../dist/storage/secrets.js?perms-normalize=${Date.now()}`
    );

    await updateSecrets((file) => {
      file.secrets.push({ accountId: "acct_norm", githubOAuthToken: "tok3" });
    }, tempDir);

    const secretsPath = path.join(tempDir, "copilot-secrets.json");
    await fs.chmod(secretsPath, 0o644);

    assert.equal(await getSecretsFilePermissionStatus(tempDir), "insecure");

    const fixed = await normalizeSecretsFilePermissions(tempDir);
    assert.equal(fixed, true);
    assert.equal(await getSecretsFilePermissionStatus(tempDir), "ok");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("getSecretsFilePermissionStatus returns missing when no secrets file exists", async () => {
  if (process.platform === "win32") return;

  const tempDir = await makeTempDir("copilothydra-perms-");
  try {
    const { getSecretsFilePermissionStatus } = await import(
      `../dist/storage/secrets.js?perms-missing=${Date.now()}`
    );
    const status = await getSecretsFilePermissionStatus(tempDir);
    assert.equal(status, "missing");
  } finally {
    await cleanupDir(tempDir);
  }
});

test("normalizeSecretsFilePermissions returns false (no-op) when status is already ok", async () => {
  if (process.platform === "win32") return;

  const tempDir = await makeTempDir("copilothydra-perms-");

  try {
    const { updateSecrets, normalizeSecretsFilePermissions } = await import(
      `../dist/storage/secrets.js?perms-noop=${Date.now()}`
    );

    await updateSecrets((file) => {
      file.secrets.push({ accountId: "acct_noop", githubOAuthToken: "tok5" });
    }, tempDir);

    const fixed = await normalizeSecretsFilePermissions(tempDir);
    assert.equal(fixed, false); // already 0o600, nothing to fix
  } finally {
    await cleanupDir(tempDir);
  }
});

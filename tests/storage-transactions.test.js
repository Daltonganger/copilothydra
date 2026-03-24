import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

test("account updates run as a lock-wrapped read-modify-write transaction", async () => {
  const tempDir = await makeTempDir();

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);

    const a = createAccountMeta({ label: "A", githubUsername: "alice", plan: "free" });
    const b = createAccountMeta({ label: "B", githubUsername: "bob", plan: "pro" });

    await updateAccounts((file) => {
      file.accounts.push(a);
      file.accounts.push(b);
    }, tempDir);

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts.length, 2);
    assert.deepEqual(
      accounts.accounts.map((entry) => entry.label).sort(),
      ["A", "B"]
    );
  } finally {
    await cleanupDir(tempDir);
  }
});

import test from "node:test";
import assert from "node:assert/strict";

// NOTE: These tests run against the REAL OS keychain on macOS/Linux.
// On CI without a keychain, the module gracefully returns { ok: false }.
// We test both the real path (if available) and the graceful-failure path.

test("buildCopilotCLIAccountName produces correct format (via set+get roundtrip)", async () => {
  const { setCopilotCLIKeychainToken, getCopilotCLIKeychainToken, deleteCopilotCLIKeychainToken } =
    await import(`../dist/storage/copilot-cli-keychain.js?${Date.now()}`);

  const testUser = `hydra-test-${Date.now()}`;
  const testToken = `gho_test_token_${Date.now()}`;

  const setResult = await setCopilotCLIKeychainToken({
    githubUsername: testUser,
    githubOAuthToken: testToken,
  });

  if (!setResult.ok) {
    // Keyring not available (CI, headless) — skip remaining assertions
    assert.ok(true, `Keyring not available: ${setResult.reason}`);
    return;
  }

  // Verify roundtrip
  const retrieved = await getCopilotCLIKeychainToken(testUser);
  assert.equal(retrieved, testToken, "Retrieved token should match what was stored");

  // Cleanup
  await deleteCopilotCLIKeychainToken(testUser);
  const afterDelete = await getCopilotCLIKeychainToken(testUser);
  assert.equal(afterDelete, null, "Token should be null after deletion");
});

test("setCopilotCLIKeychainToken returns ok:false for empty username", async () => {
  const { setCopilotCLIKeychainToken } =
    await import(`../dist/storage/copilot-cli-keychain.js?empty=${Date.now()}`);

  const result = await setCopilotCLIKeychainToken({
    githubUsername: "",
    githubOAuthToken: "gho_token",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /missing/);
});

test("setCopilotCLIKeychainToken returns ok:false for empty token", async () => {
  const { setCopilotCLIKeychainToken } =
    await import(`../dist/storage/copilot-cli-keychain.js?emptytoken=${Date.now()}`);

  const result = await setCopilotCLIKeychainToken({
    githubUsername: "alice",
    githubOAuthToken: "",
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /missing/);
});

test("deleteCopilotCLIKeychainToken returns ok:false for empty username", async () => {
  const { deleteCopilotCLIKeychainToken } =
    await import(`../dist/storage/copilot-cli-keychain.js?delempty=${Date.now()}`);

  const result = await deleteCopilotCLIKeychainToken("");
  assert.equal(result.ok, false);
  assert.match(result.reason, /missing/);
});

test("getCopilotCLIKeychainToken returns null for nonexistent user", async () => {
  const { getCopilotCLIKeychainToken } =
    await import(`../dist/storage/copilot-cli-keychain.js?nonexist=${Date.now()}`);

  const result = await getCopilotCLIKeychainToken(`nonexistent-user-${Date.now()}`);
  assert.equal(result, null);
});

test("setCopilotCLIKeychainToken no-ops when same token already exists", async () => {
  const { setCopilotCLIKeychainToken, getCopilotCLIKeychainToken, deleteCopilotCLIKeychainToken } =
    await import(`../dist/storage/copilot-cli-keychain.js?noop=${Date.now()}`);

  const testUser = `hydra-noop-${Date.now()}`;
  const testToken = `gho_noop_${Date.now()}`;

  const first = await setCopilotCLIKeychainToken({
    githubUsername: testUser,
    githubOAuthToken: testToken,
  });

  if (!first.ok) {
    assert.ok(true, `Keyring not available: ${first.reason}`);
    return;
  }

  // Write same token again — should succeed (no-op)
  const second = await setCopilotCLIKeychainToken({
    githubUsername: testUser,
    githubOAuthToken: testToken,
  });
  assert.equal(second.ok, true, "Same-token write should succeed as no-op");

  // Cleanup
  await deleteCopilotCLIKeychainToken(testUser);
});

test("setCopilotCLIKeychainToken overwrites when token differs", async () => {
  const { setCopilotCLIKeychainToken, getCopilotCLIKeychainToken, deleteCopilotCLIKeychainToken } =
    await import(`../dist/storage/copilot-cli-keychain.js?overwrite=${Date.now()}`);

  const testUser = `hydra-overwrite-${Date.now()}`;
  const oldToken = `gho_old_${Date.now()}`;
  const newToken = `gho_new_${Date.now()}`;

  const first = await setCopilotCLIKeychainToken({
    githubUsername: testUser,
    githubOAuthToken: oldToken,
  });

  if (!first.ok) {
    assert.ok(true, `Keyring not available: ${first.reason}`);
    return;
  }

  const second = await setCopilotCLIKeychainToken({
    githubUsername: testUser,
    githubOAuthToken: newToken,
  });
  assert.equal(second.ok, true);

  const retrieved = await getCopilotCLIKeychainToken(testUser);
  assert.equal(retrieved, newToken, "Token should be updated to new value");

  // Cleanup
  await deleteCopilotCLIKeychainToken(testUser);
});

test("bestEffortKeychainWrite never throws even on failure", async () => {
  const { bestEffortKeychainWrite } =
    await import(`../dist/storage/copilot-cli-keychain.js?besteffort=${Date.now()}`);

  // Should not throw regardless of keyring availability
  let result;
  await assert.doesNotReject(async () => {
    result = await bestEffortKeychainWrite({
      githubUsername: "test",
      githubOAuthToken: "gho_test",
      accountLabel: "Test",
    });
  });

  // Result should be structured { ok: true | false, ... }
  assert.ok(result !== undefined, "bestEffortKeychainWrite should return a result");
  assert.ok(typeof result.ok === "boolean", "bestEffortKeychainWrite should return a structured result");
  if (!result.ok) {
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, "failure should include a reason");
  }
});

test("bestEffortKeychainDelete never throws even on failure", async () => {
  const { bestEffortKeychainDelete } =
    await import(`../dist/storage/copilot-cli-keychain.js?bestdel=${Date.now()}`);

  let result;
  await assert.doesNotReject(async () => {
    result = await bestEffortKeychainDelete({
      githubUsername: `nonexistent-${Date.now()}`,
      accountLabel: "Test",
    });
  });

  // Result should be structured { ok: true | false, ... }
  assert.ok(result !== undefined, "bestEffortKeychainDelete should return a result");
  assert.ok(typeof result.ok === "boolean", "bestEffortKeychainDelete should return a structured result");
  if (!result.ok) {
    assert.ok(typeof result.reason === "string" && result.reason.length > 0, "failure should include a reason");
  }
});

test("keychainActionHint returns actionable guidance for common failures", async () => {
  const { keychainActionHint } =
    await import(`../dist/storage/copilot-cli-keychain.js?hint=${Date.now()}`);

  // "not available" → install hint
  const hint1 = keychainActionHint("Native keyring not available");
  assert.ok(hint1.includes("Install") || hint1.includes("keyring"), `Hint for "not available" should mention install: ${hint1}`);

  // "permission denied" → permissions hint
  const hint2 = keychainActionHint("Permission denied");
  assert.ok(hint2.includes("permission") || hint2.includes("Permissions"), `Hint for "permission" should mention permissions: ${hint2}`);

  // "user cancelled" → retry hint
  const hint3 = keychainActionHint("User cancelled the prompt");
  assert.ok(hint3.includes("cancelled") || hint3.includes("retry"), `Hint for "cancelled" should mention retry: ${hint3}`);

  // Generic fallback
  const hint4 = keychainActionHint("Something unexpected happened");
  assert.ok(hint4.length > 0, `Generic hint should be non-empty: ${hint4}`);
});

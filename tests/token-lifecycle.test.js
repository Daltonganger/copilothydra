import test from "node:test";
import assert from "node:assert/strict";

test("runSerializedTokenLifecycle serializes same-account operations in order", async () => {
  const tokenState = await import(`../dist/auth/token-state.js?${Date.now()}`);

  const steps = [];

  await Promise.all([
    tokenState.runSerializedTokenLifecycle("acct_serial", async () => {
      steps.push("a:start");
      await new Promise((resolve) => setTimeout(resolve, 25));
      steps.push("a:end");
    }),
    tokenState.runSerializedTokenLifecycle("acct_serial", async () => {
      steps.push("b:start");
      steps.push("b:end");
    }),
  ]);

  assert.deepEqual(steps, ["a:start", "a:end", "b:start", "b:end"]);
});

test("runSerializedTokenLifecycle allows different accounts to proceed independently", async () => {
  const tokenState = await import(`../dist/auth/token-state.js?${Date.now()}`);

  const started = [];

  await Promise.all([
    tokenState.runSerializedTokenLifecycle("acct_one", async () => {
      started.push("one");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }),
    tokenState.runSerializedTokenLifecycle("acct_two", async () => {
      started.push("two");
    }),
  ]);

  assert.equal(started.length, 2);
  assert.ok(started.includes("one"));
  assert.ok(started.includes("two"));
});

test("runSingleFlightTokenRecovery coalesces same-account recovery work", async () => {
  const tokenState = await import(`../dist/auth/token-state.js?${Date.now()}`);

  let calls = 0;
  const [a, b] = await Promise.all([
    tokenState.runSingleFlightTokenRecovery("acct_recover", async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {
        accountId: "acct_recover",
        githubOAuthToken: "token-recovered",
        expiresAt: 0,
        setAt: Date.now(),
      };
    }),
    tokenState.runSingleFlightTokenRecovery("acct_recover", async () => {
      calls += 1;
      return {
        accountId: "acct_recover",
        githubOAuthToken: "token-duplicate",
        expiresAt: 0,
        setAt: Date.now(),
      };
    }),
  ]);

  assert.equal(calls, 1);
  assert.equal(a.githubOAuthToken, "token-recovered");
  assert.equal(b.githubOAuthToken, "token-recovered");
});

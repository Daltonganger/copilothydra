import test from "node:test";
import assert from "node:assert/strict";

test("concurrent fetches across two accounts keep Authorization isolated per provider", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const tokenState = await import("../dist/auth/token-state.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_a",
      providerId: "github-copilot-acct-acct_a",
      label: "A",
      githubUsername: "user-a",
      plan: "free",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
    {
      id: "acct_b",
      providerId: "github-copilot-acct-acct_b",
      label: "B",
      githubUsername: "user-b",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const loaderA = await buildAuthLoader("acct_a", "github-copilot-acct-acct_a")(
    async () => ({ type: "oauth", refresh: "token-a", access: "token-a", expires: 0 }),
    { id: "github-copilot-acct-acct_a" },
  );
  const loaderB = await buildAuthLoader("acct_b", "github-copilot-acct-acct_b")(
    async () => ({ type: "oauth", refresh: "token-b", access: "token-b", expires: 0 }),
    { id: "github-copilot-acct-acct_b" },
  );

  const originalFetch = globalThis.fetch;
  const authByUrl = new Map();
  globalThis.fetch = async (request, init) => {
    const url = String(request);
    authByUrl.set(url, init?.headers?.Authorization ?? init?.headers?.authorization);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response("ok", { status: 200 });
  };

  try {
    const [a, b] = await Promise.all([
      loaderA.fetch?.("https://example.com/a"),
      loaderB.fetch?.("https://example.com/b"),
    ]);

    assert.equal(a?.status, 200);
    assert.equal(b?.status, 200);
    assert.equal(authByUrl.get("https://example.com/a"), "Bearer token-a");
    assert.equal(authByUrl.get("https://example.com/b"), "Bearer token-b");
    assert.equal(routing.getInFlightCount("acct_a"), 0);
    assert.equal(routing.getInFlightCount("acct_b"), 0);

    const snapshot = tokenState.getTokenIsolationSnapshot();
    assert.equal(snapshot.length >= 2, true);
    const acctA = snapshot.find((entry) => entry.accountId === "acct_a");
    const acctB = snapshot.find((entry) => entry.accountId === "acct_b");
    assert.equal(acctA?.hasToken, true);
    assert.equal(acctB?.hasToken, true);
    assert.equal(acctA?.recoveryInFlight, false);
    assert.equal(acctB?.recoveryInFlight, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("single-flight recovery stays isolated per account under concurrent recovery", async () => {
  const tokenState = await import("../dist/auth/token-state.js");

  let callsA = 0;
  let callsB = 0;

  const [resultA1, resultA2, resultB] = await Promise.all([
    tokenState.runSingleFlightTokenRecovery("acct_a", async () => {
      callsA += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { accountId: "acct_a", githubOAuthToken: "token-a", expiresAt: 0, setAt: Date.now() };
    }),
    tokenState.runSingleFlightTokenRecovery("acct_a", async () => {
      callsA += 1;
      return { accountId: "acct_a", githubOAuthToken: "token-a-2", expiresAt: 0, setAt: Date.now() };
    }),
    tokenState.runSingleFlightTokenRecovery("acct_b", async () => {
      callsB += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { accountId: "acct_b", githubOAuthToken: "token-b", expiresAt: 0, setAt: Date.now() };
    }),
  ]);

  assert.equal(callsA, 1);
  assert.equal(callsB, 1);
  assert.equal(resultA1.githubOAuthToken, "token-a");
  assert.equal(resultA2.githubOAuthToken, "token-a");
  assert.equal(resultB.githubOAuthToken, "token-b");

  const snapshot = tokenState.getTokenIsolationSnapshot();
  const acctA = snapshot.find((entry) => entry.accountId === "acct_a");
  const acctB = snapshot.find((entry) => entry.accountId === "acct_b");
  assert.equal(acctA?.recoveryInFlight, false);
  assert.equal(acctB?.recoveryInFlight, false);
});

import test from "node:test";
import assert from "node:assert/strict";

test("auth loader fetch resolves provider routing and injects routed token header", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const tokenState = await import("../dist/auth/token-state.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_loader",
      providerId: "github-copilot-acct-acct_loader",
      label: "Loader",
      githubUsername: "loader",
      plan: "free",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const loader = await buildAuthLoader("acct_loader", "github-copilot-acct-acct_loader")(
    async () => ({ type: "oauth", refresh: "oauth-token", access: "oauth-token", expires: 0 }),
    { id: "github-copilot-acct-acct_loader" },
  );

  const originalFetch = globalThis.fetch;
  let receivedHeaders;

  globalThis.fetch = async (_request, init) => {
    receivedHeaders = init?.headers;
    return new Response("ok", { status: 200 });
  };

  try {
    assert.equal(typeof loader.fetch, "function");
    const response = await loader.fetch?.("https://example.com", { headers: { Existing: "yes" } });
    assert.equal(response?.status, 200);
    assert.deepEqual(receivedHeaders, {
      Existing: "yes",
      Authorization: "Bearer oauth-token",
      "Openai-Intent": "conversation-edits",
    });
    assert.equal(routing.getInFlightCount("acct_loader"), 0);

    const runtime = tokenState.requireActiveTokenState("acct_loader");
    assert.equal(runtime.githubOAuthToken, "oauth-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth loader fails closed and releases lease when routed token is missing", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_missing",
      providerId: "github-copilot-acct-acct_missing",
      label: "Missing",
      githubUsername: "missing",
      plan: "free",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  let currentAuth = { type: "oauth", refresh: "first", access: "first", expires: 0 };
  const routedLoader = await buildAuthLoader("acct_missing", "github-copilot-acct-acct_missing")(
    async () => currentAuth,
    { id: "github-copilot-acct-acct_missing" },
  );

  currentAuth = undefined;

  await assert.rejects(routedLoader.fetch?.("https://example.com", undefined), /No oauth token available/);

  assert.equal(routing.getInFlightCount("acct_missing"), 0);
});

test("auth loader handles concurrent fetches on one account without leaking leases", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_parallel",
      providerId: "github-copilot-acct-acct_parallel",
      label: "Parallel",
      githubUsername: "parallel",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  let getAuthCalls = 0;
  const loader = await buildAuthLoader("acct_parallel", "github-copilot-acct-acct_parallel")(
    async () => {
      getAuthCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { type: "oauth", refresh: `oauth-token-${getAuthCalls}`, access: `oauth-token-${getAuthCalls}`, expires: 0 };
    },
    { id: "github-copilot-acct-acct_parallel" },
  );

  const originalFetch = globalThis.fetch;
  const seenAuth = [];
  globalThis.fetch = async (_request, init) => {
    seenAuth.push(init?.headers?.Authorization ?? init?.headers?.authorization);
    return new Response("ok", { status: 200 });
  };

  try {
    const [a, b] = await Promise.all([
      loader.fetch?.("https://example.com/a"),
      loader.fetch?.("https://example.com/b"),
    ]);

    assert.equal(a?.status, 200);
    assert.equal(b?.status, 200);
    assert.equal(routing.getInFlightCount("acct_parallel"), 0);
    assert.equal(seenAuth.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth loader retries one routed recovery when initial token state is expired", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_recovery",
      providerId: "github-copilot-acct-acct_recovery",
      label: "Recovery",
      githubUsername: "recovery",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  let getAuthCalls = 0;
  const expired = Math.floor(Date.now() / 1000) - 60;
  const loader = await buildAuthLoader("acct_recovery", "github-copilot-acct-acct_recovery")(
    async () => {
      getAuthCalls += 1;
      if (getAuthCalls <= 2) {
        return { type: "oauth", refresh: "expired-token", access: "expired-token", expires: expired };
      }
      return { type: "oauth", refresh: "fresh-token", access: "fresh-token", expires: 0 };
    },
    { id: "github-copilot-acct-acct_recovery" },
  );

  const originalFetch = globalThis.fetch;
  let authorization;
  globalThis.fetch = async (_request, init) => {
    authorization = init?.headers?.Authorization ?? init?.headers?.authorization;
    return new Response("ok", { status: 200 });
  };

  try {
    const response = await loader.fetch?.("https://example.com/recovery");
    assert.equal(response?.status, 200);
    assert.equal(authorization, "Bearer fresh-token");
    assert.equal(routing.getInFlightCount("acct_recovery"), 0);
    assert.equal(getAuthCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("auth loader fails closed when provider ownership no longer matches the loader account", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_other",
      providerId: "github-copilot-acct-acct_expected",
      label: "Other",
      githubUsername: "other",
      plan: "free",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const loader = await buildAuthLoader("acct_expected", "github-copilot-acct-acct_expected")(
    async () => ({ type: "oauth", refresh: "oauth-token", access: "oauth-token", expires: 0 }),
    { id: "github-copilot-acct-acct_expected" },
  );

  await assert.rejects(
    loader.fetch?.("https://example.com/ownership"),
    /Routing ownership mismatch/
  );

  assert.equal(routing.getInFlightCount("acct_other"), 0);
});

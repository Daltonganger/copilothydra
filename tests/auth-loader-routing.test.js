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

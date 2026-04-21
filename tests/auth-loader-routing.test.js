import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

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
    receivedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response("ok", { status: 200 });
  };

  try {
    assert.equal(typeof loader.fetch, "function");
    assert.equal(loader.apiKey, undefined);
    const response = await loader.fetch?.("https://example.com", { headers: { Existing: "yes" } });
    assert.equal(response?.status, 200);
    assert.deepEqual(receivedHeaders, {
      existing: "yes",
      "openai-intent": "conversation-edits",
      authorization: "Bearer oauth-token",
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
    seenAuth.push(new Headers(init?.headers).get("authorization"));
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

test("auth loader does not inspect successful response bodies for mismatch detection", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_success_body",
      providerId: "github-copilot-acct-acct_success_body",
      label: "SuccessBody",
      githubUsername: "successbody",
      plan: "free",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const loader = await buildAuthLoader("acct_success_body", "github-copilot-acct-acct_success_body")(
    async () => ({ type: "oauth", refresh: "oauth-token", access: "oauth-token", expires: 0 }),
    { id: "github-copilot-acct-acct_success_body" },
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    status: 200,
    headers: { get: () => "text/event-stream" },
    clone() {
      throw new Error("clone should not be called for successful responses");
    },
  });

  try {
    const response = await loader.fetch?.("https://example.com/stream");
    assert.equal(response?.status, 200);
    assert.equal(routing.getInFlightCount("acct_success_body"), 0);
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
    authorization = new Headers(init?.headers).get("authorization");
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

test("auth loader overwrites placeholder Authorization headers before fetch", async () => {
  const routing = await import("../dist/routing/provider-account-map.js");
  const { buildAuthLoader } = await import("../dist/auth/loader.js");

  routing.registerAccounts([
    {
      id: "acct_headers",
      providerId: "github-copilot-acct-acct_headers",
      label: "Headers",
      githubUsername: "headers",
      plan: "student",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date("2026-03-24T00:00:00.000Z").toISOString(),
    },
  ]);

  const loader = await buildAuthLoader("acct_headers", "github-copilot-acct-acct_headers")(
    async () => ({ type: "oauth", refresh: "oauth-token", access: "oauth-token", expires: 0 }),
    { id: "github-copilot-acct-acct_headers" },
  );

  const originalFetch = globalThis.fetch;
  let authorization;
  globalThis.fetch = async (_request, init) => {
    authorization = new Headers(init?.headers).get("authorization");
    return new Response("ok", { status: 200 });
  };

  try {
    const response = await loader.fetch?.("https://example.com/headers", {
      headers: new Headers({ Authorization: "Bearer copilothydra-managed" }),
    });
    assert.equal(response?.status, 200);
    assert.equal(authorization, "Bearer oauth-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hydra Responses parity normalizes delta-first text chunks and closes once on flush", async () => {
  const { withHydraCopilotResponsesParity } = await import("../dist/sdk/hydra-copilot-provider.js");

  const wrappedModel = withHydraCopilotResponsesParity({
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "msg-ignored" });
            controller.enqueue({ type: "text-delta", id: "item-123", delta: "hello" });
            controller.enqueue({ type: "text-end", id: "msg-ignored" });
            controller.close();
          },
        }),
      };
    },
  });

  const result = await wrappedModel.doStream({});
  const chunks = await Array.fromAsync(result.stream);
  assert.deepEqual(chunks, [
    { type: "text-start", id: "item-123" },
    { type: "text-delta", id: "item-123", delta: "hello" },
    { type: "text-end", id: "item-123" },
  ]);
});

test("Hydra Responses parity ignores message-boundary markers and keeps one text part across a stream", async () => {
  const { withHydraCopilotResponsesParity } = await import("../dist/sdk/hydra-copilot-provider.js");

  const wrappedModel = withHydraCopilotResponsesParity({
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "msg-a" });
            controller.enqueue({ type: "text-delta", id: "item-abc", delta: "In" });
            controller.enqueue({ type: "text-start", id: "msg-b" });
            controller.enqueue({ type: "text-delta", id: "item-abc", delta: " Nootdorp" });
            controller.enqueue({ type: "text-end", id: "msg-b" });
            controller.enqueue({ type: "text-delta", id: "item-def", delta: " Regen" });
            controller.enqueue({ type: "text-end", id: "msg-c" });
            controller.close();
          },
        }),
      };
    },
  });

  const result = await wrappedModel.doStream({});
  const chunks = await Array.fromAsync(result.stream);
  assert.deepEqual(chunks, [
    { type: "text-start", id: "item-abc" },
    { type: "text-delta", id: "item-abc", delta: "In" },
    { type: "text-delta", id: "item-abc", delta: " Nootdorp" },
    { type: "text-delta", id: "item-abc", delta: " Regen" },
    { type: "text-end", id: "item-abc" },
  ]);
});

test("Hydra Responses parity keeps one active text part even when upstream delta ids vary", async () => {
  const { withHydraCopilotResponsesParity } = await import("../dist/sdk/hydra-copilot-provider.js");

  const wrappedModel = withHydraCopilotResponsesParity({
    async doStream() {
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-delta", id: "item-1", delta: "Waarom " });
            controller.enqueue({ type: "text-delta", id: "item-2", delta: "neemt " });
            controller.enqueue({ type: "text-delta", id: "item-3", delta: "een wolk" });
            controller.close();
          },
        }),
      };
    },
  });

  const result = await wrappedModel.doStream({});
  const chunks = await Array.fromAsync(result.stream);
  assert.deepEqual(chunks, [
    { type: "text-start", id: "item-1" },
    { type: "text-delta", id: "item-1", delta: "Waarom " },
    { type: "text-delta", id: "item-1", delta: "neemt " },
    { type: "text-delta", id: "item-1", delta: "een wolk" },
    { type: "text-end", id: "item-1" },
  ]);
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

test("auth loader marks account mismatch on 403 entitlement rejection", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const stamp = Date.now();
    const { createAccountMeta } = await import(`../dist/account.js?${stamp}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${stamp}`);
    const routing = await import("../dist/routing/provider-account-map.js");
    const { buildAuthLoader } = await import("../dist/auth/loader.js");

    const account = createAccountMeta({
      label: "Mismatch",
      githubUsername: "mismatch",
      plan: "pro",
    });
    await upsertAccount(account, tempDir);

    routing.registerAccounts([account]);

    const loader = await buildAuthLoader(account.id, account.providerId)(
      async () => ({ type: "oauth", refresh: "oauth-token", access: "oauth-token", expires: 0 }),
      { id: account.providerId },
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ message: "Model not enabled for your plan" }),
      { status: 403, headers: { "content-type": "application/json" } },
    );

    try {
      await assert.rejects(
        loader.fetch?.("https://example.com/chat", {
          method: "POST",
          body: JSON.stringify({ model: "o1" }),
          headers: { "content-type": "application/json" },
        }),
        /Capability mismatch detected/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts[0].capabilityState, "mismatch");
    assert.equal(accounts.accounts[0].mismatchModelId, "o1");
    assert.equal(accounts.accounts[0].mismatchSuggestedPlan, undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

test("auth loader marks account mismatch on 400 unsupported-model rejection", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const stamp = Date.now();
    const { createAccountMeta } = await import(`../dist/account.js?${stamp}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${stamp}`);
    const routing = await import("../dist/routing/provider-account-map.js");
    const { buildAuthLoader } = await import("../dist/auth/loader.js");

    const account = createAccountMeta({
      label: "Student",
      githubUsername: "student",
      plan: "student",
    });
    await upsertAccount(account, tempDir);

    routing.registerAccounts([account]);

    const loader = await buildAuthLoader(account.id, account.providerId)(
      async () => ({ type: "oauth", refresh: "oauth-token", access: "oauth-token", expires: 0 }),
      { id: account.providerId },
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ message: "The requested model is not supported" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );

    try {
      await assert.rejects(
        loader.fetch?.("https://example.com/chat", {
          method: "POST",
          body: JSON.stringify({ model: "gemini-3.1-pro" }),
          headers: { "content-type": "application/json" },
        }),
        /Capability mismatch detected/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts[0].capabilityState, "mismatch");
    assert.equal(accounts.accounts[0].mismatchModelId, "gemini-3.1-pro");
    assert.equal(accounts.accounts[0].mismatchSuggestedPlan, undefined);
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

test("auth loader only suggests a stricter plan when the rejected model was part of declared exposure", async () => {
  const tempDir = await makeTempDir();
  process.env.OPENCODE_CONFIG_DIR = tempDir;

  try {
    const stamp = Date.now();
    const { createAccountMeta } = await import(`../dist/account.js?${stamp}`);
    const { upsertAccount } = await import(`../dist/storage/accounts.js?${stamp}`);
    const routing = await import("../dist/routing/provider-account-map.js");
    const { buildAuthLoader } = await import("../dist/auth/loader.js");

    const account = createAccountMeta({
      label: "Pro",
      githubUsername: "pro-user",
      plan: "pro",
    });
    await upsertAccount(account, tempDir);

    routing.registerAccounts([account]);

    const loader = await buildAuthLoader(account.id, account.providerId)(
      async () => ({ type: "oauth", refresh: "oauth-token", access: "oauth-token", expires: 0 }),
      { id: account.providerId },
    );

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(
      JSON.stringify({ message: "The requested model is not supported" }),
      { status: 400, headers: { "content-type": "application/json" } },
    );

    try {
      await assert.rejects(
        loader.fetch?.("https://example.com/chat", {
          method: "POST",
          body: JSON.stringify({ model: "gpt-5.4" }),
          headers: { "content-type": "application/json" },
        }),
        /Capability mismatch detected/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
    assert.equal(accounts.accounts[0].capabilityState, "mismatch");
    assert.equal(accounts.accounts[0].mismatchModelId, "gpt-5.4");
    assert.equal(accounts.accounts[0].mismatchSuggestedPlan, "student");
  } finally {
    delete process.env.OPENCODE_CONFIG_DIR;
    await cleanupDir(tempDir);
  }
});

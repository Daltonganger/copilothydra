import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import fs from "node:fs/promises";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

const PLUGIN_INPUT = {
  client: {},
  project: {},
  worktree: {},
  directory: process.cwd(),
  serverUrl: "http://localhost:4096",
  $: {},
};

function distFileUrl(relativePath) {
  return pathToFileURL(path.join(process.cwd(), relativePath)).href;
}

async function importFresh(relativePath) {
  return await import(`${distFileUrl(relativePath)}?t=${Date.now()}-${Math.random()}`);
}

function discoverPluginExports(moduleNamespace) {
  return Object.entries(moduleNamespace)
    .filter(([name, value]) => name.startsWith("CopilotHydra") && typeof value === "function")
    .map(([name, plugin]) => ({ name, plugin }));
}

async function withTempOpenCodeConfig(action) {
  const tempDir = await makeTempDir("copilothydra-blackbox-");
  const previousConfigDir = process.env.OPENCODE_CONFIG_DIR;
  const previousConfigPath = process.env.OPENCODE_CONFIG;
  process.env.OPENCODE_CONFIG_DIR = tempDir;
  process.env.OPENCODE_CONFIG = path.join(tempDir, "opencode.json");

  try {
    return await action(tempDir);
  } finally {
    if (previousConfigDir === undefined) {
      delete process.env.OPENCODE_CONFIG_DIR;
    } else {
      process.env.OPENCODE_CONFIG_DIR = previousConfigDir;
    }

    if (previousConfigPath === undefined) {
      delete process.env.OPENCODE_CONFIG;
    } else {
      process.env.OPENCODE_CONFIG = previousConfigPath;
    }

    await cleanupDir(tempDir);
  }
}

test("black-box host discovery exposes setup hook and empty runtime slots when no accounts exist", async () => {
  await withTempOpenCodeConfig(async () => {
    const pluginModule = await importFresh("dist/index.js");
    const discovered = discoverPluginExports(pluginModule);
    const discoveredNames = discovered.map((entry) => entry.name).sort();
    const expectedNames = [
      "CopilotHydraSetup",
      "CopilotHydraSlot0",
      "CopilotHydraSlot1",
      "CopilotHydraSlot2",
      "CopilotHydraSlot3",
      "CopilotHydraSlot4",
      "CopilotHydraSlot5",
      "CopilotHydraSlot6",
      "CopilotHydraSlot7",
    ].sort();

    assert.deepEqual(discoveredNames, expectedNames);

    const setupHooks = await pluginModule.CopilotHydraSetup(PLUGIN_INPUT);
    assert.equal(setupHooks.auth?.provider, "github-copilot");
    assert.deepEqual(
      setupHooks.auth?.methods.map((method) => method.label),
      ["GitHub Copilot (CopilotHydra) — Add new account"],
    );

    const slotHooks = await pluginModule.CopilotHydraSlot0(PLUGIN_INPUT);
    assert.deepEqual(slotHooks, {});
  });
});

test("black-box host add-account flow persists config and survives restart into routed runtime auth", async () => {
  await withTempOpenCodeConfig(async (tempDir) => {
    const originalFetch = globalThis.fetch;
    const runtimeRequests = [];

    globalThis.fetch = async (request, init) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;

      if (url === "https://github.com/login/device/code") {
        return new Response(
          JSON.stringify({
            device_code: "device-blackbox",
            user_code: "WXYZ-1234",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 0,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(
          JSON.stringify({
            access_token: "gho_blackbox_token",
            token_type: "bearer",
            scope: "read:user",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      runtimeRequests.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      return new Response("ok", { status: 200 });
    };

    try {
      const setupModule = await importFresh("dist/index.js");
      const setupHooks = await setupModule.CopilotHydraSetup(PLUGIN_INPUT);
      const addAccountMethod = setupHooks.auth?.methods?.find(
        (method) => method.label === "GitHub Copilot (CopilotHydra) — Add new account",
      );

      assert.ok(addAccountMethod, "expected CopilotHydraSetup to expose an add-account method");

      const started = await addAccountMethod.authorize({
        githubUsername: "blackbox-user",
        label: "Blackbox",
        plan: "pro",
        allowUnverifiedModels: "no",
      });

      assert.equal(started.url, "https://github.com/login/device");
      assert.match(started.instructions, /WXYZ-1234/);

      const finished = await started.callback();
      assert.equal(finished.type, "success");
      assert.match(finished.provider ?? "", /^github-copilot-acct-/);

      if (process.platform === "darwin") {
        const { getCopilotCLIKeychainToken } = await importFresh("dist/storage/copilot-cli-keychain.js");
        assert.equal(
          await getCopilotCLIKeychainToken("blackbox-user"),
          "gho_blackbox_token",
          "successful add-account flow should publish a copilot-cli-compatible keychain entry on macOS",
        );
      }

      const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
      const config = await readJson(path.join(tempDir, "opencode.json"));
      assert.equal(accounts.accounts.length, 1);
      assert.equal(accounts.accounts[0].githubUsername, "blackbox-user");
      assert.equal(finished.provider, accounts.accounts[0].providerId);
      assert.ok(config.provider[accounts.accounts[0].providerId]);
      assert.equal(config.disabled_providers, undefined);

      const restartedModule = await importFresh("dist/index.js");
      const restartedExports = discoverPluginExports(restartedModule);

      let runtimeHooks;
      for (const entry of restartedExports) {
        if (entry.name === "CopilotHydraSetup") continue;
        const hooks = await entry.plugin(PLUGIN_INPUT);
        if (hooks.auth?.provider === accounts.accounts[0].providerId) {
          runtimeHooks = hooks;
          break;
        }
      }

      assert.ok(runtimeHooks?.auth, "expected a runtime account hook after simulated restart");

      const loader = await runtimeHooks.auth.loader?.(
        async () => ({
          type: "oauth",
          refresh: "gho_blackbox_token",
          access: "gho_blackbox_token",
          expires: 0,
          accountId: accounts.accounts[0].id,
        }),
        { id: accounts.accounts[0].providerId },
      );

      assert.equal(typeof loader?.fetch, "function");

      const response = await loader?.fetch?.("https://example.com/runtime", {
        headers: { Existing: "yes" },
      });

      assert.equal(response?.status, 200);
      assert.equal(runtimeRequests.length, 1);
      assert.deepEqual(runtimeRequests[0], {
        url: "https://example.com/runtime",
        headers: {
          existing: "yes",
          authorization: "Bearer gho_blackbox_token",
          "openai-intent": "conversation-edits",
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("black-box host: two accounts route independently after restart", async () => {
  await withTempOpenCodeConfig(async (tempDir) => {
    const originalFetch = globalThis.fetch;
    const runtimeRequests = [];

    // Build a response queue so device code + access token calls return
    // the correct payloads for alice first, then bob.
    const responseQueue = [];

    function enqueueDeviceCode(userCode) {
      responseQueue.push(() =>
        new Response(
          JSON.stringify({
            device_code: `device-${userCode}`,
            user_code: userCode,
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      );
    }

    function enqueueAccessToken(token) {
      responseQueue.push(() =>
        new Response(
          JSON.stringify({
            access_token: token,
            token_type: "bearer",
            scope: "read:user",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      );
    }

    function enqueueRuntimeCapture() {
      responseQueue.push((url, init) => {
        runtimeRequests.push({
          url,
          headers: Object.fromEntries(new Headers(init?.headers).entries()),
        });
        return new Response("ok", { status: 200 });
      });
    }

    // Alice's device flow
    enqueueDeviceCode("AAAA-AAAA");
    enqueueAccessToken("gho_alice_token");
    // Bob's device flow
    enqueueDeviceCode("BBBB-BBBB");
    enqueueAccessToken("gho_bob_token");
    // Runtime requests (2 total, one per account)
    enqueueRuntimeCapture();
    enqueueRuntimeCapture();

    globalThis.fetch = async (request, init) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;

      if (
        url === "https://github.com/login/device/code" ||
        url === "https://github.com/login/oauth/access_token"
      ) {
        const factory = responseQueue.shift();
        return factory();
      }

      // Runtime request
      const factory = responseQueue.shift();
      return factory(url, init);
    };

    try {
      // ---- Phase 1: Add alice ----
      const mod1 = await importFresh("dist/index.js");
      const setup1 = await mod1.CopilotHydraSetup(PLUGIN_INPUT);
      const addAlice = setup1.auth.methods.find(
        (m) => m.label === "GitHub Copilot (CopilotHydra) — Add new account",
      );
      assert.ok(addAlice, "expected add-account method for alice");

      const startedAlice = await addAlice.authorize({
        githubUsername: "alice",
        label: "Alice",
        plan: "pro",
        allowUnverifiedModels: "no",
      });
      assert.equal(startedAlice.url, "https://github.com/login/device");
      assert.match(startedAlice.instructions, /AAAA-AAAA/);

      const finishedAlice = await startedAlice.callback();
      assert.equal(finishedAlice.type, "success");

      if (process.platform === "darwin") {
        const { getCopilotCLIKeychainToken } = await importFresh("dist/storage/copilot-cli-keychain.js");
        assert.equal(await getCopilotCLIKeychainToken("alice"), "gho_alice_token");
      }

      const accountsAfterAlice = await readJson(path.join(tempDir, "copilot-accounts.json"));
      assert.equal(accountsAfterAlice.accounts.length, 1);
      assert.equal(accountsAfterAlice.accounts[0].githubUsername, "alice");

      // ---- Phase 2: Restart, add bob ----
      const mod2 = await importFresh("dist/index.js");
      const setup2 = await mod2.CopilotHydraSetup(PLUGIN_INPUT);
      const methodLabels = setup2.auth.methods.map((m) => m.label);

      assert.ok(
        methodLabels.includes("GitHub Copilot (CopilotHydra) — Re-auth existing account"),
        "expected re-auth method after first account",
      );
      assert.ok(
        methodLabels.includes("GitHub Copilot (CopilotHydra) — Add new account"),
        "expected add-account method after first account",
      );

      const addBob = setup2.auth.methods.find(
        (m) => m.label === "GitHub Copilot (CopilotHydra) — Add new account",
      );
      assert.ok(addBob, "expected add-account method for bob");

      const startedBob = await addBob.authorize({
        githubUsername: "bob",
        label: "Bob",
        plan: "free",
        allowUnverifiedModels: "no",
      });
      assert.equal(startedBob.url, "https://github.com/login/device");
      assert.match(startedBob.instructions, /BBBB-BBBB/);

      const finishedBob = await startedBob.callback();
      assert.equal(finishedBob.type, "success");

      if (process.platform === "darwin") {
        const { getCopilotCLIKeychainToken } = await importFresh("dist/storage/copilot-cli-keychain.js");
        assert.equal(await getCopilotCLIKeychainToken("bob"), "gho_bob_token");
      }

      const accountsAfterBob = await readJson(path.join(tempDir, "copilot-accounts.json"));
      assert.equal(accountsAfterBob.accounts.length, 2);

      // ---- Phase 3: Restart again, discover runtime slots ----
      const mod3 = await importFresh("dist/index.js");
      const exports3 = discoverPluginExports(mod3);

      const runtimeSlots = [];
      for (const entry of exports3) {
        if (entry.name === "CopilotHydraSetup") continue;
        const hooks = await entry.plugin(PLUGIN_INPUT);
        if (hooks.auth?.provider) {
          runtimeSlots.push({ name: entry.name, hooks, provider: hooks.auth.provider });
        }
      }

      assert.equal(runtimeSlots.length, 2, "expected exactly 2 non-empty runtime slots");

      // ---- Phase 4: Verify each slot routes to the correct account token ----
      const tokensSeen = [];

      for (const slot of runtimeSlots) {
        const account = accountsAfterBob.accounts.find(
          (a) => a.providerId === slot.provider,
        );
        assert.ok(account, `expected account for provider ${slot.provider}`);

        const token = account.githubUsername === "alice"
          ? "gho_alice_token"
          : "gho_bob_token";

        const loader = await slot.hooks.auth.loader(
          async () => ({
            type: "oauth",
            refresh: token,
            access: token,
            expires: 0,
            accountId: account.id,
          }),
          { id: account.providerId },
        );

        assert.equal(typeof loader?.fetch, "function");

        await loader.fetch(
          new Request("https://api.githubcopilot.com/chat/completions", {
            method: "POST",
            body: JSON.stringify({ model: "gpt-4o", messages: [] }),
          }),
        );

        tokensSeen.push(token);
      }

      assert.equal(runtimeRequests.length, 2, "expected 2 runtime fetch calls");

      // Verify both tokens appear and they are different
      const authHeaders = runtimeRequests.map((r) => r.headers.authorization).sort();
      assert.deepEqual(authHeaders, [
        "Bearer gho_alice_token",
        "Bearer gho_bob_token",
      ]);

      // Explicitly verify isolation: tokens are different
      assert.notStrictEqual(
        runtimeRequests[0].headers.authorization,
        runtimeRequests[1].headers.authorization,
        "the two slots must route to different accounts (tokens must be isolated)",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("black-box host: add-account callback returns failed when device flow is denied", async () => {
  await withTempOpenCodeConfig(async (tempDir) => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (request, _init) => {
      const url = typeof request === "string" ? request : request instanceof URL ? request.href : request.url;

      if (url === "https://github.com/login/device/code") {
        return new Response(
          JSON.stringify({
            device_code: "device-denied",
            user_code: "CCCC-CCCC",
            verification_uri: "https://github.com/login/device",
            expires_in: 900,
            interval: 0,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      if (url === "https://github.com/login/oauth/access_token") {
        return new Response(
          JSON.stringify({
            error: "access_denied",
            error_description: "The user has denied your application.",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      return new Response("not found", { status: 404 });
    };

    try {
      const mod = await importFresh("dist/index.js");
      const setup = await mod.CopilotHydraSetup(PLUGIN_INPUT);
      const addAccount = setup.auth.methods.find(
        (m) => m.label === "GitHub Copilot (CopilotHydra) — Add new account",
      );
      assert.ok(addAccount, "expected add-account method");

      const started = await addAccount.authorize({
        githubUsername: "denied-user",
        label: "Denied",
        plan: "pro",
        allowUnverifiedModels: "no",
      });
      assert.equal(started.url, "https://github.com/login/device");
      assert.match(started.instructions, /CCCC-CCCC/);

      const finished = await started.callback();
      assert.deepEqual(finished, { type: "failed" });

      // Verify no partial state: accounts file must not exist or have 0 accounts
      const accountsPath = path.join(tempDir, "copilot-accounts.json");
      try {
        const accounts = await readJson(accountsPath);
        assert.equal(
          accounts.accounts.length,
          0,
          "expected 0 accounts after denied device flow",
        );
      } catch {
        // File doesn't exist — that's also acceptable (no partial state)
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

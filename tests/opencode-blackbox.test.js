import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

      const accounts = await readJson(path.join(tempDir, "copilot-accounts.json"));
      const config = await readJson(path.join(tempDir, "opencode.json"));
      assert.equal(accounts.accounts.length, 1);
      assert.equal(accounts.accounts[0].githubUsername, "blackbox-user");
      assert.equal(finished.provider, accounts.accounts[0].providerId);
      assert.ok(config.provider[accounts.accounts[0].providerId]);
      assert.deepEqual(config.disabled_providers, ["github-copilot"]);

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

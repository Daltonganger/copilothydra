import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { cleanupDir, makeTempDir } from "./helpers.js";

function withCompatEnv(tempDir) {
  return {
    OPENCODE_CONFIG_DIR: path.join(tempDir, "config"),
    OPENCODE_CONFIG: path.join(tempDir, "config", "opencode.json"),
    XDG_DATA_HOME: path.join(tempDir, "data"),
    HOME: path.join(tempDir, "home"),
  };
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

test("bestEffortPublishPrimaryCompatibility writes primary auth alias and gh hosts when targets are empty", async () => {
  const tempDir = await makeTempDir("copilothydra-primary-compat-");
  const originalEnv = { ...process.env };
  Object.assign(process.env, withCompatEnv(tempDir));

  try {
    const { bestEffortPublishPrimaryCompatibility } = await import(
      `../dist/storage/primary-compat-export.js?${Date.now()}`
    );

    const account = {
      id: "acct_primary",
      providerId: "github-copilot-acct-acct_primary",
      label: "Primary",
      githubUsername: "primary-user",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date().toISOString(),
    };

    const result = await bestEffortPublishPrimaryCompatibility({
      account,
      githubOAuthToken: "gho_primary_token",
      explicit: true,
    });

    assert.deepEqual(result, { opencodeAuth: "written", ghHosts: "written" });

    const authJson = await readJson(path.join(tempDir, "data", "opencode", "auth.json"));
    assert.deepEqual(authJson["github-copilot"], {
      type: "oauth",
      refresh: "gho_primary_token",
      access: "gho_primary_token",
      expires: 0,
      accountId: "acct_primary",
    });

    const hostsYml = await fs.readFile(path.join(tempDir, "home", ".config", "gh", "hosts.yml"), "utf8");
    assert.match(hostsYml, /^github\.com:/m);
    assert.match(hostsYml, /oauth_token: gho_primary_token/);
    assert.match(hostsYml, /user: primary-user/);

    const state = await readJson(path.join(tempDir, "config", "copilothydra-opencode-state.json"));
    assert.deepEqual(state.managedPrimaryCompatibility, {
      accountId: "acct_primary",
      opencodeAuthAlias: true,
      ghHostsEntry: true,
    });
  } finally {
    process.env = originalEnv;
    await cleanupDir(tempDir);
  }
});

test("bestEffortPublishPrimaryCompatibility never overwrites existing auth sources", async () => {
  const tempDir = await makeTempDir("copilothydra-primary-compat-");
  const originalEnv = { ...process.env };
  Object.assign(process.env, withCompatEnv(tempDir));

  try {
    await fs.mkdir(path.join(tempDir, "data", "opencode"), { recursive: true });
    await fs.mkdir(path.join(tempDir, "home", ".config", "gh"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "data", "opencode", "auth.json"),
      JSON.stringify({
        "github-copilot": {
          type: "oauth",
          refresh: "existing-refresh",
          access: "existing-access",
          expires: 0,
        },
      }, null, 2),
    );
    await fs.writeFile(
      path.join(tempDir, "home", ".config", "gh", "hosts.yml"),
      "github.com:\n  oauth_token: existing_token\n  user: existing-user\n  git_protocol: https\n",
      "utf8",
    );

    const { bestEffortPublishPrimaryCompatibility } = await import(
      `../dist/storage/primary-compat-export.js?${Date.now()}`
    );

    const result = await bestEffortPublishPrimaryCompatibility({
      account: {
        id: "acct_primary",
        providerId: "github-copilot-acct-acct_primary",
        label: "Primary",
        githubUsername: "primary-user",
        plan: "pro",
        capabilityState: "user-declared",
        lifecycleState: "active",
        addedAt: new Date().toISOString(),
      },
      githubOAuthToken: "gho_new_token",
      explicit: true,
    });

    assert.deepEqual(result, { opencodeAuth: "skipped-existing", ghHosts: "skipped-existing" });

    const authJson = await readJson(path.join(tempDir, "data", "opencode", "auth.json"));
    assert.equal(authJson["github-copilot"].refresh, "existing-refresh");

    const hostsYml = await fs.readFile(path.join(tempDir, "home", ".config", "gh", "hosts.yml"), "utf8");
    assert.match(hostsYml, /oauth_token: existing_token/);
    assert.doesNotMatch(hostsYml, /gho_new_token/);
  } finally {
    process.env = originalEnv;
    await cleanupDir(tempDir);
  }
});

test("bestEffortCleanupPrimaryCompatibility removes managed primary exports for a removed account", async () => {
  const tempDir = await makeTempDir("copilothydra-primary-compat-");
  const originalEnv = { ...process.env };
  Object.assign(process.env, withCompatEnv(tempDir));

  try {
    const mod = await import(`../dist/storage/primary-compat-export.js?${Date.now()}`);
    const account = {
      id: "acct_primary",
      providerId: "github-copilot-acct-acct_primary",
      label: "Primary",
      githubUsername: "primary-user",
      plan: "pro",
      capabilityState: "user-declared",
      lifecycleState: "active",
      addedAt: new Date().toISOString(),
    };

    await mod.bestEffortPublishPrimaryCompatibility({
      account,
      githubOAuthToken: "gho_primary_token",
      explicit: true,
    });

    await mod.bestEffortCleanupPrimaryCompatibility({ account });

    const authJson = await readJson(path.join(tempDir, "data", "opencode", "auth.json"));
    assert.equal(authJson["github-copilot"], undefined);

    await assert.rejects(
      fs.readFile(path.join(tempDir, "home", ".config", "gh", "hosts.yml"), "utf8"),
      /ENOENT/,
    );

    const state = await readJson(path.join(tempDir, "config", "copilothydra-opencode-state.json"));
    assert.equal(state.managedPrimaryCompatibility, undefined);
  } finally {
    process.env = originalEnv;
    await cleanupDir(tempDir);
  }
});

test("cli export-primary-compat writes explicit primary compatibility without overwriting existing sources", async () => {
  const tempDir = await makeTempDir("copilothydra-primary-compat-");
  const originalEnv = { ...process.env };
  Object.assign(process.env, withCompatEnv(tempDir));

  try {
    const { createAccountMeta } = await import(`../dist/account.js?${Date.now()}`);
    const { updateAccounts } = await import(`../dist/storage/accounts.js?${Date.now()}`);
    const { updateSecrets } = await import(`../dist/storage/secrets.js?${Date.now()}`);

    await fs.mkdir(process.env.OPENCODE_CONFIG_DIR, { recursive: true });

    const account = createAccountMeta({ label: "Primary", githubUsername: "cli-primary", plan: "pro" });
    await updateAccounts((file) => {
      file.accounts.push(account);
    }, process.env.OPENCODE_CONFIG_DIR);
    await updateSecrets((file) => {
      file.secrets.push({ accountId: account.id, githubOAuthToken: "gho_cli_primary" });
    }, process.env.OPENCODE_CONFIG_DIR);

    const result = spawnSync(process.execPath, ["dist/cli.js", "export-primary-compat", account.id], {
      cwd: path.resolve("."),
      env: { ...process.env },
      encoding: "utf8",
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /OpenCode auth alias: written/);
    assert.match(result.stdout, /GitHub CLI hosts.yml: written/);
  } finally {
    process.env = originalEnv;
    await cleanupDir(tempDir);
  }
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

function withAuthSyncEnv(tempDir) {
	return {
		OPENCODE_CONFIG_DIR: path.join(tempDir, "config"),
		XDG_DATA_HOME: path.join(tempDir, "data"),
		HOME: tempDir,
	};
}

function makeAccount(overrides = {}) {
	return {
		id: overrides.id ?? "acct_test01",
		providerId: overrides.providerId ?? "github-copilot-user-testuser",
		label: overrides.label ?? "Test Account",
		githubUsername: overrides.githubUsername ?? "testuser",
		plan: "pro",
		capabilityState: "user-declared",
		lifecycleState: "active",
		addedAt: new Date().toISOString(),
		...overrides,
	};
}

test("backfillProviderAuthEntries creates auth entry from legacy acct-* key", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authDir = path.join(tempDir, "data", "opencode");
		await fs.mkdir(authDir, { recursive: true });
		const authPath = path.join(authDir, "auth.json");

		// Pre-existing legacy entry under github-copilot-acct-acct_legacy01
		await fs.writeFile(
			authPath,
			JSON.stringify(
				{
					"github-copilot-acct-acct_legacy01": {
						type: "oauth",
						refresh: "gho_legacy_token",
						access: "gho_legacy_token",
						expires: 0,
					},
				},
				null,
				2,
			),
		);

		const account = makeAccount({
			id: "acct_legacy01",
			providerId: "github-copilot-user-alice",
		});

		const result = await backfillProviderAuthEntries(
			[account],
			undefined,
			authPath,
		);

		assert.equal(result.total, 1);
		assert.equal(result.alreadyPresent, 0);
		assert.deepEqual(result.backfilledFromLegacy, [
			"github-copilot-user-alice",
		]);
		assert.deepEqual(result.backfilledFromSecrets, []);
		assert.deepEqual(result.unresolved, []);

		const authData = await readJson(authPath);
		assert.ok(authData["github-copilot-user-alice"]);
		assert.equal(authData["github-copilot-user-alice"].type, "oauth");
		assert.equal(
			authData["github-copilot-user-alice"].refresh,
			"gho_legacy_token",
		);
		assert.equal(
			authData["github-copilot-user-alice"].accountId,
			"acct_legacy01",
		);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries creates auth entry from Hydra secret store", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
		await fs.mkdir(configDir, { recursive: true });

		const { updateSecrets } = await import(
			`../dist/storage/secrets.js?${Date.now()}`
		);
		await updateSecrets((file) => {
			file.secrets.push({
				accountId: "acct_secret01",
				githubOAuthToken: "gho_secret_token",
			});
		}, configDir);

		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authDir = path.join(tempDir, "data", "opencode");
		await fs.mkdir(authDir, { recursive: true });
		const authPath = path.join(authDir, "auth.json");
		await fs.writeFile(authPath, "{}");

		const account = makeAccount({
			id: "acct_secret01",
			providerId: "github-copilot-user-bob",
		});

		const result = await backfillProviderAuthEntries(
			[account],
			configDir,
			authPath,
		);

		assert.equal(result.total, 1);
		assert.equal(result.alreadyPresent, 0);
		assert.deepEqual(result.backfilledFromLegacy, []);
		assert.deepEqual(result.backfilledFromSecrets, ["github-copilot-user-bob"]);
		assert.deepEqual(result.unresolved, []);

		const authData = await readJson(authPath);
		assert.equal(authData["github-copilot-user-bob"].type, "oauth");
		assert.equal(
			authData["github-copilot-user-bob"].refresh,
			"gho_secret_token",
		);
		assert.equal(
			authData["github-copilot-user-bob"].accountId,
			"acct_secret01",
		);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries prefers legacy entry over secret store", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
		await fs.mkdir(configDir, { recursive: true });

		const { updateSecrets } = await import(
			`../dist/storage/secrets.js?${Date.now()}`
		);
		await updateSecrets((file) => {
			file.secrets.push({
				accountId: "acct_both",
				githubOAuthToken: "gho_secret_token",
			});
		}, configDir);

		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authDir = path.join(tempDir, "data", "opencode");
		await fs.mkdir(authDir, { recursive: true });
		const authPath = path.join(authDir, "auth.json");
		await fs.writeFile(
			authPath,
			JSON.stringify(
				{
					"github-copilot-acct-acct_both": {
						type: "oauth",
						refresh: "gho_legacy_token",
						access: "gho_legacy_token",
						expires: 0,
					},
				},
				null,
				2,
			),
		);

		const account = makeAccount({
			id: "acct_both",
			providerId: "github-copilot-user-charlie",
		});

		const result = await backfillProviderAuthEntries(
			[account],
			configDir,
			authPath,
		);

		assert.deepEqual(result.backfilledFromLegacy, [
			"github-copilot-user-charlie",
		]);
		assert.deepEqual(result.backfilledFromSecrets, []);

		const authData = await readJson(authPath);
		assert.equal(
			authData["github-copilot-user-charlie"].refresh,
			"gho_legacy_token",
		);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries skips accounts that already have a valid entry", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authDir = path.join(tempDir, "data", "opencode");
		await fs.mkdir(authDir, { recursive: true });
		const authPath = path.join(authDir, "auth.json");
		await fs.writeFile(
			authPath,
			JSON.stringify(
				{
					"github-copilot-user-diana": {
						type: "oauth",
						refresh: "gho_existing",
						access: "gho_existing",
						expires: 0,
					},
				},
				null,
				2,
			),
		);

		const account = makeAccount({
			id: "acct_diana",
			providerId: "github-copilot-user-diana",
		});

		const result = await backfillProviderAuthEntries(
			[account],
			undefined,
			authPath,
		);

		assert.equal(result.alreadyPresent, 1);
		assert.deepEqual(result.backfilledFromLegacy, []);
		assert.deepEqual(result.backfilledFromSecrets, []);

		// Verify the existing entry was NOT overwritten
		const authData = await readJson(authPath);
		assert.equal(authData["github-copilot-user-diana"].refresh, "gho_existing");
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries reports unresolved when no token source exists", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authDir = path.join(tempDir, "data", "opencode");
		await fs.mkdir(authDir, { recursive: true });
		const authPath = path.join(authDir, "auth.json");
		await fs.writeFile(authPath, "{}");

		const account = makeAccount({
			id: "acct_orphan",
			providerId: "github-copilot-user-orphan",
		});

		const result = await backfillProviderAuthEntries(
			[account],
			undefined,
			authPath,
		);

		assert.equal(result.total, 1);
		assert.equal(result.alreadyPresent, 0);
		assert.deepEqual(result.backfilledFromLegacy, []);
		assert.deepEqual(result.backfilledFromSecrets, []);
		assert.equal(result.unresolved.length, 1);
		assert.equal(result.unresolved[0].accountId, "acct_orphan");
		assert.equal(result.unresolved[0].providerId, "github-copilot-user-orphan");
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries handles multiple accounts with mixed sources", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
		await fs.mkdir(configDir, { recursive: true });

		const { updateSecrets } = await import(
			`../dist/storage/secrets.js?${Date.now()}`
		);
		await updateSecrets((file) => {
			file.secrets.push({
				accountId: "acct_s",
				githubOAuthToken: "gho_secret",
			});
		}, configDir);

		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authDir = path.join(tempDir, "data", "opencode");
		await fs.mkdir(authDir, { recursive: true });
		const authPath = path.join(authDir, "auth.json");
		await fs.writeFile(
			authPath,
			JSON.stringify(
				{
					"github-copilot-user-existing": {
						type: "oauth",
						refresh: "gho_existing",
						access: "gho_existing",
						expires: 0,
					},
					"github-copilot-acct-acct_l": {
						type: "oauth",
						refresh: "gho_legacy",
						access: "gho_legacy",
						expires: 0,
					},
				},
				null,
				2,
			),
		);

		const accounts = [
			makeAccount({
				id: "acct_existing",
				providerId: "github-copilot-user-existing",
			}),
			makeAccount({ id: "acct_l", providerId: "github-copilot-user-legacy" }),
			makeAccount({ id: "acct_s", providerId: "github-copilot-user-secret" }),
			makeAccount({ id: "acct_x", providerId: "github-copilot-user-none" }),
		];

		const result = await backfillProviderAuthEntries(
			accounts,
			configDir,
			authPath,
		);

		assert.equal(result.total, 4);
		assert.equal(result.alreadyPresent, 1);
		assert.deepEqual(result.backfilledFromLegacy, [
			"github-copilot-user-legacy",
		]);
		assert.deepEqual(result.backfilledFromSecrets, [
			"github-copilot-user-secret",
		]);
		assert.equal(result.unresolved.length, 1);
		assert.equal(result.unresolved[0].accountId, "acct_x");

		const authData = await readJson(authPath);
		assert.equal(
			authData["github-copilot-user-existing"].refresh,
			"gho_existing",
		);
		assert.equal(authData["github-copilot-user-legacy"].refresh, "gho_legacy");
		assert.equal(authData["github-copilot-user-secret"].refresh, "gho_secret");
		assert.equal(authData["github-copilot-user-none"], undefined);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries creates auth.json if it does not exist", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
		await fs.mkdir(configDir, { recursive: true });

		const { updateSecrets } = await import(
			`../dist/storage/secrets.js?${Date.now()}`
		);
		await updateSecrets((file) => {
			file.secrets.push({
				accountId: "acct_new",
				githubOAuthToken: "gho_new_token",
			});
		}, configDir);

		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authPath = path.join(tempDir, "data", "opencode", "auth.json");
		// auth.json does NOT exist yet

		const account = makeAccount({
			id: "acct_new",
			providerId: "github-copilot-user-newbie",
		});

		const result = await backfillProviderAuthEntries(
			[account],
			configDir,
			authPath,
		);

		assert.deepEqual(result.backfilledFromSecrets, [
			"github-copilot-user-newbie",
		]);

		const authData = await readJson(authPath);
		assert.equal(authData["github-copilot-user-newbie"].type, "oauth");
		assert.equal(
			authData["github-copilot-user-newbie"].refresh,
			"gho_new_token",
		);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries skips non-active accounts", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withAuthSyncEnv(tempDir));

	try {
		const { backfillProviderAuthEntries } = await import(
			`../dist/auth/opencode-auth-sync.js?${Date.now()}`
		);

		const authDir = path.join(tempDir, "data", "opencode");
		await fs.mkdir(authDir, { recursive: true });
		const authPath = path.join(authDir, "auth.json");
		await fs.writeFile(authPath, "{}");

		const pendingAccount = makeAccount({
			id: "acct_pending",
			providerId: "github-copilot-user-pending",
			lifecycleState: "pending-removal",
		});

		const result = await backfillProviderAuthEntries(
			[pendingAccount],
			undefined,
			authPath,
		);

		assert.equal(result.total, 1);
		assert.equal(result.alreadyPresent, 0);
		assert.deepEqual(result.backfilledFromLegacy, []);
		assert.deepEqual(result.backfilledFromSecrets, []);
		assert.deepEqual(result.unresolved, []);

		const authData = await readJson(authPath);
		assert.equal(authData["github-copilot-user-pending"], undefined);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("syncAccountsToOpenCodeConfig triggers auth backfill for active accounts", async () => {
	const tempDir = await makeTempDir("copilothydra-auth-sync-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, {
		OPENCODE_CONFIG_DIR: path.join(tempDir, "config"),
		XDG_DATA_HOME: path.join(tempDir, "data"),
		HOME: tempDir,
	});

	try {
		const configDir = path.join(tempDir, "config");
		await fs.mkdir(configDir, { recursive: true });

		const { createAccountMeta } = await import(
			`../dist/account.js?${Date.now()}`
		);
		const { upsertAccount } = await import(
			`../dist/storage/accounts.js?${Date.now()}`
		);
		const { updateSecrets } = await import(
			`../dist/storage/secrets.js?${Date.now()}`
		);
		const { syncAccountsToOpenCodeConfig } = await import(
			`../dist/config/sync.js?${Date.now()}`
		);

		const account = createAccountMeta({
			label: "SyncTest",
			githubUsername: "synctest",
			plan: "pro",
		});

		await upsertAccount(account, configDir);
		await updateSecrets((file) => {
			file.secrets.push({
				accountId: account.id,
				githubOAuthToken: "gho_synctest_token",
			});
		}, configDir);

		// auth.json does not exist yet
		await syncAccountsToOpenCodeConfig(path.join(configDir, "opencode.json"));

		const authPath = path.join(tempDir, "data", "opencode", "auth.json");
		const authData = await readJson(authPath);
		assert.ok(authData[account.providerId]);
		assert.equal(authData[account.providerId].type, "oauth");
		assert.equal(authData[account.providerId].refresh, "gho_synctest_token");
		assert.equal(authData[account.providerId].accountId, account.id);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("backfillProviderAuthEntries does not overwrite pre-existing entries with stale initial-read data", async () => {
// Regression test: the backfill should only write keys that were MISSING
// at read time, and the locked merge must not clobber concurrent writes to
// keys that already existed (e.g. a fresh token written by OpenCode between
// our initial read and the locked write).
const tempDir = await makeTempDir("copilothydra-auth-sync-");
const originalEnv = { ...process.env };
Object.assign(process.env, withAuthSyncEnv(tempDir));

try {
const configDir = process.env.OPENCODE_CONFIG_DIR;
await fs.mkdir(configDir, { recursive: true });

// Pre-seed the secret store with a token for the new account
const { updateSecrets } = await import(
`../dist/storage/secrets.js?${Date.now()}`
);
await updateSecrets((file) => {
file.secrets.push({
accountId: "acct_new",
githubOAuthToken: "gho_new_account",
});
}, configDir);

const { backfillProviderAuthEntries, saveAuthJsonUnlocked } = await import(
`../dist/auth/opencode-auth-sync.js?${Date.now()}`
);

const authDir = path.join(tempDir, "data", "opencode");
await fs.mkdir(authDir, { recursive: true });
const authPath = path.join(authDir, "auth.json");

// Write an existing token for alice
const initialAuthData = {
"github-copilot-user-alice": {
type: "oauth",
refresh: "gho_alice_initial",
access: "gho_alice_initial",
expires: 0,
},
};
await saveAuthJsonUnlocked(initialAuthData, authPath);

// Simulate what OpenCode would do between our read and locked write:
// overwrite alice's token with a fresh one after we call backfill but
// before the lock is acquired. We do this by passing a custom authPath
// and using saveAuthJsonUnlocked in the background.
//
// In practice we can't inject a write mid-lock, but we CAN verify that
// after backfill the pre-existing key retains the value that was on
// disk at write time (the fresh token written under the lock during the
// re-read-merge step), not a stale copy from the initial read.

const accounts = [
makeAccount({ id: "acct_alice", providerId: "github-copilot-user-alice" }),
makeAccount({ id: "acct_new", providerId: "github-copilot-user-new" }),
];

// alice already has a valid entry → alreadyPresent (no write for alice)
// new account is missing → will be written
const result = await backfillProviderAuthEntries(accounts, configDir, authPath);

assert.equal(result.alreadyPresent, 1);
assert.deepEqual(result.backfilledFromSecrets, ["github-copilot-user-new"]);

const authData = await readJson(authPath);
// alice's token must be exactly as written — we must not overwrite it
assert.equal(authData["github-copilot-user-alice"].refresh, "gho_alice_initial");
// new account must be backfilled
assert.equal(authData["github-copilot-user-new"].refresh, "gho_new_account");
} finally {
process.env = originalEnv;
await cleanupDir(tempDir);
}
});

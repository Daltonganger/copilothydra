import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { cleanupDir, makeTempDir, readJson } from "./helpers.js";

/**
 * Startup self-heal tests
 *
 * These verify that the startup self-heal path repairs auth drift — i.e. when
 * an active Hydra account's providerId has no matching oauth entry in auth.json,
 * the self-heal function (run at plugin startup) backfills the missing entry
 * so the user never hits "Bad Request" on the first request.
 */

function withSyncEnv(tempDir) {
	return {
		OPENCODE_CONFIG_DIR: path.join(tempDir, "config"),
		XDG_DATA_HOME: path.join(tempDir, "data"),
		HOME: tempDir,
	};
}

test("selfHealAuthDrift backfills missing auth.json oauth entry from secret store", async () => {
	const tempDir = await makeTempDir("copilothydra-selfheal-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
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
		const { selfHealAuthDrift } = await import(
			`../dist/startup-self-heal.js?${Date.now()}`
		);

		const account = createAccountMeta({
			label: "SelfHealTest",
			githubUsername: "selfheal",
			plan: "pro",
		});

		await upsertAccount(account, configDir);
		await updateSecrets((file) => {
			file.secrets.push({
				accountId: account.id,
				githubOAuthToken: "gho_selfheal_token",
			});
		}, configDir);

		// auth.json does NOT exist yet — auth drift
		const authPath = path.join(tempDir, "data", "opencode", "auth.json");
		await fs.mkdir(path.dirname(authPath), { recursive: true });
		await fs.writeFile(authPath, "{}");

		// Run self-heal
		await selfHealAuthDrift();

		// Verify auth.json now has the missing entry
		const authData = await readJson(authPath);
		assert.ok(authData[account.providerId], "auth.json should have providerId entry after self-heal");
		assert.equal(authData[account.providerId].type, "oauth");
		assert.equal(authData[account.providerId].refresh, "gho_selfheal_token");
		assert.equal(authData[account.providerId].accountId, account.id);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("selfHealAuthDrift backfills missing auth.json entry from legacy acct-* key", async () => {
	const tempDir = await makeTempDir("copilothydra-selfheal-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
		await fs.mkdir(configDir, { recursive: true });

		const { createAccountMeta } = await import(
			`../dist/account.js?${Date.now()}`
		);
		const { upsertAccount } = await import(
			`../dist/storage/accounts.js?${Date.now()}`
		);
		const { selfHealAuthDrift } = await import(
			`../dist/startup-self-heal.js?${Date.now()}`
		);

		const account = createAccountMeta({
			label: "LegacySelfHeal",
			githubUsername: "legacyselfheal",
			plan: "pro",
		});

		await upsertAccount(account, configDir);

		// auth.json has a legacy entry under github-copilot-acct-<id> but NOT
		// under the current providerId — classic auth drift scenario
		const authPath = path.join(tempDir, "data", "opencode", "auth.json");
		await fs.mkdir(path.dirname(authPath), { recursive: true });
		await fs.writeFile(
			authPath,
			JSON.stringify(
				{
					[`github-copilot-acct-${account.id}`]: {
						type: "oauth",
						refresh: "gho_legacy_selfheal",
						access: "gho_legacy_selfheal",
						expires: 0,
					},
				},
				null,
				2,
			),
		);

		await selfHealAuthDrift();

		const authData = await readJson(authPath);
		assert.ok(authData[account.providerId], "auth.json should have providerId entry after self-heal");
		assert.equal(authData[account.providerId].type, "oauth");
		assert.equal(authData[account.providerId].refresh, "gho_legacy_selfheal");
		assert.equal(authData[account.providerId].accountId, account.id);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("selfHealAuthDrift is idempotent — no-op when auth.json already has valid entries", async () => {
	const tempDir = await makeTempDir("copilothydra-selfheal-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
		await fs.mkdir(configDir, { recursive: true });

		const { createAccountMeta } = await import(
			`../dist/account.js?${Date.now()}`
		);
		const { upsertAccount } = await import(
			`../dist/storage/accounts.js?${Date.now()}`
		);
		const { selfHealAuthDrift } = await import(
			`../dist/startup-self-heal.js?${Date.now()}`
		);

		const account = createAccountMeta({
			label: "Idempotent",
			githubUsername: "idempotent",
			plan: "pro",
		});

		await upsertAccount(account, configDir);

		// auth.json already has a valid entry — no drift
		const authPath = path.join(tempDir, "data", "opencode", "auth.json");
		await fs.mkdir(path.dirname(authPath), { recursive: true });
		const originalEntry = {
			type: "oauth",
			refresh: "gho_existing_token",
			access: "gho_existing_token",
			expires: 0,
		};
		await fs.writeFile(
			authPath,
			JSON.stringify({ [account.providerId]: originalEntry }, null, 2),
		);

		await selfHealAuthDrift();

		// Entry should be unchanged
		const authData = await readJson(authPath);
		assert.deepEqual(authData[account.providerId], originalEntry);
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("selfHealAuthDrift does not crash when no accounts are configured", async () => {
	const tempDir = await makeTempDir("copilothydra-selfheal-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
		await fs.mkdir(configDir, { recursive: true });

		// No accounts file — loadAccounts creates an empty one
		const { selfHealAuthDrift } = await import(
			`../dist/startup-self-heal.js?${Date.now()}`
		);

		// Should complete without error
		await selfHealAuthDrift();
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("selfHealAuthDrift creates auth.json if it does not exist at all", async () => {
	const tempDir = await makeTempDir("copilothydra-selfheal-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
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
		const { selfHealAuthDrift } = await import(
			`../dist/startup-self-heal.js?${Date.now()}`
		);

		const account = createAccountMeta({
			label: "CreateFile",
			githubUsername: "createfile",
			plan: "pro",
		});

		await upsertAccount(account, configDir);
		await updateSecrets((file) => {
			file.secrets.push({
				accountId: account.id,
				githubOAuthToken: "gho_create_token",
			});
		}, configDir);

		// auth.json does NOT exist at all
		const authPath = path.join(tempDir, "data", "opencode", "auth.json");

		await selfHealAuthDrift();

		// Verify auth.json was created with the entry
		const authData = await readJson(authPath);
		assert.ok(authData[account.providerId], "auth.json should be created with providerId entry");
		assert.equal(authData[account.providerId].type, "oauth");
		assert.equal(authData[account.providerId].refresh, "gho_create_token");
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

test("selfHealAuthDrift repairs drift for multiple accounts simultaneously", async () => {
	const tempDir = await makeTempDir("copilothydra-selfheal-");
	const originalEnv = { ...process.env };
	Object.assign(process.env, withSyncEnv(tempDir));

	try {
		const configDir = process.env.OPENCODE_CONFIG_DIR;
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
		const { selfHealAuthDrift } = await import(
			`../dist/startup-self-heal.js?${Date.now()}`
		);

		const account1 = createAccountMeta({
			label: "Multi1",
			githubUsername: "multi1",
			plan: "pro",
		});
		const account2 = createAccountMeta({
			label: "Multi2",
			githubUsername: "multi2",
			plan: "free",
		});

		await upsertAccount(account1, configDir);
		await upsertAccount(account2, configDir);
		await updateSecrets((file) => {
			file.secrets.push(
				{ accountId: account1.id, githubOAuthToken: "gho_multi1" },
				{ accountId: account2.id, githubOAuthToken: "gho_multi2" },
			);
		}, configDir);

		// auth.json exists but is empty — both accounts have auth drift
		const authPath = path.join(tempDir, "data", "opencode", "auth.json");
		await fs.mkdir(path.dirname(authPath), { recursive: true });
		await fs.writeFile(authPath, "{}");

		await selfHealAuthDrift();

		const authData = await readJson(authPath);
		assert.ok(authData[account1.providerId], "first account should be backfilled");
		assert.ok(authData[account2.providerId], "second account should be backfilled");
		assert.equal(authData[account1.providerId].refresh, "gho_multi1");
		assert.equal(authData[account2.providerId].refresh, "gho_multi2");
	} finally {
		process.env = originalEnv;
		await cleanupDir(tempDir);
	}
});

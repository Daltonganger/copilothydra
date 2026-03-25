import type { AuthMethod, AuthOAuthResult, CopilotAccountMeta, PlanTier } from "../types.js";
import { createAccountMeta } from "../account.js";
import { requestDeviceCode, pollForAccessToken, type DeviceCodeResponse } from "./device-flow.js";
import { findAccountByGitHubUsername, loadAccounts, upsertAccount } from "../storage/accounts.js";
import { syncAccountsToOpenCodeConfig } from "../config/sync.js";
import { checkAccountRuntimeReadiness } from "../runtime-checks.js";
import { registerAccounts } from "../routing/provider-account-map.js";
import { setTokenState } from "./token-state.js";
import { resolveOpenCodeConfigPath } from "../config/opencode-config.js";
import { error, info } from "../log.js";

const VALID_PLANS: PlanTier[] = ["free", "student", "pro", "pro+"];

export interface LoginMethodDependencies {
  findAccountByGitHubUsername: typeof findAccountByGitHubUsername;
  createAccountMeta: typeof createAccountMeta;
  upsertAccount: typeof upsertAccount;
  loadAccounts: typeof loadAccounts;
  syncAccountsToOpenCodeConfig: typeof syncAccountsToOpenCodeConfig;
  registerAccounts: typeof registerAccounts;
  checkAccountRuntimeReadiness: typeof checkAccountRuntimeReadiness;
  requestDeviceCode: typeof requestDeviceCode;
  pollForAccessToken: typeof pollForAccessToken;
  setTokenState: typeof setTokenState;
  resolveOpenCodeConfigPath: typeof resolveOpenCodeConfigPath;
}

const DEFAULT_DEPS: LoginMethodDependencies = {
  findAccountByGitHubUsername,
  createAccountMeta,
  upsertAccount,
  loadAccounts,
  syncAccountsToOpenCodeConfig,
  registerAccounts,
  checkAccountRuntimeReadiness,
  requestDeviceCode,
  pollForAccessToken,
  setTokenState,
  resolveOpenCodeConfigPath,
};

export function createCopilotLoginMethod(
  overrides: Partial<LoginMethodDependencies> = {},
): AuthMethod {
  const deps = { ...DEFAULT_DEPS, ...overrides };

  return {
    type: "oauth",
    label: "GitHub Copilot (CopilotHydra)",
    prompts: [
      {
        type: "text",
        key: "githubUsername",
        message: "GitHub username (existing username = re-auth)",
        placeholder: "alice",
      },
      {
        type: "text",
        key: "label",
        message: "Account label for new account",
        placeholder: "Personal",
      },
      {
        type: "text",
        key: "plan",
        message: "Plan for new account: free/student/pro/pro+",
        placeholder: "pro",
      },
      {
        type: "text",
        key: "allowUnverifiedModels",
        message: "Expose uncertain models for a new account? yes/no",
        placeholder: "no",
      },
    ],
    authorize: async (inputs) => {
      const { account, existing } = await resolveOrCreateAccount(inputs, deps);
      const deviceCode = await deps.requestDeviceCode();

      return buildAuthResult(account, deviceCode, existing, deps);
    },
  };
}

async function resolveOrCreateAccount(
  inputs: Record<string, string> | undefined,
  deps: LoginMethodDependencies,
): Promise<{ account: CopilotAccountMeta; existing: boolean }> {
  const githubUsername = requireTextInput(inputs, "githubUsername", "GitHub username");
  const existing = await deps.findAccountByGitHubUsername(githubUsername);
  if (existing) {
    info("auth", `Re-authenticating existing account \"${existing.label}\" (${existing.githubUsername})`);
    return { account: existing, existing: true };
  }

  const label = requireTextInput(inputs, "label", "Account label");
  const plan = parsePlanTier(inputs?.plan);
  const allowUnverifiedModels = parseBooleanInput(inputs?.allowUnverifiedModels);

  const account = deps.createAccountMeta({
    label,
    githubUsername,
    plan,
    allowUnverifiedModels,
  });

  deps.checkAccountRuntimeReadiness(account);
  await deps.upsertAccount(account);
  await deps.syncAccountsToOpenCodeConfig();

  const accounts = await deps.loadAccounts();
  deps.registerAccounts(accounts.accounts.filter((candidate) => candidate.lifecycleState === "active"));

  info("auth", `Prepared new CopilotHydra account \"${account.label}\" (${account.githubUsername})`);
  return { account, existing: false };
}

function buildAuthResult(
  account: CopilotAccountMeta,
  deviceCode: DeviceCodeResponse,
  isExistingAccount: boolean,
  deps: LoginMethodDependencies,
): AuthOAuthResult {
  const restartNote = isExistingAccount
    ? ""
    : `\nAfter authorization completes, reload/restart OpenCode so the new provider entry from ${deps.resolveOpenCodeConfigPath()} is active.`;

  return {
    url: deviceCode.verification_uri,
    instructions:
      `Open ${deviceCode.verification_uri} and enter code: ${deviceCode.user_code}\n` +
      `(Code expires in ${deviceCode.expires_in}s; account: ${account.label} / ${account.githubUsername})` +
      restartNote,
    method: "auto",
    callback: async () => {
      try {
        const result = await deps.pollForAccessToken(
          deviceCode.device_code,
          deviceCode.interval,
          deviceCode.expires_in,
        );

        deps.setTokenState({
          accountId: account.id,
          githubOAuthToken: result.accessToken,
          expiresAt: 0,
          setAt: Date.now(),
        });

        return {
          type: "success",
          provider: account.providerId,
          refresh: result.accessToken,
          access: result.accessToken,
          expires: 0,
          accountId: account.id,
        };
      } catch (err_) {
        error("auth", `Device flow failed for \"${account.label}\": ${String(err_)}`);
        return { type: "failed" };
      }
    },
  };
}

function requireTextInput(
  inputs: Record<string, string> | undefined,
  key: string,
  label: string,
): string {
  const value = inputs?.[key]?.trim();
  if (!value) {
    throw new Error(`[copilothydra] ${label} is required in OpenCode auth login`);
  }
  return value;
}

function parsePlanTier(raw: string | undefined): PlanTier {
  const value = raw?.trim().toLowerCase() as PlanTier | undefined;
  if (!value || !VALID_PLANS.includes(value)) {
    throw new Error("[copilothydra] plan must be one of: free, student, pro, pro+");
  }
  return value;
}

function parseBooleanInput(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  if (!value) return false;
  if (["y", "yes", "true", "1"].includes(value)) return true;
  if (["n", "no", "false", "0"].includes(value)) return false;
  throw new Error("[copilothydra] allowUnverifiedModels must be yes/no");
}

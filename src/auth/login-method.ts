import type { AuthMethod, AuthOAuthResult, CopilotAccountMeta, PlanTier } from "../types.js";
import { createAccountMeta } from "../account.js";
import { requestDeviceCode, pollForAccessToken, type DeviceCodeResponse } from "./device-flow.js";
import { findAccount, findAccountByGitHubUsername, upsertAccount } from "../storage/accounts.js";
import { syncAccountsToOpenCodeConfig } from "../config/sync.js";
import {
  checkAccountRuntimeReadiness,
  validateCanAddAccount,
  MAX_ACTIVE_ACCOUNTS,
  countActiveAccounts,
} from "../runtime-checks.js";
import { setTokenState } from "./token-state.js";
import { resolveOpenCodeConfigPath } from "../config/opencode-config.js";
import { error, info } from "../log.js";
import { bestEffortKeychainWrite } from "../storage/copilot-cli-keychain.js";
import { upsertSecret } from "../storage/secrets.js";
import { bestEffortPublishPrimaryCompatibility } from "../storage/primary-compat-export.js";
import { verifyDeclaredPlan, type PlanVerifyResult } from "./plan-verify.js";

const VALID_PLANS: PlanTier[] = ["free", "student", "pro", "pro+"];

export interface LoginMethodDependencies {
  findAccount: typeof findAccount;
  findAccountByGitHubUsername: typeof findAccountByGitHubUsername;
  createAccountMeta: typeof createAccountMeta;
  upsertAccount: typeof upsertAccount;
  syncAccountsToOpenCodeConfig: typeof syncAccountsToOpenCodeConfig;
  checkAccountRuntimeReadiness: typeof checkAccountRuntimeReadiness;
  requestDeviceCode: typeof requestDeviceCode;
  pollForAccessToken: typeof pollForAccessToken;
  setTokenState: typeof setTokenState;
  resolveOpenCodeConfigPath: typeof resolveOpenCodeConfigPath;
  verifyDeclaredPlan: typeof verifyDeclaredPlan;
}

const DEFAULT_DEPS: LoginMethodDependencies = {
  findAccount,
  findAccountByGitHubUsername,
  createAccountMeta,
  upsertAccount,
  syncAccountsToOpenCodeConfig,
  checkAccountRuntimeReadiness,
  requestDeviceCode,
  pollForAccessToken,
  setTokenState,
  resolveOpenCodeConfigPath,
  verifyDeclaredPlan,
};

export function createCopilotLoginMethods(
  existingAccounts: CopilotAccountMeta[] = [],
  overrides: Partial<LoginMethodDependencies> = {},
): AuthMethod[] {
  const deps = { ...DEFAULT_DEPS, ...overrides };
  const methods: AuthMethod[] = [];

  if (existingAccounts.length > 0) {
    methods.push({
      type: "oauth",
      label: "GitHub Copilot (CopilotHydra) — Re-auth existing account",
      prompts: [
        {
          type: "text",
          key: "githubUsername",
          message: "GitHub username for an existing CopilotHydra account",
          placeholder: existingAccounts[0]?.githubUsername ?? "alice",
        },
      ],
      authorize: async (inputs) => {
        const account = await resolveExistingAccount(inputs, deps);
        const deviceCode = await deps.requestDeviceCode();

        return buildAuthResult(account, deviceCode, true, deps);
      },
    });
  }

  if (countActiveAccounts(existingAccounts) < MAX_ACTIVE_ACCOUNTS) {
    methods.push({
      type: "oauth",
      label: "GitHub Copilot (CopilotHydra) — Add new account",
      prompts: [
        {
          type: "text",
          key: "githubUsername",
          message: "GitHub username for the new account",
          placeholder: "alice",
        },
        {
          type: "text",
          key: "label",
          message: "Account label",
          placeholder: "Personal",
        },
        {
          type: "text",
          key: "plan",
          message: "Plan: free/student/pro/pro+",
          placeholder: "pro",
        },
        {
          type: "text",
          key: "allowUnverifiedModels",
          message: "Expose uncertain models? yes/no",
          placeholder: "no",
        },
      ],
      authorize: async (inputs) => {
        validateCanAddAccount(existingAccounts);
        const account = await createNewAccount(inputs, deps);
        const deviceCode = await deps.requestDeviceCode();

        return buildAuthResult(account, deviceCode, false, deps);
      },
    });
  }

  return methods;
}

async function resolveExistingAccount(
  inputs: Record<string, string> | undefined,
  deps: LoginMethodDependencies,
): Promise<CopilotAccountMeta> {
  const githubUsername = requireTextInput(inputs, "githubUsername", "GitHub username");
  const existing = await deps.findAccountByGitHubUsername(githubUsername);
  if (!existing) {
    throw new Error(
      `[copilothydra] no existing account found for GitHub username "${githubUsername}" during re-auth`,
    );
  }

  info("auth", `Re-authenticating existing account "${existing.label}" (${existing.githubUsername})`);
  return existing;
}

async function createNewAccount(
  inputs: Record<string, string> | undefined,
  deps: LoginMethodDependencies,
): Promise<CopilotAccountMeta> {
  const githubUsername = requireTextInput(inputs, "githubUsername", "GitHub username");
  const existing = await deps.findAccountByGitHubUsername(githubUsername);
  if (existing) {
    throw new Error(
      `[copilothydra] GitHub username "${githubUsername}" already exists; use the re-auth method instead`,
    );
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

  info("auth", `Prepared new CopilotHydra account "${account.label}" (${account.githubUsername})`);
  return account;
}

function buildAuthResult(
  account: CopilotAccountMeta,
  deviceCode: DeviceCodeResponse,
  isExistingAccount: boolean,
  deps: LoginMethodDependencies,
): AuthOAuthResult {
  return {
    url: deviceCode.verification_uri,
    instructions:
      `Enter this code:\n${deviceCode.user_code}\n` +
      `(Code expires in ${deviceCode.expires_in}s; account: ${account.label} / ${account.githubUsername})` +
      (!isExistingAccount
        ? `\n\nAfter authorization completes, reload or restart OpenCode so the new provider entry is picked up.`
        : ``),
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

        await upsertSecret({
          accountId: account.id,
          githubOAuthToken: result.accessToken,
        });

        // Best-effort: publish token to OS credential store for OpenCode Bar / native discovery
        await bestEffortKeychainWrite({
          githubUsername: account.githubUsername,
          githubOAuthToken: result.accessToken,
          accountLabel: account.label,
        });

        await bestEffortPublishPrimaryCompatibility({
          account,
          githubOAuthToken: result.accessToken,
        });

        // Best-effort plan pre-verification (non-blocking)
        const planVerify = await deps.verifyDeclaredPlan(result.accessToken, account.plan);
        if (planVerify.checked && !planVerify.ok && planVerify.mismatchHint) {
          // mismatchHint is already logged as warn in verifyDeclaredPlan
          // Surface it in the auth instructions too (best-effort)
        }

        if (!isExistingAccount) {
          info(
            "auth",
            `Authorization succeeded for "${account.label}". Reload/restart OpenCode so the new provider entry from ${deps.resolveOpenCodeConfigPath()} is active.`,
          );
        }

        return {
          type: "success",
          provider: account.providerId,
          refresh: result.accessToken,
          access: result.accessToken,
          expires: 0,
          accountId: account.id,
        };
      } catch (err_) {
        error("auth", `Device flow failed for "${account.label}": ${String(err_)}`);
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

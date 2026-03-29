/**
 * CopilotHydra — shared types
 *
 * Core data model for account metadata, secrets, and plugin state.
 * These types are intentionally stable and kept free of implementation detail.
 */

// ---------------------------------------------------------------------------
// Account identity
// ---------------------------------------------------------------------------

/**
 * Stable internal identifier for an account.
 * Format: "acct_<6-char hex>", e.g. "acct_7f2c1d"
 * Never changes after account creation.
 */
export type AccountId = string;

/**
 * OpenCode provider ID for this account.
 * Format: "github-copilot-acct-<accountId>", e.g. "github-copilot-acct-7f2c1d"
 * Must contain "github-copilot" for OpenCode internal detection to work.
 */
export type ProviderId = string;

// ---------------------------------------------------------------------------
// Plan / capability
// ---------------------------------------------------------------------------

export type PlanTier = "free" | "student" | "pro" | "pro+";

/**
 * Whether the account's plan/capability has been verified, is user-declared,
 * or is in a mismatched state (declared plan doesn't match API responses).
 */
export type CapabilityState = "user-declared" | "verified" | "mismatch";

// ---------------------------------------------------------------------------
// Account lifecycle
// ---------------------------------------------------------------------------

/**
 * "pending-removal" means the account has been removed from storage but
 * in-flight requests are still draining. New requests must be blocked.
 */
export type AccountLifecycleState = "active" | "pending-removal";

// ---------------------------------------------------------------------------
// Account metadata (stored in copilot-accounts.json, no secrets)
// ---------------------------------------------------------------------------

export interface CopilotAccountMeta {
  /** Stable internal ID */
  id: AccountId;
  /** OpenCode provider ID */
  providerId: ProviderId;
  /** User-facing label, e.g. "Personal" */
  label: string;
  /** GitHub username, for display only */
  githubUsername: string;
  /** User-declared or verified plan tier */
  plan: PlanTier;
  /** Whether plan has been verified or is only user-declared */
  capabilityState: CapabilityState;
  /** Explicit user acknowledgement to expose plan-table models that remain unverified */
  allowUnverifiedModels?: boolean;
  /** ISO timestamp of the last capability mismatch detection */
  mismatchDetectedAt?: string;
  /** Model id that most recently triggered a capability mismatch */
  mismatchModelId?: string;
  /** Suggested stricter plan that would stop exposing the mismatched model */
  mismatchSuggestedPlan?: PlanTier;
  /** Active or in drain-on-removal state */
  lifecycleState: AccountLifecycleState;
  /** ISO 8601 timestamp */
  addedAt: string;
  /** ISO 8601 timestamp of last successful validation, if any */
  lastValidatedAt?: string;
}

// ---------------------------------------------------------------------------
// Secrets (stored in copilot-secrets.json, never logged)
// ---------------------------------------------------------------------------

/**
 * Token material for one account.
 *
 * NOTE: githubOAuthToken and copilotAccessToken are intentionally separate.
 * Research (Spike B) established that the GitHub OAuth device-flow token
 * is used directly as a Bearer token for Copilot API requests.
 * The copilotAccessToken field is reserved for future exchange logic
 * if that finding turns out to be incomplete.
 */
export interface CopilotSecretRecord {
  accountId: AccountId;
  /** GitHub OAuth device-flow token (used as Bearer on Copilot requests) */
  githubOAuthToken: string;
  /** Reserved: Copilot-specific access token if exchange is required */
  copilotAccessToken?: string;
  /** ISO 8601, reserved for future expiry tracking */
  copilotAccessTokenExpiresAt?: string;
}

// ---------------------------------------------------------------------------
// Storage file shapes
// ---------------------------------------------------------------------------

export interface AccountsFile {
  version: 1;
  accounts: CopilotAccountMeta[];
}

export interface SecretsFile {
  version: 1;
  secrets: CopilotSecretRecord[];
}

// ---------------------------------------------------------------------------
// Plugin input/output (mirrors @opencode-ai/plugin shape)
// We duplicate the minimal types we need here so the plugin compiles
// even if @opencode-ai/plugin is not installed during development.
// ---------------------------------------------------------------------------

export interface PluginInput {
  /** opencode SDK client (type unknown here to avoid hard dep) */
  client: unknown;
  project: unknown;
  worktree: unknown;
  directory: string;
  serverUrl: string | URL;
  $: unknown;
}

/**
 * Shape returned by `AuthHook.loader`.
 * OpenCode's actual type is `Promise<Record<string, any>>` but in practice
 * the loader returns a subset of these fields.
 * We use a typed alias for IDE support while remaining assignment-compatible
 * with `Record<string, any>`.
 */
export interface AuthLoader {
  baseURL?: string;
  apiKey?: string;
  /** Custom fetch function that injects auth headers per-request */
  fetch?: (request: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Auth storage info (mirrors @opencode-ai/sdk Auth.Info)
// Used as the return type of getAuth() in the loader.
// ---------------------------------------------------------------------------

export type StoredAuthInfo =
  | {
      type: "oauth";
      refresh: string;
      access: string;
      expires: number;
      accountId?: string;
      enterpriseUrl?: string;
    }
  | { type: "api"; key: string }
  | { type: "wellknown"; key: string; token: string };

// ---------------------------------------------------------------------------
// Auth OAuth result (mirrors @opencode-ai/plugin AuthOuathResult)
// Note: OpenCode spells "oauth" as "Ouath" in their type name — we keep the
// correct spelling in our code but note the upstream typo.
// ---------------------------------------------------------------------------

export type AuthOAuthResult =
  | {
      url: string;
      instructions: string;
      method: "auto";
      callback(): Promise<
        | {
            type: "success";
            provider?: string;
            refresh: string;
            access: string;
            expires: number;
            accountId?: string;
          }
        | { type: "failed" }
      >;
    }
  | {
      url: string;
      instructions: string;
      method: "code";
      callback(code: string): Promise<
        | {
            type: "success";
            provider?: string;
            refresh: string;
            access: string;
            expires: number;
            accountId?: string;
          }
        | { type: "failed" }
      >;
    };

export interface AuthMethod {
  type: "oauth";
  label: string;
  /** prompts the user for any required input fields */
  prompts?: Array<{
    type: "text";
    key: string;
    message: string;
    placeholder?: string;
  }>;
  /** kicks off the auth flow; returns URL + instructions + callback for the device flow */
  authorize: (inputs?: Record<string, string>) => Promise<AuthOAuthResult>;
}

export interface AuthHook {
  provider: ProviderId;
  loader?: (
    getAuth: () => Promise<StoredAuthInfo | undefined>,
    provider: { id: ProviderId }
  ) => Promise<AuthLoader>;
  methods: AuthMethod[];
}

export interface Hooks {
  auth?: AuthHook;
}

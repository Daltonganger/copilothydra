# opencode-multi-copilot (CopilotHydra) — Revised Implementation Plan

## Status of this document

This is a **revised, feasibility-first plan** for building an OpenCode plugin that supports **multiple GitHub Copilot accounts**.

This revision incorporates:
- critical internal review
- architectural review findings
- user decisions on scope, stability, and trade-offs

This document is intentionally written to reduce project risk **before** implementation starts.

---

## User decisions captured

These decisions are now part of scope unless changed later.

1. **No version pinning** to a single OpenCode version/range.
2. **Restart/reload after account changes is acceptable**.
3. **Secrets storage**: start with plaintext file storage, migrate to keychain later.
4. **Model availability**: manual plan selection is acceptable initially, but there is a **strong preference** for eventually proving capabilities per account.
5. **Simultaneous multi-account usage is required**.
6. **Platform scope**: macOS and Linux first; Windows is **best effort** for v1.
7. **Quality target**: **best-effort, compatibility-sensitive**.
8. **Provider identity**: no strong preference from user.
9. **Fallback architecture**: local broker / sidecar is out of scope.
10. **Unknown OpenCode versions**: warn rather than hard-block.
11. **Capability exposure**: uncertain models should require explicit user override.
12. **Simultaneous usage** means **parallel usage within the same session**.
13. **Selection model**: prefer **one provider per account**.
14. **Account removal during active requests**: drain in-flight requests, then block further use.
15. **Account management**: TUI-only for v1.
16. **Plan mismatch behavior**: hard error, mark mismatch/downgraded state, then ask whether to overwrite the stored plan.
17. **Storage location**: use the OpenCode config directory convention.
18. **Auth direction**: use OpenCode’s internal login/auth flow wherever possible.

---

## Problem statement

OpenCode’s built-in Copilot integration supports only one account. This plugin should allow a user to connect and use multiple GitHub Copilot accounts, with account-specific model exposure and reliable routing so that simultaneous usage across accounts works correctly.

---

## Critical constraints and realities

## 1. OpenCode internal Copilot detection is brittle

OpenCode appears to contain special handling based on provider ID checks such as:
- `provider.id.includes("github-copilot")`
- `providerID.startsWith("github-copilot")`

This means:
- every Copilot-compatible provider ID likely must contain `github-copilot`
- this plugin is coupled to undocumented internal behavior
- compatibility may break across OpenCode releases

**Implication:** because version pinning is not desired, the plugin must include:
- runtime compatibility checks
- clear failure messages when assumptions break
- a tested-version matrix in docs
- warning-first behavior on unknown OpenCode versions

## 2. Core architecture is not yet proven

Two project-killer assumptions are currently unproven:

1. **Whether one OpenCode auth hook can service multiple dynamically injected providers**
2. **Whether the token used by Copilot requests is the same token returned by GitHub device flow, or whether additional token exchange/refresh is required**

**Implication:** do not start full implementation before proving these assumptions with minimal spikes.

## 3. Restart after account changes is acceptable

This is a major simplifier.

Baseline behavior may be:
- user adds/removes account in plugin UI
- plugin updates storage
- user reloads or restarts OpenCode
- providers/models are re-registered on startup

Dynamic hot-reload is optional, not required for v1.

## 4. Simultaneous multi-account usage is required

This raises the bar significantly.

The plugin must not merely support “switching accounts.” It must ensure:
- deterministic provider → account binding
- no fallback to the wrong account
- correct token use under concurrent requests
- no refresh race conditions

---

## Non-goals for v1

The following are explicitly out of scope unless feasibility work proves them cheap and reliable:
- enterprise GitHub / GHE support
- live dynamic provider reload without restart
- polished keychain integration in first implementation
- automatic perfect plan detection if no reliable API exists
- broad undocumented hacks without guardrails

---

## Architecture principles

## 1. Feasibility first

Before implementing the full plugin, prove the critical assumptions with throwaway spikes.

## 2. Fail closed

If account routing is ambiguous or auth state is invalid:
- fail loudly
- do not fallback to another account
- never silently use the first available account

For host-version compatibility checks specifically:
- warn first on unknown versions
- fail closed only when runtime assumptions are demonstrably broken

## 3. Stable internal IDs

Do not use GitHub username as the primary internal identity.

Use:
- stable internal account ID for storage and routing
- user-facing label/username only for display

Provider IDs should still contain `github-copilot`, but should avoid unnecessary coupling to mutable usernames.

Example:
- `github-copilot-acct-7f2c1d`

## 4. Separate metadata from secrets as early as possible

Even though v1 starts with plaintext storage, structure the design so later migration to keychain is easy.

## 5. Cross-platform baseline

All first-pass storage, locking, and terminal behavior must be chosen with macOS and Linux in mind, with Windows validated on a best-effort basis for v1.

## 6. OpenCode auth-login direction

The preferred path is now explicitly:

- account add / re-auth should start from `opencode auth login` where technically possible
- standalone CopilotHydra CLI/TUI remains a fallback management path, not the primary auth entrypoint
- plugin auth methods should reuse OpenCode’s login surface first, then fall back to separate tooling only where the host cannot express the needed UX

---

## Recommended v1 architecture

## High-level model

The plugin should behave as three subsystems:

1. **Account registry**
   - stores account metadata
   - stores token material (plaintext in v1)
   - manages add/remove/update

2. **Capability registry**
   - stores the user-selected plan tier for v1
   - later supports per-account capability verification
   - produces model lists per account

3. **Provider router**
   - maps provider/model usage to the correct account
   - ensures requests for account A never use account B
   - handles refresh/exchange if required by actual Copilot auth behavior

---

## Project phases

## Phase 0 — Feasibility spikes (mandatory before full implementation)

These are not optional.

### Spike A — Auth/provider routing proof

Goal:
- prove whether OpenCode can route auth correctly for multiple providers registered by plugin config

Questions to answer:
- does one auth hook service many config-registered providers?
- what provider ID does the loader actually receive at runtime?
- can config-registered providers trigger account-specific auth behavior?
- is restart sufficient for new providers to appear?

Success criteria:
- two providers can be registered
- each provider deterministically resolves to its own auth context
- no ambiguous provider resolution

### Spike B — Copilot token chain proof

Goal:
- identify the actual token flow required for Copilot requests

Questions to answer:
- is the GitHub device-flow token sufficient for Copilot runtime use?
- is there a Copilot-specific access token exchange?
- is there refresh logic or short-lived token issuance?
- what exact headers are required at runtime?

Success criteria:
- one account works end-to-end with real requests
- token lifetime / refresh behavior is understood

### Spike C — Model/provider registration proof

Goal:
- verify the exact shape of provider/model registration required by OpenCode and `@ai-sdk/github-copilot`

Questions to answer:
- what exact model IDs work?
- how must models be declared?
- are config mutations sufficient?
- are provider-per-account model lists exposed as expected?

Success criteria:
- one provider exposes one or more usable models successfully

### Spike D — Capability verification research

Goal:
- determine whether per-account model capability can be proven automatically

Questions to answer:
- is there a reliable API to discover plan/capability per account?
- can GitHub Models Catalog data be combined with account capability data?
- if not, what is the least bad manual fallback?

Success criteria:
- documented decision: verified capabilities or manual profile in v1

### Spike E — Storage / platform / TUI feasibility

Goal:
- prove that storage, locking, auth-launch behavior, and TUI assumptions are acceptable in the OpenCode config directory model across supported environments

Questions to answer:
- does OpenCode consistently use the same config directory convention across macOS, Linux, and Windows?
- does any config-dir override need to be honored?
- are atomic write/replace and corruption recovery acceptable in this location?
- what locking strategy is reliable enough for concurrent processes?
- does browser/device auth work reliably from the intended TUI flow?
- what breaks on Windows, and is it acceptable under best-effort support?

Success criteria:
- documented storage/config-dir decision
- documented locking/write strategy
- documented platform caveats for Windows and non-ideal terminals

**Gate:** do not proceed to full implementation until Phase 0 results are written down.

---

## Phase 1 — Single-account reference implementation

Build a correct single-account implementation first.

Scope:
- one account
- one stable provider
- correct auth/token behavior
- one or more working models
- restart-based config lifecycle
- early compatibility/runtime checks
- early tests around the reference path

Goal:
- replicate the actual runtime mechanics correctly before adding multi-account complexity

Success criteria:
- end-to-end single-account usage works reliably
- no guessed token behavior remains in core path
- unknown-version behavior is at least warning-capable

---

## Phase 2 — Account registry and storage

Implement persistent account management only after single-account flow is real.

### Storage design

### Metadata file
Location:
- OpenCode config directory (default: `~/.config/opencode/copilot-accounts.json`)
- if OpenCode exposes/uses a config-dir override such as `OPENCODE_CONFIG_DIR`, follow that convention

Shape:
```json
{
  "version": 1,
  "accounts": [
    {
      "id": "acct_7f2c1d",
      "label": "Personal",
      "githubUsername": "alice",
      "plan": "pro",
      "providerId": "github-copilot-acct-7f2c1d",
      "addedAt": "2026-03-24T12:00:00Z",
      "lastValidatedAt": "2026-03-24T12:15:00Z"
    }
  ]
}
```

### Secrets file (v1)
Location:
- separate plaintext secrets file in the OpenCode config directory, not mixed into the metadata file if possible

Example:
- `~/.config/opencode/copilot-secrets.json`

Requirements:
- create with strict permissions where supported
- never log token contents
- atomic write/replace
- structured so future keychain migration is easy

Release policy:
- plaintext secrets are acceptable for feasibility and beta
- plaintext secrets are **not** acceptable for a final/stable release

### Locking requirements

Lock the **entire transaction**, not just writes.

Required operations:
- load + modify + save under lock
- account add/remove/update under lock
- corruption recovery path
- explicit Windows-compatible strategy

If `proper-lockfile` is not robust enough for this use case, replace it.

Windows note:
- Windows is best effort for v1, but Phase 0 must still explicitly test path handling, atomic replacement, locking behavior, and TUI/browser auth behavior there.

---

## Phase 3 — Multi-account provider routing

Only begin after Phases 0–2 succeed.

Requirements:
- one provider per account
- stable provider ID containing `github-copilot`
- provider must resolve to exactly one account
- no fallback account
- concurrent use across multiple accounts must remain isolated

Recommended provider ID format:
- `github-copilot-acct-<stableId>`

Display label example:
- `Personal (alice)`

### Routing rules

For every outgoing request:
- derive provider ID
- resolve provider → account ID
- resolve account ID → current token state
- attach only that account’s auth material
- fail if mapping is missing or stale

### Concurrency rules

Must support:
- simultaneous requests through different accounts
- simultaneous requests through same account
- token refresh/exchange serialization per account if needed
- safe behavior if account is removed while requests are in flight

Removal policy:
- if an account is removed while requests are in flight, allow those requests to drain
- block new requests from being scheduled onto that account
- surface clear state to the user that removal is pending/full completion required

---

## Phase 4 — Capability/model exposure

## v1 policy

Because the user strongly prefers account-proven capabilities but allows a manual start, v1 should use this strategy:

### Initial behavior
- user selects plan manually when adding account
- plugin may expose models based on that declared plan only after explicit user acknowledgement/override for uncertain capability exposure
- UI clearly marks this as user-declared / not yet verified

### Mismatch behavior
- if a selected/exposed model is rejected in a way that strongly indicates plan mismatch, fail with a clear error
- mark the account state as mismatched / downgraded
- prompt the user whether to overwrite the stored plan with a more restrictive one
- if the user declines, preserve the stored plan but continue surfacing mismatch state

### Upgrade path
Later add:
- background capability verification per account
- override or confirm manual plan selection
- hide unsupported models where evidence is strong

### Model policy

Do not treat the hardcoded tier map as authoritative truth.

Instead:
- document it as a maintained compatibility table
- keep it isolated in one module
- make it replaceable by verified capability discovery later

---

## Phase 5 — Terminal UI / UX

UI should be implemented after engine correctness is proven.

### Implementation status note

Current implementation now includes a complete Phase 5 v1 slice:
- a dependency-free line-based TUI entrypoint
- explicit non-TTY failure for the menu path
- empty-state guidance when no accounts exist
- account overview rendering with plan, capability state, lifecycle state, and restart-required notice
- guided add-account, rename, revalidate, remove, and mismatch review flows in the line-based menu

Still pending after Phase 5:
- richer confirmations and raw-mode polish
- any later UX refinement beyond the dependency-free v1 menu

Current follow-up status:
- add account, rename, revalidate, remove, and guided mismatch review are now all wired into the menu
- restart-required and lifecycle/capability state visibility are now part of the default menu flow

### Auth-login migration note

In parallel with Phase 5, the project is now actively moving account add / re-auth into OpenCode’s own auth-login path.

Current implementation status:
- `CopilotHydraSetup` now exposes a login method under provider `github-copilot`
- that login method can either re-auth an existing account by username or create a new account and sync provider config before the device flow completes
- successful callback returns the account-specific provider id so OpenCode can bind stored auth to `github-copilot-acct-*`

Still to validate/harden:
- exact coexistence with built-in `github-copilot` behavior across OpenCode versions
- whether additional host-specific UX adjustments are needed to make this fully replace the built-in expectation

## UX goals
- safe
- boring/reliable
- easy to understand
- explicit about restart requirement
- explicit about verified vs user-declared capability state
- explicit about mismatch / downgraded state
- explicit about pending removal / drain state

## First-run experience

If no accounts exist:
- show simple empty-state screen
- primary action: Add account
- explain restart/reload requirement after success if needed

## Suggested menu structure

```text
GitHub Copilot Multi-Account Manager

Accounts
  > Add account
    Personal (alice)      [PRO]     user-declared
    Work (bob)            [FREE]    verified
    Student (charlie)     [STUDENT] mismatch

Actions
    Revalidate account
    Rename label
    Review mismatch

Danger zone
    Remove account
```

## UX rules
- destructive actions require confirmation
- account labels should be editable
- always show whether plan/capability is verified or user-declared
- always show if restart/reload is required for changes to take effect
- never show internal provider IDs as the primary user-facing identity
- plan mismatch should be surfaced clearly with a guided overwrite decision
- token expiry should trigger a clear prompt/toast for re-auth, then fail closed if recovery does not succeed

## Non-TTY behavior

Must have fallback behavior for environments where raw-mode TUI is unavailable.

Minimum fallback:
- detect non-interactive terminal
- fail with a clear message

For v1, account management remains TUI-only.

Current foundation status:
- this fallback is now implemented for the `copilothydra menu` path
- non-TTY environments fail clearly before interactive rendering starts

## Raw-mode safety

Always restore terminal state on:
- success
- failure
- ctrl+c
- thrown exceptions

---

## Proposed source layout

```text
copilothydra/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── types.ts
│   ├── auth/
│   │   ├── device-flow.ts
│   │   ├── token-state.ts
│   │   ├── loader.ts
│   │   └── compatibility-check.ts
│   ├── storage/
│   │   ├── accounts.ts
│   │   ├── secrets.ts
│   │   └── locking.ts
│   ├── config/
│   │   ├── models.ts
│   │   ├── providers.ts
│   │   └── capabilities.ts
│   ├── routing/
│   │   └── provider-account-map.ts
│   └── ui/
│       ├── menu.ts
│       └── select.ts
└── docs/
    ├── feasibility-notes.md
    └── compatibility-matrix.md
```

---

## Data model

```ts
export type PlanTier = "free" | "student" | "pro" | "pro+";

export type CapabilityState = "user-declared" | "verified" | "mismatch";

export type AccountLifecycleState = "active" | "pending-removal";

export interface CopilotAccountMeta {
  id: string;
  providerId: string;
  label: string;
  githubUsername: string;
  plan: PlanTier;
  capabilityState: CapabilityState;
  lifecycleState: AccountLifecycleState;
  addedAt: string;
  lastValidatedAt?: string;
}

export interface CopilotSecretRecord {
  accountId: string;
  githubOAuthToken: string;
  copilotAccessToken?: string;
  copilotAccessTokenExpiresAt?: string;
}
```

Note:
- `githubOAuthToken` and `copilotAccessToken` are intentionally separate because they may not be the same thing.

---

## Implementation risks to keep visible

1. **Auth/provider model may be impossible without unsupported hacks**
2. **Token chain may require exchange/refresh not yet modeled**
3. **OpenCode internal Copilot detection may change**
4. **Hardcoded plan-to-model tables may drift**
5. **Cross-platform file locking may be harder than expected**
6. **Raw terminal UX may fail in some shells/hosts**
7. **Best-effort compatibility and no version pinning still conflict with undocumented internals**
8. **GitHub/Copilot third-party usage may carry policy or ToS risk**

---

## Compatibility strategy

Because the user does not want version pinning, the plugin should:
- test against known OpenCode versions
- maintain a compatibility matrix
- perform startup checks for expected plugin/auth behavior where possible
- warn on unknown versions
- fail loudly when runtime assumptions appear broken

This does **not** remove risk; it only manages it.

---

## Suggested implementation order

1. Phase 0 feasibility spikes
2. Write `docs/feasibility-notes.md` with results
3. Decide whether architecture remains viable
4. Build single-account reference path
5. Add compatibility/runtime checks in the reference path
6. Add early tests for the reference path
7. Build account registry + secrets storage
8. Build multi-account routing and concurrency protections
9. Add capability exposure layer
10. Add TUI and account management UX
11. Add broader hardening, regression tests, and docs

---

## Explicit decisions still to make after feasibility work

These should be revisited once Phase 0 results exist:

1. Can one auth hook serve multiple providers, or is the project non-viable within current scope?
2. Can account capability be verified reliably, or must v1 stay user-declared with explicit override?
3. What exact token state must be stored and refreshed?
4. Is the OpenCode config-directory/storage strategy still acceptable after real tests?
5. Is the locking/package choice still acceptable after real tests?
6. How much of OpenCode’s internal login/auth flow can be reused directly?

---

## Bottom line

This project is viable **only if** the two core assumptions are proven:
- OpenCode can route auth correctly for multiple Copilot-like providers
- the real Copilot token flow can be reproduced safely and deterministically

Even if those assumptions hold, the result should still be treated as a **best-effort, compatibility-sensitive** integration rather than a stable host-guaranteed surface.

Until then, this is not an implementation problem — it is a feasibility problem.

That is the correct next step.

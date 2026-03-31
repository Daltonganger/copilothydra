# Native Keychain Integration Design

**Status:** Implemented in CopilotHydra 0.3.0  
**Decision date:** 2026-03-30  
**Primary goal:** Make CopilotHydra-managed GitHub Copilot accounts visible to OpenCode Bar through native macOS Keychain discovery, without requiring additional OpenCode Bar changes.

> **Implementation note (0.3.0):** This design is now implemented. CopilotHydra writes `copilot-cli`-compatible credential-store entries best-effort via `@napi-rs/keyring`, updates them on successful auth, and removes them during account deletion.

## Executive summary

CopilotHydra should **write `copilot-cli`-compatible Keychain entries** after successful GitHub device-flow login.

That means writing a generic password item with:

- **service:** `copilot-cli`
- **account:** `https://github.com:<githubUsername>`
- **password:** raw GitHub OAuth token as a UTF-8 string

This is the smallest, safest, and most compatible path because OpenCode Bar already reads exactly that format today.

## Final recommendation

### Choose this design

**Use `@napi-rs/keyring` as a best-effort writer for `copilot-cli`-compatible Keychain entries.**

### Do not choose these as the primary design

- **Hydra-specific keyring namespace only**
  - OpenCode Bar would not discover it without more code changes.
- **Dual-write as the primary source of truth**
  - Increases drift and cleanup complexity.
- **Plaintext-only secrets as the long-term answer**
  - Does not provide native integration.

## Why this is the right design

### 1. OpenCode Bar already supports it

OpenCode Bar's `TokenManager` already discovers native GitHub Copilot credentials from Keychain by reading generic password items under service `copilot-cli`.

Current expected format in OpenCode Bar:

- `kSecClass = generic password`
- `kSecAttrService = "copilot-cli"`
- `kSecAttrAccount = "https://github.com:<username>"`
- `kSecValueData = <raw GitHub OAuth token>`

Because this path already exists, CopilotHydra can integrate natively without waiting on OpenCode Bar changes.

### Confirmed native consumer compatibility

- **OpenCode Bar:** confirmed from source inspection — it reads `copilot-cli` generic-password items from macOS Keychain and supports multiple accounts.

### Important non-goals / non-compatible consumers

- **AIUsageTracker:** does **not** read `copilot-cli` keychain entries; it reads GitHub CLI credentials (`gh auth token` / `hosts.yml`).
- **opencode-quota:** does **not** read `copilot-cli` keychain entries; it reads OpenCode `auth.json`.

So this design gives immediate automatic compatibility with **OpenCode Bar**, but not with those two tools without upstream changes in those repositories.

### 2. It improves security immediately

Today CopilotHydra's local secret story still revolves around `copilot-secrets.json` in the OpenCode config directory. Even with `0600` permissions and file locking, that remains plaintext-on-disk storage.

Writing the token into the OS credential store gives:

- encrypted-at-rest storage on macOS
- system access controls
- less risk from backups/sync tools copying plaintext secrets

### 3. It is the smallest change with the highest compatibility payoff

This design does **not** require:

- a new OpenCode Bar credential source
- a Hydra-specific Keychain schema
- a simultaneous release across two repos

It only requires CopilotHydra to publish credentials in the format OpenCode Bar already consumes.

### 4. It gives a useful fallback when plugin behavior regresses

If CopilotHydra's plugin/runtime integration regresses, the Keychain entry still gives OpenCode Bar a native way to discover the GitHub Copilot token.

It is also likely useful for tools that follow the same `copilot-cli` Keychain convention, though that should be treated as a compatibility bonus rather than a formal guarantee.

## Important architecture finding

CopilotHydra currently has **two distinct auth/storage stories**:

### A. Real runtime auth path

The hot path is OpenCode's own auth callback storage:

- CopilotHydra obtains the GitHub OAuth token via device flow
- returns it through `AuthOAuthResult.callback()`
- OpenCode stores it in its own auth state
- request-time loading later goes through `getAuth()`

This is what actually powers runtime request routing.

### B. CopilotHydra local secrets file

`copilot-secrets.json` is used for Hydra-local concerns such as:

- usage snapshot reads
- audit/repair logic
- cleanup bookkeeping

It is **not** currently the authoritative runtime token source for routed requests.

### Implication

The safest near-term design is:

- keep the existing auth callback behavior intact
- add a best-effort Keychain write after successful login
- do not block successful auth if Keychain persistence fails

## Exact required Keychain format

CopilotHydra must write **exactly**:

```text
service = "copilot-cli"
account = "https://github.com:<username>"
password = <raw GitHub OAuth token>
```

### Notes

- The `account` string must contain a colon before the username, not a slash.
- The password must be the raw token string, not JSON.
- OpenCode Bar can backfill extra metadata later by calling GitHub APIs with the token.

## Library choice

### Recommended library

Use **`@napi-rs/keyring`**.

Why:

- macOS Keychain support
- prebuilt native binaries
- works in Node 18+
- usable from a strict ESM TypeScript project via dynamic import
- avoids old `keytar` maintenance concerns

### How to consume it

Treat it as an **optional runtime capability**.

Do **not** make successful login depend on successful Keychain writes.

Preferred pattern:

- lazy `import()`
- wrapped in `try/catch`
- if unavailable or failing: warn and continue

## Design choice details

### Primary decision

**Write `copilot-cli`-compatible entries only.**

### Why not dual-write as the primary design

Dual-writing a Hydra-specific keyring namespace **and** `copilot-cli` entries creates extra consistency problems:

- two places to invalidate on logout
- two places to audit
- more subtle drift bugs
- more confusing operator support

If Hydra later wants its own private keyring namespace for internal-only state, that should be a separate, explicit phase—not part of the minimum native integration work.

## File-level implementation plan

## 1. Add a new storage helper

Create a new module:

- `src/storage/copilot-cli-keychain.ts`

Suggested responsibilities:

- lazy-load `@napi-rs/keyring`
- expose safe helper functions
- never log secrets
- best-effort conflict handling

Suggested API:

```ts
export async function setCopilotCLIKeychainToken(params: {
  githubUsername: string;
  githubOAuthToken: string;
}): Promise<{ ok: true } | { ok: false; reason: string }>;

export async function getCopilotCLIKeychainToken(githubUsername: string): Promise<string | null>;

export async function deleteCopilotCLIKeychainToken(githubUsername: string): Promise<void>;
```

## 2. Write after successful device-flow auth

Update both auth success paths:

- `src/index.ts`
- `src/auth/login-method.ts`

After these happen:

- token acquired
- `setTokenState(...)` called

then do a best-effort Keychain write using the account's GitHub username.

### Important rule

Return the normal `AuthOAuthResult` even if the Keychain write fails.

## 3. Delete on removal/revocation

Update account removal and any token invalidation path so the corresponding Keychain item is also removed.

Likely touchpoints:

- `src/account-removal.ts`
- any future logout/re-auth reset path that explicitly clears old tokens

## 4. Add conflict-aware overwrite logic

Before writing:

- read existing `copilot-cli` key for that username
- if missing: write
- if present and same token: no-op
- if present and different token:
  - if current code path is a fresh successful device-flow auth for that exact username, overwrite
  - otherwise log a warning and avoid silent clobbering

This avoids trampling a real `copilot-cli` credential unexpectedly.

## 5. Keep JSON fallback behavior for now

Do **not** try to rewrite the entire secrets architecture in the same change.

For this phase:

- keep `copilot-secrets.json` behavior as-is
- add native Keychain publishing on successful auth
- separately revisit whether Hydra's own secrets file should later migrate to Keychain

## Key implementation rules

### Rule 1 — Match the OpenCode Bar format exactly

Any deviation in service or account naming will break discovery.

Correct format:

```text
service = "copilot-cli"
account = "https://github.com:<username>"
```

### Rule 2 — Best-effort only

A Keychain failure must not break successful login.

If Keychain is unavailable or writing fails:

- log a warning
- continue normal auth success flow

### Rule 3 — Delete before write when updating

To avoid duplicate-item or overwrite edge cases across backends:

- attempt delete first
- then set password

This reduces platform/backend weirdness.

### Rule 4 — Never log token values

Even in debug mode:

- no token content
- no serialized secret payloads
- no account+token dumps

### Rule 5 — Cleanup must be symmetric

If CopilotHydra writes a `copilot-cli` Keychain item, removal/revocation must delete it.

Otherwise OpenCode Bar may keep discovering stale tokens after Hydra considers the account removed.

## Proposed implementation shape

### New module behavior

`src/storage/copilot-cli-keychain.ts` should:

1. build the account string from GitHub username
2. lazy-load `@napi-rs/keyring`
3. wrap all keychain operations in `try/catch`
4. return structured result objects instead of throwing in common failure cases
5. treat missing native dependency as a supported degraded mode

### Suggested internal helpers

```ts
function buildCopilotCLIAccountName(githubUsername: string): string {
  return `https://github.com:${githubUsername}`;
}

async function loadKeyring() {
  try {
    return await import("@napi-rs/keyring");
  } catch {
    return null;
  }
}
```

## Packaging guidance

CopilotHydra is currently:

- strict ESM
- built with `tsc`
- Node 18+

### Recommendation

Start with the simplest approach:

- add `@napi-rs/keyring` as a dependency
- use lazy runtime import
- verify local install and published package behavior on macOS first

### Important verification step

Because this introduces a native package, validate:

- local development install
- packaged npm install from a clean temp directory
- CLI/plugin runtime on Apple Silicon macOS

If package distribution needs adjustment later, handle that as a packaging follow-up, not as a reason to block the overall design.

## Migration policy

### Phase 1

Do **not** migrate `copilot-secrets.json` yet.

Phase 1 goal:

- native Keychain publishing for OpenCode Bar discovery
- no auth regression risk
- no cross-storage rewrite

### Phase 2 (optional)

Later, if desired, Hydra can decide whether to:

- keep JSON for local audit/snapshot state
- partially mirror into Keychain
- or move Hydra-local secret reads fully to Keychain

That is a separate security architecture decision.

## Failure modes and desired behavior

### Keyring import fails

Desired behavior:

- login succeeds
- warning logged
- no crash

### Keychain write fails

Desired behavior:

- login succeeds
- warning logged
- operator can still use normal plugin flow

### Existing entry belongs to another tool and token differs

Desired behavior:

- prefer explicit overwrite only immediately after fresh successful auth for the same username
- otherwise warn rather than silently clobber

### Account removed in Hydra but keychain entry remains

Desired behavior:

- remove the matching Keychain entry during finalize removal
- if deletion fails, warn clearly

## Testing plan

## Unit tests

Add tests for:

- account-name generation
- no-op when username is empty/invalid
- graceful behavior when keyring import fails
- overwrite policy when an entry already exists
- delete-on-removal behavior

## Manual macOS validation

### 1. Fresh auth

- authenticate a Hydra account
- confirm Keychain item exists
- inspect with `security find-generic-password -s copilot-cli`

### 2. OpenCode Bar discovery

- launch OpenCode Bar
- verify it discovers the account via native path
- verify quota/profile fetch succeeds

### 3. Multiple accounts

- auth two different GitHub usernames
- verify two `copilot-cli` entries exist
- verify OpenCode Bar sees both

### 4. Re-auth same username

- re-auth same Hydra account
- verify Keychain item is updated cleanly
- verify no duplicate stale item behavior

### 5. Removal

- remove account in Hydra
- verify corresponding Keychain entry is deleted
- verify OpenCode Bar no longer sees it

## Security notes

This design improves native integration and reduces plaintext dependence, but it does **not** by itself solve every secret-storage concern in the project because:

- OpenCode still stores auth state in its own host-managed storage path
- Hydra still has separate local bookkeeping concerns
- some operators may still have legacy plaintext files from earlier versions

So this should be described as:

- a native discovery/security improvement
- not the final universal secret-storage end-state

## Support boundary notes

This design should be considered:

- **fully intended on macOS**
- **best-effort on Linux/Windows** until verified
- **non-blocking** in environments where native keychain is unavailable

## Rollout recommendation

### Ship order

1. implement best-effort `copilot-cli` Keychain writes
2. test locally on macOS with multiple accounts
3. verify OpenCode Bar discovery without plugin-side changes
4. document fallback behavior when keyring is unavailable
5. only then consider wider secret-storage migration

## Bottom line

If the goal is:

> make CopilotHydra accounts show up natively in OpenCode Bar as GitHub Copilot accounts

then the correct implementation is:

**Write `copilot-cli`-compatible Keychain entries via `@napi-rs/keyring` after successful auth, best-effort, without changing OpenCode Bar.**

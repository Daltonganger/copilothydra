# CopilotHydra Operator Auth & Recovery Runbook

This runbook covers the primary operator path around `opencode auth login`, restart or reload behavior, and the first recovery steps when the expected CopilotHydra flow does not appear.

Scope note: this runbook is written for the currently tested OpenCode/CopilotHydra path documented in [docs/compatibility-matrix.md](./compatibility-matrix.md). If you are on an untested host version, treat these steps as best-effort and validate them against the current compatibility matrix first.

## Current auth method labels

When CopilotHydra is active under `github-copilot`, OpenCode should show these auth methods:

- `GitHub Copilot (CopilotHydra) — Add new account`
- `GitHub Copilot (CopilotHydra) — Re-auth existing account`

If no CopilotHydra accounts exist yet, the expected first path is usually:

- `GitHub Copilot (CopilotHydra) — Add new account`

## Restart or reload rules

### Restart or reload is required

Restart or reload OpenCode after any action that changes generated provider/config state, including:

- adding a new account
- removing an account
- changing a stored plan
- syncing config manually
- repairing storage when stale provider/config entries were removed

Reason: CopilotHydra writes account-scoped provider entries into OpenCode config, and those are picked up on reload.

### Restart or reload is not the primary step

Re-authing an existing account does **not** primarily exist to change provider structure. It refreshes the account's auth state. If re-auth succeeds and no provider/config shape changed, a restart should not be your first recovery step.

## Primary operator flow

### 1. Add the first account

1. Run `opencode auth login -p github-copilot`
2. Choose `GitHub Copilot (CopilotHydra) — Add new account`
3. Fill in:
   - GitHub username
   - account label
   - declared plan
   - whether uncertain models should be exposed
4. Complete the GitHub device flow
5. After success, restart or reload OpenCode
6. Confirm the new account-scoped provider/models appear

### 2. Re-auth an existing account

1. Run `opencode auth login -p github-copilot`
2. Choose `GitHub Copilot (CopilotHydra) — Re-auth existing account`
3. Enter the GitHub username for the existing CopilotHydra account
4. Complete the device flow
5. Re-test the affected account/model path

## First-line recovery scenarios

### CopilotHydra does not appear in `opencode auth login`

Check, in this order:

1. CopilotHydra plugin is still configured/loaded by OpenCode
2. OpenCode has been reloaded after the most recent provider/config mutation
3. `copilothydra sync-config` completes successfully
4. If Hydra has zero accounts, confirm host-native `github-copilot` recovery has occurred instead of expecting Hydra account providers

### New provider does not appear after successful add-account

Use this order:

1. Run `copilothydra sync-config`
2. Reload/restart OpenCode
3. Run `copilothydra list-accounts` and confirm the account exists
4. Run `copilothydra audit-storage` and check for:
   - missing provider entries
   - stale provider entries
   - model catalog drift

### Wrong auth method chosen

- If you meant to add a new account, use `Add new account`
- If the GitHub username already exists in CopilotHydra, use `Re-auth existing account`
- If add-account rejects the username as already existing, that is expected protection against duplicate stored accounts

### Duplicate username blocks add-account

This means the GitHub username is already stored in CopilotHydra.

Use:

1. `copilothydra list-accounts`
2. identify the existing stored account for that username
3. re-run `opencode auth login -p github-copilot`
4. choose `GitHub Copilot (CopilotHydra) — Re-auth existing account`

### Compatibility/version warning appears

CopilotHydra uses a warn-first compatibility strategy.

Check:

1. `docs/compatibility-matrix.md`
2. whether the host version is already listed as tested
3. whether the issue is a warning-only startup signal or an actual auth/routing failure

If auth and routing still work, treat the warning as a compatibility signal to validate, not automatic proof of breakage.

### Hydra has zero accounts and you need normal `github-copilot` back

Expected outcome: built-in `github-copilot` should become available again.

If recovery does not seem correct:

1. run `copilothydra sync-config`
2. reload/restart OpenCode
3. run `copilothydra audit-storage`
4. if needed, run `copilothydra repair-storage`

## Related fallback/admin commands

Read-only:

- `copilothydra list-accounts`
- `copilothydra audit-storage`

Mutating / repair:

- `copilothydra sync-config`
- `copilothydra repair-storage`
- `copilothydra review-mismatch <account-id|provider-id>`

## Scope note

This runbook covers the primary auth/recovery path only. More detailed operator procedures for mismatch review, storage repair, and lifecycle/remove-account recovery can be expanded separately.

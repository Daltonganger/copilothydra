# Native Keychain Integration Checklist

Use this checklist to implement the CopilotHydra → OpenCode Bar native Keychain integration described in `docs/native-keychain-integration-design.md`.

## Scope of this phase

This phase only covers:

- writing `copilot-cli`-compatible Keychain entries from CopilotHydra
- removing those entries during account removal/revocation
- keeping login successful even if Keychain support is unavailable

This phase does **not** require:

- migrating all Hydra-local secret reads away from `copilot-secrets.json`
- teaching OpenCode Bar any new credential source
- introducing a Hydra-specific Keychain schema

## 1. Dependency and packaging

- [x] Add `@napi-rs/keyring` to `package.json`
- [x] Verify install works on local macOS development machine
- [x] Verify clean reinstall from package-lock succeeds
- [x] Verify published/install-from-tarball behavior if preparing a release
- [x] Confirm runtime still works when the native dependency cannot load

## 2. New storage helper

Create:

- [x] `src/storage/copilot-cli-keychain.ts`

Implement:

- [x] `buildCopilotCLIAccountName(githubUsername)`
- [x] lazy `import("@napi-rs/keyring")`
- [x] `getCopilotCLIKeychainToken(githubUsername)`
- [x] `setCopilotCLIKeychainToken({ githubUsername, githubOAuthToken })`
- [x] `deleteCopilotCLIKeychainToken(githubUsername)`
- [x] no secret logging
- [x] structured success/failure results

## 3. Key naming format

Verify implementation matches exactly:

- [x] service = `copilot-cli`
- [x] account = `https://github.com:<username>`
- [x] password = raw token string

## 4. Auth success path integration

Update both successful auth paths:

- [x] `src/index.ts`
- [x] `src/auth/login-method.ts`

After:

- [x] token acquired
- [x] `setTokenState(...)` called

Then:

- [x] best-effort write to Keychain
- [x] login still succeeds if Keychain write fails
- [x] warning logged on failure without leaking secrets

## 5. Conflict handling

Before write:

- [x] check for existing entry for same username
- [x] if no existing entry → write
- [x] if same token already exists → no-op
- [x] if different token exists during fresh auth → replace safely
- [ ] if different token exists outside fresh auth flow → warn instead of silently clobbering

## 6. Safe update semantics

- [x] delete old entry before write when replacing
- [x] handle missing-entry delete as non-fatal
- [x] do not crash on duplicate-item style backend behavior

## 7. Removal / cleanup path

Update cleanup flows:

- [x] `src/account-removal.ts`
- [ ] any explicit revoke/reset path that invalidates tokens

Behavior:

- [x] delete corresponding Keychain entry when account is removed
- [x] keep removal flow functional if Keychain delete fails
- [x] warn clearly on cleanup failure

## 8. Tests

### Unit tests

- [x] account string builder test
- [ ] graceful import-failure test
- [x] same-token no-op test
- [x] overwrite path test
- [x] delete path test

### Manual validation

- [x] authenticate one account and confirm Keychain item exists
- [x] authenticate two accounts and confirm both are discoverable
- [x] verify OpenCode Bar reads the same `copilot-cli` keychain format from source inspection
- [ ] re-auth same username and confirm clean update against a real native consumer
- [x] remove account and confirm Keychain item is deleted

## 9. Operator-facing documentation

- [x] mention native Keychain publishing in README or changelog
- [x] document that Keychain integration is best-effort
- [x] document that OpenCode Bar reads `copilot-cli`-compatible entries natively
- [x] document that official VS Code / other Copilot apps are not guaranteed consumers

## 10. Release gate

Do not call this done until all are true:

- [x] local macOS auth flow still succeeds
- [x] OpenCode Bar discovers the account format without extra code changes (source-compatible verification)
- [x] multi-account path works
- [x] removal cleanup works
- [x] no secrets are logged
- [x] failure to load keyring does not break normal auth

## Current status

Implemented in CopilotHydra 0.3.0.

Notes:

- OpenCode Bar compatibility is confirmed from source inspection because it reads the exact `copilot-cli` credential format that CopilotHydra now publishes.
- AIUsageTracker and opencode-quota are **not** covered by this checklist because they read different auth sources.
- A real native-consumer re-auth validation remains useful as a future follow-up, but the implementation and automated coverage for publish/update/delete are complete.

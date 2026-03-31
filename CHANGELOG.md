# Changelog

## 0.3.4 (2026-03-31)

### What's new

- **Hide built-in GitHub Copilot while Hydra is active** — config sync now disables the built-in `github-copilot` provider whenever active Hydra accounts exist, so the normal GitHub Copilot model catalog no longer appears alongside Hydra-managed account providers.
- **Dedicated Hydra login provider** — the add-account / re-auth entrypoint now uses `github-copilot-hydra`, so Hydra setup stays discoverable in `opencode auth login` even while built-in `github-copilot` is disabled.
- **Student override for unsupported Claude models** — Student accounts can now explicitly enable `claude-sonnet-4.5` and `claude-opus-4.5` during setup, while keeping them hidden by default because GitHub does not officially document them for that plan.
- **Operator guidance updated** — recovery and re-auth docs now point to `opencode auth login -p github-copilot-hydra`.

### Tests

- 152 tests total.
- Sync, login-method, black-box, capabilities, and TUI coverage updated for built-in provider hiding, the renamed Hydra setup provider, and the new student override flow.

---

## 0.3.3 (2026-03-31)

### What's new

- **Windows file permission hardening** — after writing `copilot-secrets.json` and `copilot-accounts.json` on Windows, CopilotHydra now calls `icacls ... /inheritance:r /grant:r "<username>:F"` to apply DACL restrictions equivalent to the Unix `chmod 0600` already in place on macOS/Linux.
- **Plan pre-verification** — when adding an account, CopilotHydra now calls `api.github.com/copilot_internal/user` with the freshly-obtained OAuth token and warns if the declared plan tier does not match what the API reports. The warning is non-blocking and is skipped gracefully on any error, timeout, or missing field.
- **`copilothydra status` command** — new dashboard showing all accounts with their capability state, storage health, config sync status, and native keychain coverage. Prints actionable hints (`sync-config`, `backfill-keychain`, `repair-storage`) only when relevant issues are detected.

### Tests

- 150 tests total (unchanged count — new features are runtime-only on Windows and post-auth callback paths covered by the existing blackbox suite).
- Blackbox test mocks updated to return HTTP 401 for the plan-verify endpoint so the check skips gracefully in test environments.

---

## 0.3.2 (2026-03-31)

### What's new

- Added **single-primary compatibility exports** for tools that currently only support one Copilot/GitHub auth source.
- New command: `copilothydra export-primary-compat <account-id|provider-id>`

### Integrations

- **OpenCode Bar** — native keychain integration remains the preferred path.
- **AIUsageTracker** — compatibility export writes a GitHub CLI `hosts.yml` entry if no existing `github.com` token entry exists.
- **opencode-quota** — compatibility export writes an OpenCode `auth.json` `github-copilot` alias if no primary Copilot auth entry exists.

### Safety rules

- CopilotHydra does **not** overwrite existing GitHub CLI `hosts.yml` auth.
- CopilotHydra does **not** overwrite existing OpenCode primary Copilot auth aliases.
- These integrations are therefore **single-primary** only; full multi-account support still requires upstream changes in those tools.

### Tests

- 150 tests total.
- Added dedicated primary-compat export tests for write / skip / cleanup / CLI behavior.

---

## 0.3.1 (2026-03-31)

### Fixes

- Added `copilothydra backfill-keychain` for existing accounts created before 0.3.0.
- Existing active accounts can now be published into the native `copilot-cli` credential-store format without re-auth.

### Usage

```bash
copilothydra backfill-keychain
```

This is mainly for users who upgraded to 0.3.x and want OpenCode Bar to immediately discover already-configured Hydra accounts.

---

## 0.3.0 (2026-03-31)

### What's new

- **Native keychain integration** via `@napi-rs/keyring`.
- After successful auth, CopilotHydra now publishes `copilot-cli`-compatible OS credential-store entries:
  - service: `copilot-cli`
  - account: `https://github.com:<githubUsername>`
  - password: raw GitHub OAuth token
- Account removal now deletes the matching native keychain entry best-effort.

### Confirmed compatibility

- **OpenCode Bar**: confirmed native discovery on macOS via `copilot-cli` Keychain format.

### Not automatic / requires upstream changes

- **AIUsageTracker** does not read `copilot-cli` keychain entries; it uses GitHub CLI credentials (`gh auth token` / `hosts.yml`).
- **opencode-quota** does not read `copilot-cli` keychain entries; it reads OpenCode `auth.json`.

### Tests

- 143 tests total.
- New dedicated keychain module tests.
- New black-box assertions for keychain publish on auth success.
- New removal assertion for keychain cleanup on account deletion.

---

## 0.2.1 (2026-03-30)

### Changes
- OpenCode 1.20.x series added as tested and supported (full patch range).
- Removed `COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM` requirement — plaintext token storage is now the documented and accepted default, no env var gate needed.

### Compatibility
- Tested: OpenCode 1.3.0, 1.3.2, 1.3.3, 1.20.x

---

## 0.2.0 (2026-03-30)

First stable release. All hard blockers from the beta/hardening phase resolved.

### Breaking changes

- `CapabilityState` type no longer includes `"verified"` — this value was never reachable and has been removed. Stored accounts with `capabilityState: "verified"` (none should exist) will be treated as `"user-declared"` on next load.

### What's new

- **Plaintext secret storage formally accepted** — consistent with the norm established by other OpenCode auth plugins. `COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM=1` required to write secrets. Full risk-acceptance rationale in `docs/plaintext-secret-storage-decision.md`.
- **Mismatch messages improved** — "A lower plan tier may match your actual entitlement" replaces "Suggested stricter stored plan". No-suggestion case now explains enterprise-only/org-restricted possibility.
- **Restart notice in OpenCode UI** — the `instructions` field shown during `opencode auth login` now includes a reload/restart reminder for new-account flows.
- **Operator runbooks** — `docs/operator-mismatch-review-runbook.md` and `docs/operator-storage-repair-runbook.md` added.
- **Canonical known-limitations list** in `docs/support-boundaries.md`.
- **Forward-match documented** — `shouldUseCopilotResponsesApi` forward-matches all `gpt-5.x` variants except `gpt-5-mini`; documented in `docs/compatibility-matrix.md`.

### Fixes

- `KNOWN_GOOD_VERSIONS` now includes `1.3.0`, `1.3.2`, and `1.3.3` (was only `1.3.3`).
- Provider `doGenerate`/`doStream` methods are now `.bind()`-ed before wrapping — fixes `this.getArgs` crash on class-backed SDK models (e.g. `claude-opus-4.6`).
- 8-account framing unified across docs as a deliberate architecture boundary.
- Beta status header added to all operator-facing docs.

### Tests

- 134 tests total (up from 112 at `0.1.0-beta.2`).
- New: device-flow coverage (10 tests), permission hardening (5 tests), multi-account blackbox routing, callback-failure blackbox, GPT-5 routing + forward-match + sentinel-override, full `isCapabilityMismatchError` pattern coverage.

---

## 0.1.0-beta.2 (2026-03-28)

- Provider error payload normalization.
- Account usage snapshots (`copilothydra usage`).
- `copilothydra audit-storage` model catalog drift detection.
- 8-account slot limit guard.
- Responses API parity improvements.

## 0.1.0-beta (2026-03-27)

Initial beta release.

- Multi-account OpenCode plugin with `opencode auth login` integration.
- Account-scoped providers, mismatch detection, sync/audit/repair CLI.
- GPT-5+/Responses/Codex routing.
- Warn-first OpenCode version compatibility.

# Changelog

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

# CopilotHydra Release Checklist

This checklist is the current gate for deciding when CopilotHydra can move from beta/hardening work toward a stable release.

## Current release posture

- **Current posture:** beta / hardening phase
- **Do not call stable yet** while plaintext secret storage remains beta-only and compatibility validation remains narrow
- **Current beta target:** `0.2.1` for GitHub.com Copilot on OpenCode `1.3.x` and `1.20.x`.

## Stable-release gate

Mark each section materially complete before calling CopilotHydra stable.

### 1. Host compatibility

- [ ] Tested OpenCode versions are listed in `docs/compatibility-matrix.md`
- [ ] Unknown-version behavior remains warn-first and does not silently break login/routing
- [ ] Built-in `github-copilot` coexistence and recovery are verified on tested host versions

**Audit findings (2026-03-30):**

- ✅ `KNOWN_GOOD_VERSIONS` fixed: now contains `"1.3.0"`, `"1.3.2"`, `"1.3.3"` matching the matrix. Regression test added (`compatibility-warning.test.js`).
- ✅ `KNOWN_GOOD_VERSIONS` sync divergence documented here as a manual process risk; no automated guard yet.
- ⚠️ Coexistence logic is unit-tested but never validated against a real OpenCode host process. Black-box evidence is absent.
- ⚠️ Legacy `copilothydra.managedDisabledProviders` config key migration path is untested in docs — operators upgrading from earlier betas have no visibility into this.
- ✅ `SKIP_VERSION_CHECK` flag bypass path: module-level const makes in-process testing unreliable; warn-first contract is covered by the untested-version warning test instead.

### 2. Auth recovery

- [ ] `opencode auth login` add-account flow works on tested host versions
- [ ] Re-auth flow works on tested host versions
- [ ] Zero-account recovery restores host-native `github-copilot` correctly
- [ ] Restart/reload requirements are documented and verified

**Audit findings (2026-03-30):**

- ✅ `src/auth/device-flow.ts` now covered by `tests/device-flow.test.js` — 10 tests: happy path, `slow_down`, `authorization_pending`, `expired_token`, `access_denied`, timeout, network failure.
- ⚠️ No black-box host test — "works on tested host versions" requires an actual `opencode auth login` invocation against a real host, not module imports.
- ⚠️ Restart instruction is emitted via `info("auth", ...)` to stderr only — it is not included in `AuthOAuthResult.instructions`. Operators watching the OpenCode auth UI may never see the restart notice.
- ⚠️ `operator-auth-recovery-runbook.md` does not mention that `CopilotHydraSetup` auto-calls `recoverHostNativeCopilotState` on startup — operators may run manual recovery unnecessarily.
- ⚠️ Re-auth does not re-sync provider config; if config was corrupted between logins, re-auth silently leaves it broken.
- ⚠️ No test for `recoverHostNativeCopilotState` failure (error is swallowed with a warning).

### 3. Regression coverage

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Black-box host regression coverage exists for plugin discovery, auth login, and post-restart routed requests

**Audit findings (2026-03-30):**

- ✅ `npm run build`, `npm run typecheck`, and `npm test` (119/119) all pass.
- ⚠️ `tests/opencode-blackbox.test.js` tests plugin-boundary behavior with a **stubbed** host (`PLUGIN_INPUT` is synthetic). This is genuine black-box testing of the plugin surface but does not exercise a real OpenCode process. If OpenCode changes how it calls plugins, these tests will not catch it.
- ⚠️ No multi-account post-restart blackbox test.
- ⚠️ No error-path blackbox tests (device-flow failure, missing secret on restart, zero-account recovery at plugin boundary).

### 4. Storage safety

- [ ] Accounts/config writes remain atomic and recoverable
- [ ] Corrupt storage quarantine and repair flows are verified
- [ ] Plaintext secret-file permission hardening is working where supported
- [ ] A stable-release decision exists for replacing or formally accepting plaintext secret storage

**Audit findings (2026-03-30):**

- ✅ Atomic write pattern (write-to-`.tmp`-then-`rename`), lockfiles, and quarantine/recovery are well-implemented and well-tested.
- ✅ Corrupt storage quarantine and repair are covered across 6+ test files.
- ⚠️ Atomic write: orphaned `.tmp` files (crash between write and rename) are not detected or cleaned up in load or repair paths.
- ✅ Permission hardening tests added (`tests/storage-recovery.test.js`): new file created with `0o600`, `0o644` detected as insecure, `normalizeSecretsFilePermissions` fixes to `0o600`, missing file returns `"missing"`, already-ok returns no-op.
- ✅ **Plaintext secret storage formally accepted.** See `docs/plaintext-secret-storage-decision.md`. Consistent with established norm (`opencode-antigravity-auth` ships stable with identical model). Keychain deferred to future phase.

### 5. Capability truth

- [ ] Declared-plan exposure and runtime mismatch handling are consistent
- [ ] Mismatch review/apply flow is understandable for operators
- [ ] Downgrade suggestions do not overclaim certainty or mislead on unknown models

**Audit findings (2026-03-30):**

- ⚠️ No integration test exercises the loader→mismatch detection chain. The `loader.ts` 400/403 interception path is only tested indirectly through unit tests on helper functions, never through an actual HTTP response body.
- ⚠️ `capabilityState: "verified"` is a dead enum value — no code path ever sets it to `"verified"`. Logic branches that depend on it can never fire in production.
- ✅ Mismatch-review operator runbook available at `docs/operator-mismatch-review-runbook.md`.
- ✅ Mismatch message wording improved: "A lower plan tier may match your actual entitlement" replaces "Suggested stricter stored plan". No-suggestion message now mentions enterprise-only/org-restricted possibility. All `isCapabilityMismatchError` patterns covered by tests.
- ⚠️ Non-TTY `review-mismatch` (e.g., CI) gives zero actionable guidance.

### 6. GPT-5+/Responses/Codex boundary

- [ ] Current support boundary is documented in `docs/compatibility-matrix.md`
- [ ] Supported GPT-5+/Responses/Codex paths are covered by regression tests
- [ ] Any unsupported or unverified parity surface is explicitly documented as best-effort or out of scope

**Audit findings (2026-03-30):**

- ✅ Boundary documentation in `docs/compatibility-matrix.md` and `docs/support-boundaries.md` is clear and well-structured with explicit supported/best-effort tiers.
- ✅ Unsupported surfaces are explicitly documented as best-effort or out of scope.
- ⚠️ All regression tests are unit-level. No integration test exercises `createHydraCopilotProvider().languageModel("gpt-5")` end-to-end through the real SDK factory. The `createHydraCopilotProvider` test only calls `provider.languageModel(...)` and asserts `doesNotThrow` — it never calls `doGenerate` or `doStream` on a GPT-5+ model.
- ⚠️ No regression test for the `doGenerate` path (non-streaming) on GPT-5+ models.
- ⚠️ `RESPONSES_SENTINEL_API_KEY = "copilothydra-managed"` is passed to `createOpenAI` when no real key is provided. No test validates that the auth loader's bearer-token injection actually overrides this sentinel before requests hit the API.
- ⚠️ Forward-matching behavior (`shouldUseCopilotResponsesApi` returns `true` for any unknown future `gpt-5.x`) is undocumented. New model variants will silently route to Responses API.

### 7. Operator readiness

- [ ] README and docs clearly state current beta/stable status
- [ ] Known limitations are documented consistently across docs
- [ ] Operator runbooks for login, mismatch review, and repair are available or explicitly deferred
- [ ] Supported, best-effort, and out-of-scope boundaries (including enterprise-managed GitHub.com and GHES) are documented consistently

**Audit findings (2026-03-30):**

- ✅ Beta status header added to `docs/support-boundaries.md`, `docs/compatibility-matrix.md`, and `docs/operator-auth-recovery-runbook.md`.
- ✅ Mismatch-review runbook available at `docs/operator-mismatch-review-runbook.md`. Storage-repair runbook available at `docs/operator-storage-repair-runbook.md`. Deferred-runbook notice added to auth runbook scope section.
- ⚠️ Known limitations are scattered across README, `support-boundaries.md`, and `OPENCODE_INTEGRATION_PARITY.md` with no canonical list and inconsistent framing.
- ✅ `support-boundaries.md` now includes a plaintext secret storage security note in the best-effort section.
- ✅ 8-account limit framing unified in `support-boundaries.md` as a deliberate architecture boundary.
- ✅ Support boundaries including enterprise-managed GitHub.com and GHES are clearly documented in `docs/support-boundaries.md`.

Current status:

- Auth/restart recovery runbook: available in `docs/operator-auth-recovery-runbook.md`
- Mismatch-review runbook: available in `docs/operator-mismatch-review-runbook.md`
- Storage-repair runbook: available in `docs/operator-storage-repair-runbook.md`

## Current blockers for stable

Ordered by impact. Items marked 🔴 are hard blockers. Items marked ⚠️ are significant gaps that need resolution or explicit acceptance.

### Hard blockers 🔴

*All hard blockers resolved. See "Resolved since initial audit" below.*

### Significant gaps ⚠️

1. **No GPT-5+ integration test** via the real `createHydraCopilotProvider()` factory — all coverage is unit-level.
2. **Black-box tests use a stubbed host** — no real OpenCode process is ever exercised.
3. **Known limitations scattered across 3+ docs** — no canonical list, inconsistent framing.
4. **`capabilityState: "verified"` is dead code** — no path ever sets it; related branches can never fire.
5. **`RESPONSES_SENTINEL_API_KEY` override by auth loader is untested.**
6. **Forward-matching for unknown future `gpt-5.x` variants is undocumented.**

### Resolved since initial audit ✅

- ~~`KNOWN_GOOD_VERSIONS` diverges from the compatibility matrix~~ — **fixed**: `1.3.0`, `1.3.2`, `1.3.3` now all in code; regression tests added.
- ~~Permission hardening is untested~~ — **fixed**: 5 permission tests added to `tests/storage-recovery.test.js`.
- ~~Mismatch-review and storage-repair runbooks are absent~~ — **fixed**: `docs/operator-mismatch-review-runbook.md` and `docs/operator-storage-repair-runbook.md` written.
- ~~Beta status absent from operator-facing docs~~ — **fixed**: beta header added to `support-boundaries.md`, `compatibility-matrix.md`, `operator-auth-recovery-runbook.md`.
- ~~Plaintext secrets absent from `support-boundaries.md`~~ — **fixed**: security note added to best-effort section.
- ~~8-account framing inconsistent~~ — **fixed**: unified framing in `support-boundaries.md`.
- ~~`SKIP_VERSION_CHECK` flag bypass path is untested~~ — **documented**: module-level const makes in-process testing unreliable; warn-first contract covered by untested-version warning test.
- ~~No plaintext-secret storage decision~~ — **formally accepted**: see `docs/plaintext-secret-storage-decision.md`. Consistent with `opencode-antigravity-auth` (the established norm). Keychain deferred to future phase.
- ~~`device-flow.ts` has zero test coverage~~ — **fixed**: `tests/device-flow.test.js` with 10 tests: happy path, `slow_down`, `authorization_pending`, `expired_token`, `access_denied`, timeout, network failure.
- ~~Downgrade suggestion language overclaims certainty~~ — **fixed**: message now says "A lower plan tier may match your actual entitlement" and explains enterprise-only/org-restricted cases. Full pattern coverage added to `tests/capabilities.test.js`.
- ~~Restart instruction is stderr-only~~ — **fixed**: `instructions` field now includes "reload or restart OpenCode" for new-account flows. Re-auth omits it correctly. Tests updated.
- ~~Black-box tests cover only single-account happy path~~ — **fixed**: multi-account routing test (2 accounts, isolated tokens post-restart) and callback-failure test (`access_denied` → `{ type: "failed" }`) added to `tests/opencode-blackbox.test.js`.

## Cross-document inconsistencies

| # | Issue | Docs | Status |
|---|---|---|---|
| I-1 | Beta status absent from operator docs | README vs operator docs | ✅ Fixed |
| I-2 | Plaintext secrets absent from `support-boundaries.md` | README vs support-boundaries | ✅ Fixed |
| I-3 | Mismatch runbook referenced but missing | runbook, OPENCODE_INTEGRATION_PARITY | ✅ Fixed |
| I-4 | `KNOWN_GOOD_VERSIONS` in code ≠ matrix | src/auth/compatibility-check.ts vs compatibility-matrix.md | ✅ Fixed |
| I-5 | 8-account limit framed inconsistently | README, support-boundaries, OPENCODE_INTEGRATION_PARITY | ✅ Fixed |
| I-6 | Plan tier list only in `support-boundaries.md` | support-boundaries (sole source) | 🟡 Open — low risk |

## Release decision rule

- If one or more sections above are still materially incomplete, treat CopilotHydra as **beta / hardening-phase software**.
- Only call it **stable** when those blockers are removed or explicitly accepted in project policy.

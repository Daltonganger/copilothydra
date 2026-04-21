# CopilotHydra — Technical Reference

**Stable — v0.3.8.** This document covers the OpenCode compatibility matrix, release gate status, and storage security posture.

---

## OpenCode compatibility matrix

CopilotHydra uses a **warn-first compatibility policy**. Unknown versions do not hard-fail on their own, but the plugin logs warnings when the host version is untested or expected `PluginInput` signals are missing.

### Detection strategy

`src/auth/compatibility-check.ts` inspects only signals available on the plugin hook input — top-level `PluginInput` fields and version-like fields on `PluginInput`, `client`, `project`, `worktree`, and `$`. No network probing or undocumented host calls are performed.

### Tested versions

| OpenCode version | Status | Notes |
|---|---|---|
| 1.3.0 | Tested | Locally verified during auth/login takeover behavior |
| 1.3.2 | Tested | Locally verified during startup-noise/auth-login hardening |
| 1.3.3 | Tested | Locally verified during Hydra auth/login + provider parity hardening |
| 1.20.x | Tested | Locally verified on OpenCode 1.20.x series; full patch range supported |

### Warning cases

CopilotHydra warns when:
- a detectable OpenCode version is not in the tested matrix
- `PluginInput.directory` is missing or not a non-empty string
- `PluginInput.serverUrl` is missing or not a non-empty string/URL

### Built-in `github-copilot` coexistence and recovery

- Unknown/untested OpenCode versions remain warn-first, not hard-failing
- Config sync removes only Hydra-managed `github-copilot` disable state
- Zero-account recovery restores host-native `github-copilot` on startup

Implementation references: `src/auth/compatibility-check.ts`, `src/config/sync.ts`, `src/index.ts`

### Current model baseline and Responses boundary

**Supported today:**
- Current personal-plan baseline aligned to GitHub's published Copilot model matrix: GPT-4.1, GPT-5 mini / 5.2 / 5.2-Codex / 5.3-Codex / 5.4 / 5.4 mini, Claude Haiku 4.5, Claude Sonnet 4 / 4.5 / 4.6, Claude Opus 4.7 (`pro+`), Gemini 2.5 Pro / 3 Flash / 3.1 Pro, Grok Code Fast 1, Raptor mini, and Goldeneye (Free)
- GPT-5-family routing through Hydra's local provider wrapper
- Routing selection for the current Responses boundary (`gpt-5*` except `gpt-5-mini`)
- Text-generation flows covered by current Responses parity tests
- Tool-only stream passthrough without synthetic text boundaries
- Mixed text/non-text chunk preservation with normalized single-text-part output
- Account-scoped request routing with Hydra-managed bearer-token injection

**Retired from the current documented baseline:** `gpt-5`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `claude-opus-41`, and `gemini-3-pro-preview`.

**Forward-matching note:** `shouldUseCopilotResponsesApi` returns `true` for any model ID starting with `gpt-5` except `gpt-5-mini`. Unknown future `gpt-5.x` variants automatically route to Responses API — best-effort until explicitly tested.

**Best-effort / not guaranteed:**
- Broader Codex-adjacent or tool-heavy Responses event surfaces
- Future OpenCode/GitHub Copilot response event shapes
- Full equivalence with OpenCode's exact built-in `CUSTOM_LOADERS["github-copilot"]` behavior

If a compatibility warning appears: confirm the OpenCode version, verify `opencode auth login` and routed Copilot requests still work, and capture the warning + host version for future matrix updates.

---

## Release gate status

**Current posture: stable (v0.3.8)**  
Tested with OpenCode 1.3.x and 1.20.x.  
Storage: hybrid — native credential-store publishing best-effort + `copilot-secrets.json` for Hydra-local bookkeeping/fallback.

### Gate sections

**1. Host compatibility** — ✅ Tested versions in matrix. Warn-first for unknown versions. Coexistence + zero-account recovery unit-tested.

**2. Auth recovery** — ✅ Device flow covered (10 tests). Restart instruction in `instructions` field for new-account flows. Multi-account routing and callback-failure black-box tests added.

**3. Regression coverage** — ✅ 179 tests. `npm run build`, `npm run typecheck`, `npm test` all pass. Black-box tests use a stubbed host (no real OpenCode process exercised — accepted gap).

**4. Storage safety** — ✅ Atomic writes, lockfiles, quarantine/recovery well-tested. Permission hardening (create `0600`, normalize insecure files) tested. Plaintext storage formally accepted (see below).

**5. Capability truth** — ✅ Declared-plan exposure and mismatch handling consistent. `capabilityState: "verified"` dead code removed. Mismatch message wording: "A lower plan tier may match your actual entitlement". Operator runbook available.

**6. Current model baseline / Responses boundary** — ✅ Current personal-plan baseline documented. `RESPONSES_SENTINEL_API_KEY` override tested. Forward-matching documented and tested. (Gap: no true end-to-end live-host GPT-5+ validation — accepted.)

**7. Operator readiness** — ✅ Stable status in docs. Known limitations list canonical. Operator guide at `docs/OPERATORS.md`. Support boundaries documented.

### Remaining accepted gaps

1. **No live-host GPT-5 Responses integration test** via real `createHydraCopilotProvider()` factory — mostly unit-level coverage.
2. **Black-box tests use stubbed host** — no real OpenCode process exercised.
3. **Non-TTY mismatch guidance** remains limited.

---

## Secret storage decision

**Decision date:** 2026-03-30  
**Decision:** Formally accept plaintext storage with existing mitigations as sufficient for stable release.

### Context

CopilotHydra stores GitHub OAuth tokens in `copilot-secrets.json` as plaintext JSON for Hydra-local bookkeeping. As of 0.3.0, `copilot-cli`-compatible native credential-store entries are also published best-effort via `@napi-rs/keyring`, but the JSON file is retained as bookkeeping and fallback.

### Precedent

`opencode-antigravity-auth` (the only other published OpenCode Copilot auth plugin with significant adoption) stores OAuth refresh tokens as plaintext JSON with `0600` permissions and no keychain integration — shipped as stable. CopilotHydra's posture is consistent with this established norm.

### Mitigations in place

| Mitigation | Status |
|---|---|
| File created with `0600` permissions | ✅ Implemented and tested |
| `normalizeSecretsFilePermissions` hardens insecure files on every save | ✅ Implemented and tested |
| Atomic write via temp file + `rename` | ✅ Implemented |
| File-lock wraps all read-modify-write cycles | ✅ Implemented |
| Corrupt file quarantine | ✅ Implemented and tested |
| Tokens never logged, even with debug flags | ✅ Enforced in `src/log.ts` and `src/flags.ts` |

### Residual risks (accepted)

1. **Filesystem compromise** — if the operator's home directory is readable by other processes, tokens are exposed. Mitigated by `0600` permissions but not eliminated.
2. **Backup/sync exposure** — cloud backup tools may sync `copilot-secrets.json`. Operators should exclude the OpenCode config directory from cloud sync.
3. **No memory protection** — tokens held in process memory during runtime.

These risks are accepted as consistent with the security model of similar tools in this category.

---

## OpenCode integration parity summary

### What upstream OpenCode does (built-in `github-copilot`)

- Registers auth for provider ID `github-copilot` via `packages/opencode/src/plugin/copilot.ts`
- Uses GitHub device flow with OpenCode's built-in client ID
- Injects headers: `Authorization: Bearer <token>`, `Openai-Intent: conversation-edits`, `x-initiator`, `Copilot-Vision-Request`
- Routes GPT-5 family (except `gpt-5-mini`) through `sdk.responses(modelID)`, others through `sdk.chat(modelID)`
- Normalizes provider errors before they reach the TUI layer

### What CopilotHydra mirrors

- `opencode auth login` as primary entrypoint for add-account and re-auth
- Account-scoped provider IDs (`github-copilot-acct-<id>`), isolated per account
- Built-in `github-copilot` hidden while Hydra accounts are active; restored on zero accounts
- GPT-5 / Responses routing mirrors upstream responses-vs-chat split
- Text-stream normalization with single stable text part
- Object-shaped provider errors normalized into string `Error` messages

### Known parity gaps

1. **Exact built-in loader equivalence** — Hydra mirrors behavior through a local wrapper but does not reuse OpenCode's exact built-in provider path. Parity is strong for covered paths; full upstream equivalence is best-effort.
2. **Broader Responses/Codex event-surface coverage** — mixed event shapes, future schema changes, and edge-case tool-heavy flows not fully covered.
3. **Capability truth is hybrid** — user-declared plan + runtime mismatch; no authoritative entitlement verification per account.
4. **Static 8-slot architecture** — runtime depends on 8 static exported slots (`CopilotHydraSlot0`–`CopilotHydraSlot7`). Enforced safely, remains architecture limit.

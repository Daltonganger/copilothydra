# Plaintext Secret Storage — Stable-Release Decision

**Decision date:** 2026-03-30
**Decision:** Formally accept plaintext storage with existing mitigations as sufficient for stable release.

## Context

CopilotHydra stores GitHub OAuth tokens in `copilot-secrets.json` as plaintext JSON with no encryption at rest. This was the explicit v1 design choice: secure-enough for beta, with keychain migration deferred to a later phase.

The release checklist (`docs/release-checklist.md`) required a formal decision before calling the project stable: either implement keychain/credential-store integration, or formally accept plaintext with documented risk mitigations.

## Precedent

`opencode-antigravity-auth` (the only other published OpenCode Copilot auth plugin with significant adoption) stores OAuth refresh tokens as plaintext JSON with `0600` file permissions and **no** opt-in gate, no user-facing warning, and no keychain integration — and ships it as its stable `latest` channel. It does not document the security posture at all.

CopilotHydra's v1 plaintext storage is therefore consistent with the established norm for this category of tool.

## Current mitigations in place

| Mitigation | Status |
|---|---|
| File created with `0600` permissions (owner read/write only) | ✅ Implemented and tested |
| `normalizeSecretsFilePermissions` hardens existing insecure files on every save | ✅ Implemented and tested |
| Atomic write via temp file + `rename` prevents partial writes | ✅ Implemented |
| File-lock wraps all read-modify-write cycles | ✅ Implemented |
| Corrupt file quarantine — bad file renamed, empty state recovered | ✅ Implemented and tested |
| `COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM=1` required to write secrets | ✅ Implemented — explicit operator opt-in |
| Tokens never logged, even with debug flags | ✅ Enforced in `src/log.ts` and `src/flags.ts` |
| Secret storage security note in `docs/support-boundaries.md` | ✅ Documented |

## What this decision does NOT change

- Keychain/credential-store integration remains the right long-term goal. If a future contributor adds it, this decision should be revisited.
- The `COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM=1` flag **stays required**. It serves as a deliberate operator acknowledgment, not a legacy gate to remove.
- Enterprise environments with stricter secret management requirements should treat this as a known limitation. See `docs/support-boundaries.md`.

## Residual risks (accepted)

1. **File system compromise** — if the operator's home directory is readable by other users or processes, tokens are exposed. Mitigated by `0600` permissions but not eliminated.
2. **Backup/sync exposure** — cloud backup tools (Time Machine, iCloud Drive, Dropbox) may sync `copilot-secrets.json`. Operators should exclude the OpenCode config directory from cloud sync.
3. **No memory protection** — tokens are held in process memory during runtime (same as any non-HSM token usage).

These risks are accepted as consistent with the security model of similar tools in this category and appropriate for the current operator profile (individual developers running OpenCode locally).

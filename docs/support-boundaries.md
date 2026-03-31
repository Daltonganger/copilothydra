# CopilotHydra Support Boundaries

> **Stable — v0.3.0.** CopilotHydra is stable for the documented GitHub.com Copilot / OpenCode support boundary. See `docs/release-checklist.md` for the release gate history.

This document defines what CopilotHydra supports today, what remains best-effort, and what is currently out of scope.

## Supported today

- GitHub.com GitHub Copilot multi-account usage through CopilotHydra-managed account-scoped providers
- The primary `opencode auth login` add-account and re-auth path described in the current runbook/docs
- Warn-first host compatibility behavior for tested and untested OpenCode versions documented in `docs/compatibility-matrix.md`
- Account-scoped provider generation, manual model routing, mismatch detection, and explicit review flows for the currently modeled personal plan tiers:
  - `free`
  - `student`
  - `pro`
  - `pro+`
- Current GPT-5+/Responses/Codex support only within the documented support boundary in `docs/compatibility-matrix.md`

## Best-effort / compatibility-sensitive

- OpenCode host internals around `github-copilot`, because the integration depends on behavior that is compatibility-sensitive and only partially documented
- Windows support, which remains best-effort rather than a fully validated primary platform
- GPT-5+/Responses/Codex parity outside the specifically documented and tested surfaces
- Any path that depends on host behavior not yet covered by the tested compatibility matrix or regression suite
- Capability truth beyond the current hybrid model of user-declared plan exposure plus runtime mismatch detection
- Token-bound usage or quota snapshots as authoritative per-account percentage or billing truth until their semantics are validated
- Secret storage and native credential-store publishing: CopilotHydra keeps `copilot-secrets.json` for local bookkeeping, and also publishes `copilot-cli`-compatible native credential-store entries best-effort via `@napi-rs/keyring` on supported platforms.

## Usage visibility boundary

Usage visibility is intended for operator awareness only.

Supported today:

- read-only, account-scoped usage snapshots queried with the account's own OAuth token
- explicit/manual operator interpretation of returned plan, reset-date, and quota-style snapshot fields

Best-effort / not authoritative:

- turning supported token-bound snapshots into a fully trustworthy percentage for every account and plan shape
- interpreting snapshot fields as billing truth beyond the exact returned account-bound API payload

Out of scope today:

- browser-cookie billing scraping as a source of per-account truth
- automatic routing/fallback based on usage or quota state
- presenting guessed percentages as if they were authoritative GitHub quota truth

## Out of scope today

- End-to-end enterprise-managed GitHub.com behavior as a supported product path
- End-to-end GitHub Enterprise Server (GHES) behavior as a supported product path
- Treating `enterpriseUrl` plumbing as a support guarantee by itself
- Automatic entitlement truth or authoritative plan verification
- Authoritative per-account Copilot usage percentages from unsupported or cross-account billing sources
- Hidden fallback or automatic switching between Copilot accounts
- More than 8 simultaneously active accounts: the current runtime is capped at 8 exported slot exports by design. This is a deliberate architecture boundary for this release, not a temporary implementation limit.

## Enterprise / managed-environment clarification

CopilotHydra contains some enterprise-adjacent plumbing, such as the optional `enterpriseUrl` field in stored auth info, but that is **not** the same as supported enterprise-managed GitHub.com or GitHub Enterprise Server (GHES) behavior.

Until enterprise-specific flows are explicitly tested, documented, and added to the compatibility matrix, they should be treated as **out of scope** rather than implied support.

## Operator rule of thumb

- If a path is documented in the compatibility matrix and current runbooks, treat it as supported.
- If a path is described as best-effort, treat it as compatibility-sensitive and validate it before relying on it broadly.
- If a path is not documented and falls into enterprise-managed GitHub.com or GHES or broader undocumented host behavior, treat it as out of scope unless a future PR explicitly changes that boundary.

## Known limitations (canonical list)

This is the single authoritative list of known limitations. Other docs may reference these but this section is the source of truth.

- **Hybrid secret storage** — CopilotHydra now publishes `copilot-cli`-compatible native credential-store entries best-effort, but still keeps plaintext `copilot-secrets.json` for local bookkeeping and fallback.
- **8-account cap** — The runtime is architecturally capped at 8 simultaneously active accounts (8 exported plugin slots). This is a deliberate boundary for v1, not a temporary limit.
- **User-declared plans** — CopilotHydra does not verify your actual GitHub Copilot plan. You declare your plan on add-account. Mismatches are detected at runtime and flagged.
- **macOS/Linux primary, Windows best-effort** — File permission hardening (`chmod 0600`) is not supported on Windows. Atomic writes fall back to a direct write on Windows rename failure.
- **No enterprise or GHES support** — Enterprise-managed GitHub.com and GitHub Enterprise Server are explicitly out of scope for v1.
- **GPT-5+/Responses/Codex parity is best-effort** outside the documented and tested surfaces.
- **Native consumer compatibility is limited** — OpenCode Bar is a confirmed native consumer of the `copilot-cli` credential format on macOS. AIUsageTracker and opencode-quota currently read different auth sources, so they do not automatically discover Hydra-managed accounts yet.

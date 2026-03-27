# CopilotHydra Support Boundaries

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

## Out of scope today

- End-to-end enterprise-managed GitHub.com behavior as a supported product path
- End-to-end GitHub Enterprise Server (GHES) behavior as a supported product path
- Treating `enterpriseUrl` plumbing as a support guarantee by itself
- Automatic entitlement truth or authoritative plan verification
- Hidden fallback or automatic switching between Copilot accounts
- More than the currently enforced 8 simultaneously exported runtime account slots as a guaranteed supported scale target

## Enterprise / managed-environment clarification

CopilotHydra contains some enterprise-adjacent plumbing, such as the optional `enterpriseUrl` field in stored auth info, but that is **not** the same as supported enterprise-managed GitHub.com or GitHub Enterprise Server (GHES) behavior.

Until enterprise-specific flows are explicitly tested, documented, and added to the compatibility matrix, they should be treated as **out of scope** rather than implied support.

## Operator rule of thumb

- If a path is documented in the compatibility matrix and current runbooks, treat it as supported.
- If a path is described as best-effort, treat it as compatibility-sensitive and validate it before relying on it broadly.
- If a path is not documented and falls into Enterprise/GHES or broader undocumented host behavior, treat it as out of scope unless a future PR explicitly changes that boundary.

# CopilotHydra Release Checklist

This checklist is the current gate for deciding when CopilotHydra can move from beta/hardening work toward a stable release.

## Current release posture

- **Current posture:** beta / hardening phase
- **Do not call stable yet** while plaintext secret storage remains beta-only and compatibility validation remains narrow

## Stable-release gate

Mark each section materially complete before calling CopilotHydra stable.

### 1. Host compatibility

- [ ] Tested OpenCode versions are listed in `docs/compatibility-matrix.md`
- [ ] Unknown-version behavior remains warn-first and does not silently break login/routing
- [ ] Built-in `github-copilot` coexistence and recovery are verified on tested host versions

### 2. Auth recovery

- [ ] `opencode auth login` add-account flow works on tested host versions
- [ ] Re-auth flow works on tested host versions
- [ ] Zero-account recovery restores host-native `github-copilot` correctly
- [ ] Restart/reload requirements are documented and verified

### 3. Regression coverage

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Black-box host regression coverage exists for plugin discovery, auth login, and post-restart routed requests

### 4. Storage safety

- [ ] Accounts/config writes remain atomic and recoverable
- [ ] Corrupt storage quarantine and repair flows are verified
- [ ] Plaintext secret-file permission hardening is working where supported
- [ ] A stable-release decision exists for replacing or formally accepting plaintext secret storage

### 5. Capability truth

- [ ] Declared-plan exposure and runtime mismatch handling are consistent
- [ ] Mismatch review/apply flow is understandable for operators
- [ ] Downgrade suggestions do not overclaim certainty or mislead on unknown models

### 6. GPT-5+/Responses/Codex boundary

- [ ] Current support boundary is documented in `docs/compatibility-matrix.md`
- [ ] Supported GPT-5+/Responses/Codex paths are covered by regression tests
- [ ] Any unsupported or unverified parity surface is explicitly documented as best-effort or out of scope

### 7. Operator readiness

- [ ] README and docs clearly state current beta/stable status
- [ ] Known limitations are documented consistently across docs
- [ ] Operator runbooks for login, mismatch review, and repair are available or explicitly deferred

Current status:

- Auth/restart recovery runbook: available in `docs/operator-auth-recovery-runbook.md`
- Mismatch-review and storage-repair runbooks: still to be expanded or explicitly deferred

## Current blockers for stable

At the time this checklist was added, the biggest blockers were:

1. plaintext secrets are still accepted only for beta/hardening work
2. compatibility validation is still narrow
3. GPT-5+/Responses/Codex parity is best-effort, not guaranteed full built-in equivalence
4. operator runbook coverage is still incomplete

## Release decision rule

- If one or more sections above are still materially incomplete, treat CopilotHydra as **beta / hardening-phase software**.
- Only call it **stable** when those blockers are removed or explicitly accepted in project policy.

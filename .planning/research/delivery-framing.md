# Delivery Framing — New Project Workflow

**Project:** CopilotHydra brownfield follow-on
**Date:** 2026-03-25
**Focus:** roadmap framing only (phase boundaries, verification expectations, scope/defer)
**Fixed decisions treated as in-scope constraints:**
- CLI-first OpenCode auth login entrypoint
- multiple Copilot accounts active simultaneously
- per-account model entries in one list
- manual routing only
- no non-Copilot providers

## Framing Summary

This initiative should be framed as **auth-login hardening plus release hardening**, not as a fresh product build. Phases 1-5 and the core multi-account architecture already exist. The roadmap should therefore slice remaining work around **host-behavior proof, release-safety verification, and explicit scoping of known limitations**.

The biggest delivery risk is not feature absence; it is **integration fragility with OpenCode host behavior**. Candidate phases should isolate: (1) proving the `opencode auth login` entrypoint is reliable with built-in `github-copilot`, (2) tightening compatibility and regression coverage around concurrent multi-account use, and (3) shipping docs/release caveats that match the actual limits.

## Candidate Phase Slices

### Phase A — Auth-login host validation
**Goal:** make the CLI-first auth-login path the clearly supported entrypoint.

**In scope:**
- validate `CopilotHydraSetup` behavior under `opencode auth login`
- verify coexistence/replacement behavior around built-in `github-copilot`
- prove first-account add and existing-account re-auth both work via auth login
- verify config sync + returned provider id + restart messaging are consistent
- clean up abandoned-login drift expectations and operator recovery guidance

**Out of scope for this phase:**
- secure storage migration
- automatic capability truth
- GPT-5+/Responses full support

### Phase B — Multi-account runtime hardening
**Goal:** prove the already-built architecture is safe enough for roadmap-level “usable beta” confidence.

**In scope:**
- regression coverage for simultaneous active Copilot accounts in one session
- verification of manual routing invariants: provider → account → token isolation
- removal/drain behavior validation across real process boundaries
- compatibility/version detection hardening beyond current warning-first stub
- explicit guardrails for the 8-account slot cap and restart-required lifecycle

**Out of scope for this phase:**
- changing from manual routing to automatic routing
- removing static slot architecture
- expanding beyond Copilot accounts/providers

### Phase C — Release framing and operator readiness
**Goal:** make scope boundaries explicit before roadmap marks the initiative “done.”

**In scope:**
- align README/docs/status with actual supported path: auth login first, TUI/CLI as management fallback
- publish compatibility expectations and known limitations
- document verification commands, failure recovery, and operator-visible caveats
- ensure roadmap/release notes call out what is intentionally deferred

**Out of scope for this phase:**
- major new UX flows
- new provider classes
- enterprise-grade secret handling

## Verification / Testing Expectations

This work should be accepted only if verification goes beyond unit logic and proves the host-sensitive paths.

### Minimum verification per slice
- `npm run build`
- `npm run typecheck`
- `npm test`
- targeted regression tests for touched auth-login / routing / storage behavior
- README + relevant docs updated in the same slice

### Additional expectations for this initiative
- **Host-behavior validation:** evidence that auth-login works against real OpenCode behavior, not only local mocks
- **Concurrency validation:** proof that simultaneous same-session multi-account requests stay isolated
- **Cross-process validation:** proof or explicitly documented limitation for pending-removal/finalize behavior across separate processes
- **Compatibility validation:** unknown-version behavior must be documented; version detection cannot stay effectively empty if this initiative claims hardening

### What does *not* count as sufficient
- only green unit tests on mocked flows
- docs that imply support for GPT-5+/Responses routing without proof
- claiming release readiness while compatibility detection remains a stub

## Acceptance Signals

The roadmap can treat this initiative as complete when these signals are true:

### Product/behavior signals
- OpenCode auth login is the primary demonstrated add-account and re-auth path
- multiple Copilot accounts can remain active simultaneously with no cross-account fallback
- per-account model entries appear in one list and map to the correct account/provider path
- manual routing behavior is explicit and stable; no hidden auto-routing expectations remain
- failures around mismatch, pending removal, abandoned login, and unknown compatibility are actionable

### Verification signals
- new/updated tests directly cover auth-login, concurrent account isolation, and hardening edge cases
- known fragile behaviors have either a regression test or a clearly documented limitation
- build/typecheck/tests are part of each slice’s exit criteria, not end-of-project cleanup

### Delivery signals
- docs describe the same primary path the product now expects users to take
- roadmap language avoids implying unsupported capability truth, secure storage, or non-Copilot extensibility
- remaining open gaps are listed as defer items, not hidden as “later polish”

## Docs Implications

Docs should shift from “feature build-out” framing to **supported-operating-model** framing.

Required doc implications:
- README should keep auth login as the preferred entrypoint and clearly state restart/reload expectations
- implementation docs should frame remaining work as host validation + hardening, not another feature phase
- compatibility documentation should exist if version detection is tightened; current references to a compatibility matrix cannot stay aspirational
- known limitations should stay explicit: warning-first compatibility, plaintext secrets, GPT-5+/Responses gap, 8-account cap, JSONC formatting loss, cross-process drain caveat
- acceptance criteria in roadmap/PR planning should include docs updates as mandatory, matching the repo working agreement

## Explicit In-Scope vs Deferred

### In scope for roadmap planning
- auth-login host-behavior hardening
- concurrent multi-account verification in one session
- manual routing guardrails and regression coverage
- compatibility/version detection improvement
- release-quality docs and operator recovery guidance
- explicit acceptance criteria for restart-required config lifecycle

### Deferred / explicitly not part of this initiative
- non-Copilot providers
- automatic routing or smart provider/account selection
- secure secret storage / keychain migration
- authoritative per-account entitlement discovery
- GPT-5+/Responses full parity unless specifically proven in a dedicated slice
- removing the 8-slot static export limit
- broad architecture rewrite or sidecar/broker fallback
- comment-preserving JSONC config editing
- enterprise/provider-expansion work

## Roadmap Planning Recommendation

Plan this as **2–3 stacked hardening slices**, not a long feature epic:
1. **Auth-login host validation**
2. **Runtime/compatibility hardening**
3. **Release docs + acceptance pass**

That structure matches the repo’s current state: core mechanics already exist, but roadmap confidence should come from proving the fragile edges and documenting the real contract.

## Sources
- `README.md`
- `docs/IMPLEMENTATION_SEQUENCE.md`
- `docs/Loginmethod.md`
- `docs/PLAN.md`
- `docs/feasibility-notes.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONCERNS.md`
- `.planning/codebase/TESTING.md`

# Roadmap: CopilotHydra GitHub Copilot Host Hardening

## Overview

This roadmap turns the existing multi-account Copilot core into a dependable OpenCode integration: first by proving and hardening the `opencode auth login` takeover path, then by making concurrent runtime behavior and model selection safe and explicit, and finally by aligning docs and release framing with the real supported operating model.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Auth Takeover Validation** - Make the native `opencode auth login` Copilot path dependable for add-account and re-auth flows.
- [ ] **Phase 2: Runtime Isolation & Compatibility Guardrails** - Make shared model selection, manual routing, and multi-account runtime behavior trustworthy under host drift.
- [ ] **Phase 3: Operator Readiness & Release Framing** - Align docs and release guidance with the supported workflow, caveats, and recovery paths.

## Phase Details

### Phase 1: Auth Takeover Validation
**Goal**: Users can add or re-authenticate GitHub Copilot accounts through `opencode auth login` without losing trust in the CopilotHydra-managed auth path.
**Depends on**: Nothing (first phase)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
  1. User can start GitHub Copilot login from `opencode auth login` and reach the CopilotHydra-managed `github-copilot` flow.
  2. User can add another Copilot account while previously active Copilot accounts remain available after the expected restart/reload behavior.
  3. User can re-authenticate an existing Copilot account from the same auth-login path instead of using a separate recovery workflow.
  4. User sees clear guidance when login is abandoned, incomplete, or waiting on restart/reload before the account becomes usable.
**Plans**: TBD

### Phase 2: Runtime Isolation & Compatibility Guardrails
**Goal**: Users can choose an exact account/model path from one shared list and trust that runtime behavior stays isolated, manual, and honestly bounded.
**Depends on**: Phase 1
**Requirements**: RUNT-01, RUNT-02, RUNT-03, MODL-01, MODL-02, MODL-03, MODL-04, COMP-01, COMP-02, COMP-03, COMP-04
**Success Criteria** (what must be TRUE):
  1. User can keep multiple Copilot accounts active at the same time and send requests through one account without silent fallback to another.
  2. User can choose from one shared model list where each entry is labeled by account clearly enough to distinguish duplicate model names.
  3. User can manually select the exact account/model combination to use, and the product does not imply automatic routing or unsupported cross-account recovery.
  4. User can tell when model capability claims are user-declared, uncertain, contradicted by runtime evidence, or limited because host compatibility is not proven.
  5. User receives warning-first but actionable guidance for risky host versions, broken runtime assumptions, restart-required lifecycle behavior, slot limits, and unsupported high-risk model paths.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Operator Readiness & Release Framing
**Goal**: Users can understand the supported CopilotHydra workflow, limitations, and recovery guidance before relying on the hardened release.
**Depends on**: Phase 2
**Requirements**: OPER-01, OPER-02
**Success Criteria** (what must be TRUE):
  1. User-facing docs present `opencode auth login` as the primary path for adding and re-authenticating Copilot accounts.
  2. User-facing docs explain known limitations around compatibility uncertainty, restart requirements, slot limits, and unresolved routing gaps.
  3. User can find recovery guidance for the main failure modes without needing to infer behavior from source code or old roadmap notes.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 1.1 → 1.2 → 2 → 2.1 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Auth Takeover Validation | 0/TBD | Not started | - |
| 2. Runtime Isolation & Compatibility Guardrails | 0/TBD | Not started | - |
| 3. Operator Readiness & Release Framing | 0/TBD | Not started | - |

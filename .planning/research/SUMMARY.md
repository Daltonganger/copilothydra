# Project Research Summary

**Project:** CopilotHydra
**Domain:** OpenCode host-integration hardening for multi-account GitHub Copilot
**Researched:** 2026-03-25
**Confidence:** MEDIUM

## Executive Summary

CopilotHydra is no longer a greenfield build. The core multi-account Copilot runtime already exists; the real project is to turn that proven core into a dependable, warning-first OpenCode integration. The product should stay explicitly **Copilot-only**, take over `github-copilot` login/auth through **`opencode auth login`**, keep **multiple Copilot accounts active simultaneously**, expose **per-account model entries in one list**, and preserve **manual routing only** with **hybrid capability truth**.

The recommended approach is a short hardening roadmap, not a feature-expansion roadmap: first prove the `github-copilot` login takeover/coexistence path against real host behavior, then harden runtime/compatibility edges for concurrent multi-account use, then finish with release framing and operator guidance. The dominant risk is host fragility inside OpenCode, with GPT-5+/Responses routing as the main scope risk and capability/entitlement uncertainty as a permanent v1 constraint rather than a bug to “finish later.”

## Key Findings

### Product Scope

This initiative should be framed as **clean login + runtime replacement for GitHub Copilot inside OpenCode**, not as a generic auth framework.

**Must preserve as authoritative decisions:**
- Copilot-only scope
- `opencode auth login` as the primary entrypoint
- menu-driven `github-copilot` auth takeover by CopilotHydra
- multiple active Copilot accounts at once
- per-account model entries in one shared list
- manual routing only
- hybrid capability truth
- warning-first compatibility policy
- restart/reload accepted after account/config changes

**Explicitly out of scope / deferred:**
- non-Copilot providers
- automatic routing or policy engines
- authoritative entitlement discovery
- secure-storage redesign in this initiative
- broad architecture rewrites, sidecars, or removal of restart sensitivity

### Technical Risks

The architecture is feasible enough to continue, but it is **compatibility-sensitive and host-dependent**.

**Primary risks for planning:**
1. **`github-copilot` takeover/coexistence is not fully validated** — login entry exists, but behavior across OpenCode versions still needs proof.
2. **GPT-5+/Responses routing remains unresolved** for custom provider IDs — beta may need a bounded model surface unless dedicated hardening is funded.
3. **Capability truth is inherently hybrid** — user-declared state plus mismatch evidence is the v1 product contract.
4. **Compatibility/version detection is still weak** — warning-first stays correct, but the detection/matrix cannot remain a stub if this ships as hardened.
5. **Operational constraints are real** — 8-account static slot cap, restart-required lifecycle, file-backed config sync, cross-process drain caveats.

### Delivery Framing

The work should be delivered as **2-3 stacked hardening slices**, not a long feature epic.

**Recommended slices:**
1. Auth-login host validation
2. Runtime and compatibility hardening
3. Release docs and acceptance pass

**Verification expectations must include more than unit tests:**
- real host-behavior validation against OpenCode
- concurrent same-session isolation proof
- cross-process removal/finalize validation or explicit limitation docs
- build/typecheck/tests plus docs updates in every slice

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Auth-Login Host Validation
**Rationale:** This is the immediate trust gate. The product promise depends on CopilotHydra safely owning the `github-copilot` login/auth path inside `opencode auth login`.
**Delivers:** Validated add-account and re-auth flows, stable provider-id/config sync behavior, clear restart messaging, bounded abandoned-login recovery.
**Addresses:** Copilot-only auth takeover, CLI-first entrypoint, multiple active accounts from the native auth surface.
**Avoids:** Shipping a “native-feeling” flow before coexistence/replacement behavior is actually proven.

### Phase 2: Runtime & Compatibility Hardening
**Rationale:** Once login entry is trusted, the next risk is incorrect runtime behavior under concurrent multi-account use and host drift.
**Delivers:** Regression coverage for provider→account isolation, hardened warning-first compatibility detection, explicit guardrails for slot cap/restart lifecycle, clear beta stance on GPT-5+/Responses exposure.
**Addresses:** multiple simultaneous accounts, manual routing only, per-account model entries, hybrid capability truth.
**Avoids:** cross-account fallback, unsupported model exposure, false confidence from weak compatibility checks.

### Phase 3: Release Framing & Operator Readiness
**Rationale:** This project should only be considered “done” when docs, caveats, and recovery guidance match the real operating model.
**Delivers:** README/docs/status alignment, known limitations, verification commands, recovery instructions, explicit defer list for non-goals.
**Addresses:** warning-first compatibility, honest capability messaging, CLI-first supported workflow.
**Avoids:** roadmap drift, support burden from undocumented caveats, implied promises around secure storage or non-Copilot extensibility.

### Phase Ordering Rationale

- Validate host takeover first because the auth surface is the primary user-facing contract and the biggest integration risk.
- Harden runtime second because concurrent-account correctness matters only after the supported entrypoint is trustworthy.
- Finish with release framing so docs and acceptance criteria reflect what was actually proven, not aspirational scope.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1:** OpenCode host behavior around `github-copilot` takeover/coexistence across versions.
- **Phase 2:** GPT-5+/Responses routing decision and any host-internal behavior relied on by custom providers.
- **Phase 2:** Cross-process drain/finalize semantics if beta claims strong removal safety.

Phases with standard patterns (skip research-phase):
- **Phase 3:** Docs alignment, operator guidance, and acceptance framing are straightforward once technical boundaries are fixed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Product scope | HIGH | User-authoritative decisions are explicit and consistent across the research artifacts. |
| Technical feasibility | MEDIUM | Core architecture is proven enough to continue, but host behavior remains undocumented and compatibility-sensitive. |
| Delivery framing | HIGH | Phase structure is clear and strongly supported by the current repo state. |
| Release confidence | LOW-MEDIUM | Depends on validating host takeover behavior, improving compatibility detection, and bounding GPT-5+/Responses risk. |

**Overall confidence:** MEDIUM

### Gaps to Address

- **Exact OpenCode takeover behavior:** validate how CopilotHydra’s `github-copilot` setup path interacts with built-in behavior across supported versions.
- **GPT-5+/Responses support posture:** either prove custom routing or explicitly limit beta model exposure.
- **Compatibility matrix:** replace the current stub with real detection, documented expectations, and tested warnings.
- **Cross-process lifecycle safety:** prove removal/finalize behavior or document it as a known beta limitation.

## Sources

### Primary
- `.planning/research/product-scope.md` — authoritative product boundaries and preserved user decisions
- `.planning/research/technical-risks.md` — feasibility baseline, host-coupling risks, and hard technical constraints
- `.planning/research/delivery-framing.md` — roadmap slice recommendation, verification bar, and acceptance framing

---
*Research completed: 2026-03-25*
*Ready for roadmap: yes*

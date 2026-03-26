# Product Scope: Host-Behavior Hardening for CopilotHydra

**Project:** CopilotHydra new-project workflow initiative
**Date:** 2026-03-25
**Scope lens:** Product/problem framing only

## Problem Statement

CopilotHydra has already proven the core multi-account GitHub Copilot path, completed Phase 5 TUI work, and started OpenCode auth-login integration. The remaining product problem is not "can multi-account Copilot work?" but "can we make it safe, understandable, and dependable enough to ship as a warning-first OpenCode integration?"

The highest-risk gap is host-behavior hardening around replacing/coexisting with OpenCode's built-in `github-copilot` login flow. Today, CopilotHydra can enter through `opencode auth login`, but the repo explicitly calls out unresolved host-version validation, uncertain `github-copilot` coexistence/replacement behavior, abandoned-login drift risk, and broader compatibility-sensitive hardening. Without addressing those gaps, users may hit ambiguous login UX, broken auth persistence, misleading provider behavior, or regressions across OpenCode versions.

This initiative should therefore frame the work as a clean Copilot-only replacement of GitHub Copilot login/auth inside OpenCode, plus the minimum post-Phase-5 hardening needed to make that replacement trustworthy enough for beta usage.

## Target User / Jobs

### Primary user
- Power OpenCode users who actively use **multiple GitHub Copilot accounts** in one environment.

### Core jobs to be done
1. Log in to GitHub Copilot accounts from the familiar `opencode auth login` surface.
2. Keep multiple Copilot accounts active simultaneously without account confusion.
3. See model choices per account, even when model names duplicate, with account labels making selection understandable.
4. Manually route usage to the intended account/model combination.
5. Understand what is verified vs user-declared capability truth, especially when host behavior or entitlement certainty is imperfect.
6. Recover safely when auth, compatibility, or capability assumptions break.

## Must-Have Scope

1. **Clean login/runtime replacement for Copilot inside OpenCode**
   - CopilotHydra should take over `github-copilot` login/auth UX with its own menu-driven path under `opencode auth login`.
   - Scope is explicitly **Copilot-only**; this is not a generic auth framework.

2. **Multiple active Copilot accounts at once**
   - Product behavior must preserve the existing core promise: simultaneous active accounts, not account switching.
   - Login and runtime flows must both support this model.

3. **Per-account model presentation**
   - Model lists are shown per account.
   - Duplicate model names are allowed, but must be labeled with account identity so users can distinguish them.

4. **Manual routing only**
   - No auto-routing or policy engine.
   - Users intentionally choose account/model combinations.

5. **Hybrid capability truth**
   - Capability exposure remains a hybrid of user-declared state plus runtime mismatch evidence.
   - UX must make uncertainty explicit instead of pretending entitlement truth is authoritative.

6. **Warning-first compatibility policy**
   - Unknown or changed OpenCode host behavior should warn first, not hard-block by default.
   - But runtime behavior must still fail closed when routing/auth assumptions are actually broken.

7. **CLI-first entrypoint via `opencode auth login`**
   - Product entry should be the OpenCode auth command, not the standalone CopilotHydra menu.
   - Existing CLI/TUI stays as fallback/admin tooling, not the primary user story.

8. **Post-Phase-5 hardening required for beta trust**
   - Cover host-behavior validation for `github-copilot` replacement/coexistence.
   - Reduce or clearly surface abandoned-login/config drift.
   - Strengthen compatibility/version detection and messaging.
   - Preserve clear restart/reload expectations after account/config changes.

## Nice-to-Have Scope

1. Safer cleanup when add-account auth is abandoned mid-flow.
2. Better compatibility signaling than today's generic warning stub.
3. Clearer in-product explanation of replacement/coexistence behavior across OpenCode versions.
4. UX polish that makes account labels, mismatch state, and restart requirements more obvious.
5. Extra beta-hardening docs/caveats that reduce support burden without expanding feature scope.

## Explicit Non-Goals

1. **Not** a non-Copilot multi-provider auth initiative.
2. **Not** automatic routing or smart account selection.
3. **Not** authoritative entitlement discovery; hybrid capability truth remains the policy.
4. **Not** solving every GPT-5+/Responses routing limitation as part of product framing unless needed to preserve clear Copilot-only expectations.
5. **Not** keychain/secure-storage redesign in this initiative.
6. **Not** removing restart/reload sensitivity as a requirement.
7. **Not** expanding beyond warning-first compatibility into strict host-version pinning.
8. **Not** broad platform expansion or enterprise/GHE feature work.

## Success Definition

This initiative succeeds when:

- A user can go to `opencode auth login`, choose the CopilotHydra-managed Copilot path, and understand that CopilotHydra owns Copilot account login/auth behavior.
- Multiple Copilot accounts can remain active simultaneously after login and at runtime.
- Account-specific model choices are understandable even when model names duplicate.
- Users manually choose the intended account/model path without hidden routing behavior.
- Compatibility uncertainty is surfaced early with warnings, while broken runtime assumptions still fail closed.
- The most likely post-Phase-5 trust breakers — host-behavior ambiguity, login abandonment drift, and weak compatibility messaging — are either hardened or clearly bounded for beta.

## Key Assumptions

1. OpenCode remains a **compatibility-sensitive** host with undocumented Copilot internals, so replacement must be defensive.
2. A clean replacement means owning the Copilot login surface under `github-copilot`, while runtime still maps to account-specific providers.
3. Simultaneous multi-account usage is still the core differentiator and cannot regress.
4. Users accept restart/reload after account/config changes.
5. Users accept manual routing and labeled duplicate model names if the UX is explicit.
6. Capability truth will remain hybrid for this phase; product messaging must reflect that honestly.
7. Warning-first compatibility is the governing policy unless runtime invariants are provably broken.
8. The standalone CopilotHydra CLI/TUI remains a fallback/repair path, but `opencode auth login` is the intended front door.

## Source Notes

Derived from: `README.md`, `docs/PLAN.md`, `docs/Loginmethod.md`, `docs/feasibility-notes.md`, `docs/IMPLEMENTATION_SEQUENCE.md`, and `.planning/codebase/{ARCHITECTURE,CONCERNS,STACK,STRUCTURE,INTEGRATIONS}.md`, plus the authoritative user decisions supplied in this request.
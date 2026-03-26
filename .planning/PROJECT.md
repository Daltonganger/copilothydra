# CopilotHydra: GitHub Copilot Host Hardening

## What This Is

CopilotHydra is a brownfield OpenCode plugin project that extends GitHub Copilot usage from a single built-in account model to a multi-account model. This initiative is not a greenfield feature build; it is the hardening phase that makes `github-copilot` login/auth takeover via `opencode auth login` dependable enough for real OpenCode use while preserving simultaneous Copilot accounts, per-account model selection, and explicit manual routing.

## Core Value

A user can use multiple GitHub Copilot accounts side by side inside OpenCode, select models per account explicitly, and trust that auth/login and runtime routing stay clear and correct.

## Requirements

### Validated

- ✓ Multiple GitHub Copilot accounts can be configured and kept active in one OpenCode environment — existing
- ✓ Runtime providers can map one provider per Copilot account using stable `github-copilot-acct-*` IDs — existing
- ✓ Manual routing/account isolation exists as the core runtime model, with no implicit cross-account fallback — existing
- ✓ Hybrid capability policy exists: user-declared plan/capabilities plus runtime mismatch handling — existing
- ✓ CLI/TUI account management exists as an administrative/fallback path — existing
- ✓ `opencode auth login` can already expose a CopilotHydra-managed `github-copilot` setup path — existing

### Active

- [ ] Validate and harden `github-copilot` auth/login takeover behavior inside OpenCode across supported host behavior
- [ ] Keep multiple Copilot accounts simultaneously usable from the primary `opencode auth login` flow through runtime use
- [ ] Present model choices as per-account entries in one shared list, including duplicate model names with clear account labels
- [ ] Preserve manual routing only so users choose the exact account/model path explicitly
- [ ] Improve compatibility/version detection and warning quality without abandoning warning-first policy
- [ ] Bound or clearly surface known runtime risks such as abandoned-login drift, restart expectations, slot-cap guardrails, and unresolved GPT-5+/Responses behavior
- [ ] Align docs and release framing with the actual supported operating model and known limitations

### Out of Scope

- Non-Copilot providers (Gemini, Sonnet, etc.) — this initiative is explicitly Copilot-only
- Automatic routing, fallback routing, or policy-based account selection — user wants manual explicit model+account choice only
- Authoritative entitlement/plan discovery — no reliable runtime API exists, so hybrid capability truth remains the product contract
- Secure-storage/keychain redesign — important later, but not part of this hardening initiative
- Sidecar/broker or broad architecture rewrites — current path is host-integrated hardening, not a replacement architecture
- Removing restart/reload sensitivity — accepted lifecycle constraint for this phase
- Enterprise GitHub / GHE support or broad platform expansion — outside current beta hardening scope
- Full GPT-5+/Responses parity guarantees — only in scope if needed to safely bound the Copilot beta surface

## Context

The repository already has a brownfield codebase map under `.planning/codebase/` and current docs describe Phases 3-5 as largely complete: multi-account runtime, capability policy, and TUI/CLI account management are already in place. Current repo research reframes the remaining work as host-behavior hardening around `github-copilot` coexistence/replacement plus broader post-Phase-5 hardening.

The main product contract is now clear from user questioning: CopilotHydra should take over the `github-copilot` login/auth experience inside OpenCode with its own menu, while still remaining about GitHub Copilot rather than replacing it conceptually. The supported flow is CLI-first through `opencode auth login`; multiple Copilot accounts stay active simultaneously; model choices appear as separate per-account entries in one list; routing is always manual; capability truth remains hybrid; and compatibility policy stays warning-first.

Research also identified the major planning risks: OpenCode host behavior around `github-copilot` takeover/coexistence is still not fully proven across versions, custom `github-copilot-acct-*` providers do not automatically inherit exact built-in GPT-5+/Responses routing behavior, compatibility/version detection is still weak, and some lifecycle edges such as abandoned-login cleanup and cross-process finalization need either hardening or honest release boundaries.

## Constraints

- **Host compatibility**: OpenCode internals around `github-copilot` are compatibility-sensitive and partially undocumented — hardening must be defensive
- **Entrypoint**: Primary user flow must start from `opencode auth login` — standalone TUI/CLI remains fallback/admin tooling
- **Routing model**: Routing must stay manual and explicit per account/model — no hidden fallback or auto-selection
- **Capability truth**: Entitlement cannot be authoritatively proven at runtime — product must use hybrid user-declared + mismatch-aware behavior
- **Lifecycle**: Restart/reload after account/config changes is acceptable — architecture does not need hot dynamic reload
- **Provider scope**: Work is Copilot-only — no non-Copilot provider expansion in this initiative
- **Platform scope**: macOS/Linux first, Windows best effort — current docs already bound platform expectations this way
- **Architecture**: Sidecar/broker fallback and broad rewrites are out of scope — hardening must build on the existing plugin/storage/routing design

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Scope is Copilot-only | User explicitly rejected non-Copilot providers for this phase | — Pending |
| `github-copilot` login/auth is taken over via our menu | Product goal is to own the OpenCode Copilot login/auth surface without changing the underlying Copilot concept | — Pending |
| Multiple Copilot accounts must remain active simultaneously | This is the core differentiator and cannot regress to account switching | — Pending |
| Models are shown as per-account entries in one shared list | User wants duplicate model names selectable separately per account | — Pending |
| Routing stays manual only | User does not want automatic preference/fallback logic | — Pending |
| Capability truth is hybrid | Reliable automatic entitlement proof is unavailable; UI must stay honest about uncertainty | — Pending |
| Takeover level is login + runtime replacement | Login alone is insufficient; runtime behavior must also be replaced where needed for stable multi-account use | — Pending |
| Compatibility policy is warning-first | Unknown/risky host behavior should warn first rather than block by default | — Pending |
| Flow is CLI-first via `opencode auth login` | User wants the native auth command as the primary entrypoint | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-25 after initialization*
# OpenCode Integration Parity

This document is the current technical reference for how OpenCode's built-in
`github-copilot` path works, what CopilotHydra already mirrors, and what still
remains for a stronger `0.2` / `0.3` release.

Use this file when comparing CopilotHydra against upstream OpenCode behavior.

---

## What upstream OpenCode does for built-in `github-copilot`

The public `anomalyco/opencode` codebase currently shows these important
behaviors for the built-in Copilot path:

### 1. Built-in auth plugin

OpenCode's built-in Copilot auth flow lives in:

- `packages/opencode/src/plugin/copilot.ts`

Key built-in behavior:

- registers auth for provider ID `github-copilot`
- uses GitHub device flow with OpenCode's built-in client id
- writes provider models to use `@ai-sdk/github-copilot`
- injects headers such as:
  - `Authorization: Bearer <token>`
  - `Openai-Intent: conversation-edits`
  - `x-initiator`
  - `Copilot-Vision-Request` where needed

### 2. Built-in model routing

OpenCode's built-in provider routing lives in:

- `packages/opencode/src/provider/provider.ts`

Relevant upstream behavior:

- exact provider ID `github-copilot` gets special handling through a custom loader
- GPT-5-family models except `gpt-5-mini` are routed through `responses`
- other Copilot models are routed through `chat`
- if the SDK only exposes `languageModel()`, OpenCode falls back to that

In short, upstream routing is effectively:

- `sdk.responses(modelID)` for GPT-5+ except `gpt-5-mini`
- `sdk.chat(modelID)` for the rest

### 3. Built-in error normalization

OpenCode's provider-side error handling lives in:

- `packages/opencode/src/provider/error.ts`

Important upstream behavior:

- API/provider errors are normalized before they reach the TUI layer
- OpenCode extracts readable text from error bodies and nested fields
- OpenCode avoids leaking raw object-shaped provider error payloads into schema-
  validated UI layers

This is important because OpenCode's TUI expects string-based error fields.

---

## What CopilotHydra already mirrors

CopilotHydra currently mirrors the following upstream behaviors:

### Auth/login path

- `opencode auth login` remains the primary entrypoint
- add-account and re-auth are exposed through `CopilotHydraSetup`
- Hydra uses GitHub OAuth tokens directly as routed bearer tokens

### Account-scoped provider routing

- provider IDs are isolated per account (`github-copilot-acct-<id>`)
- routed requests are fail-closed and account-specific
- built-in `github-copilot` is hidden while Hydra-managed accounts are active
- built-in `github-copilot` recovery now exists when Hydra has zero accounts

### GPT-5 / Responses parity layer

- Hydra has a local provider wrapper in `src/sdk/hydra-copilot-provider.ts`
- GPT-5 family routing mirrors upstream's current responses-vs-chat split
- text-stream normalization now keeps a single stable text part
- tool-only streams pass through without synthetic text boundaries
- object-shaped provider errors are normalized into string `Error` messages

### Hardening already completed

Already landed on main:

- compatibility/version detection and matrix
- black-box host regression coverage
- built-in `github-copilot` coexistence/recovery hardening
- capability mismatch improvements
- release checklist and operator auth runbook
- model catalog consistency/drift reporting
- plaintext secret-file permission hardening
- 8-account early add-account guard
- per-account usage snapshot command

---

## Biggest remaining parity gaps

These are the most important differences between upstream OpenCode and
CopilotHydra today.

### 1. Exact built-in `github-copilot` loader equivalence

Hydra mirrors the built-in behavior through a local wrapper, but it still does
not literally reuse OpenCode's exact built-in provider path.

Implication:

- parity is strong for the currently covered paths
- full upstream equivalence is still best-effort, not guaranteed

### 2. Broader Responses/Codex event-surface coverage

Hydra now covers the main text-generation path, but broader event surfaces still
need more parity proof, especially for:

- mixed event shapes
- future Copilot response schema changes
- edge-case non-text or tool-heavy flows

### 3. Capability truth remains hybrid, not authoritative

Hydra still relies on:

- user-declared plan exposure
- runtime mismatch detection

There is still no authoritative entitlement verification path for individual
accounts.

### 4. Static 8-slot runtime architecture

Hydra still depends on 8 static runtime exports:

- `CopilotHydraSlot0` ... `CopilotHydraSlot7`

This is currently enforced safely, but it remains an architecture limit rather
than a solved scalability story.

### 5. Security boundary for secrets

Plaintext secret storage is still accepted only for beta/hardening work. Current
permission hardening improves safety, but this is not yet the final security
story for a later stable release.

---

## What we have done so far

At a high level, CopilotHydra has already moved from feasibility work into real
host hardening.

Completed so far:

- proved multi-account Copilot routing is feasible in OpenCode
- implemented account-scoped provider generation and routing isolation
- integrated add-account and re-auth into `opencode auth login`
- hardened storage, repair, audit, mismatch review, and release gating
- added black-box host regression tests
- brought GPT-5 / Responses parity much closer to upstream behavior
- added read-only per-account usage snapshots
- prepared and published `0.1.0-beta.2`

---

## Suggested focus for `0.2`

The strongest `0.2` targets are:

1. broader Responses/Codex parity coverage on top of the current parity layer
2. docs cleanup and consolidation so historical plan/spike notes are clearly
   separated from current source-of-truth docs
3. clearer operator docs for mismatch review, storage repair, and removal flows
4. improved provider naming in OpenCode lists so long labels do not overwhelm the UI
5. stronger compatibility matrix expansion beyond the currently tested host versions

---

## Suggested focus for `0.3`

The strongest `0.3` targets are:

1. a real answer to the 8-slot ceiling (or a deliberate long-term mitigation)
2. stronger security posture for secrets beyond plaintext beta storage
3. more complete host-equivalence testing across more OpenCode versions
4. clearer policy for enterprise-managed GitHub.com / GHES if support is ever expanded

---

## Current docs roles

To reduce overlap, use the docs set like this:

- `docs/OPENCODE_INTEGRATION_PARITY.md` → upstream comparison and parity gaps
- `docs/compatibility-matrix.md` → tested versions and support boundary matrix
- `docs/release-checklist.md` → release gate
- `docs/support-boundaries.md` → supported vs best-effort vs out-of-scope policy
- `docs/operator-auth-recovery-runbook.md` → operator steps for auth/recovery
- `docs/IMPLEMENTATION_SEQUENCE.md` → implementation history/status tracking
- `docs/PLAN.md` / `docs/feasibility-notes.md` → archived planning and spike context

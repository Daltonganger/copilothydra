# Technical Risk Framing: GitHub Copilot Auth Takeover + Multi-Account Runtime Replacement

**Project:** CopilotHydra
**Date:** 2026-03-25
**Scope:** Brownfield feasibility/risk artifact for planning
**Overall assessment:** **Feasible, but compatibility-sensitive and still host-dependent**

## 1) Current architecture baseline

- **Core multi-account runtime is already proven enough to continue**: feasibility spikes A/B/C/D/E are marked complete and the repo is at **GO** for continued implementation.
- **Current shape**:
  - OpenCode plugin entrypoint in `src/index.ts`
  - **Static slot exports** (`CopilotHydraSlot0`–`CopilotHydraSlot7`) for per-account auth/runtime hooks
  - File-backed account/secrets storage in the OpenCode config dir
  - Generated OpenCode provider config sync via `opencode.json` / `opencode.jsonc`
  - Runtime provider→account isolation via routing leases and per-account token state
  - TUI/CLI account management implemented
  - **Auth-login setup path** now exposed under `opencode auth login` using provider `github-copilot`
- **Operational status**:
  - Phase 3 multi-account routing is complete
  - Phase 4 capability policy is complete
  - Phase 5 TUI is complete
  - **Next work is explicitly host-behavior hardening around `github-copilot` coexistence/replacement**

## 2) What is technically feasible now

### Proven feasible
- Multiple Copilot accounts can coexist in one OpenCode session.
- One provider per account is viable using IDs like `github-copilot-acct-<stableId>`.
- Parallel usage is viable with fail-closed routing and per-account runtime isolation.
- OpenCode auth login can now act as the **preferred add-account / re-auth entrypoint**.
- Restart/reload after account changes is an accepted and simplifying lifecycle constraint.

### Feasibility boundary
This is **not** a stable host-supported extension surface. It is a **best-effort takeover/replacement integration** that works only as long as OpenCode’s current internal Copilot behavior remains compatible.

## 3) Known gaps that must stay explicit in planning

### A. GPT-5+ / Responses routing gap
**Status:** Open and important

- Custom provider IDs (`github-copilot-acct-*`) do **not** automatically inherit OpenCode’s exact `CUSTOM_LOADERS["github-copilot"]` path.
- Repo docs repeatedly call out **GPT-5+/Responses API routing** as the main unresolved functional gap for custom providers.
- Current implication: newer Copilot/OpenAI-model paths may behave differently from built-in `github-copilot` unless CopilotHydra adds its own routing or intentionally limits model exposure.

**Planning meaning:** treat this as a **product-scope risk**, not a polish issue. Either:
1. explicitly limit unsupported/high-risk models in beta, or
2. fund a dedicated hardening phase for custom Responses routing.

### B. Host behavior / coexistence uncertainty
**Status:** Open and likely the highest planning risk

- The plugin now exposes a login/setup method under provider **`github-copilot`** to get closer to native OpenCode UX.
- What is still **not fully proven** is exact host behavior when CopilotHydra’s setup hook **coexists with or effectively replaces** built-in `github-copilot` behavior across OpenCode versions.
- This is called out in `docs/Loginmethod.md`, `README.md`, and `docs/IMPLEMENTATION_SEQUENCE.md` as the next hardening target.

**Planning meaning:** do **not** frame this as “login is done.” Frame it as **“login entrypoint exists, but takeover/coexistence behavior still needs host validation.”**

### C. Entitlement / capability truth uncertainty
**Status:** Known unsolved constraint, not a bug

- There is **no reliable official per-account entitlement API** for ordinary runtime use.
- V1 therefore depends on:
  - user-declared plan
  - explicit override for uncertain model exposure
  - runtime mismatch detection (especially 403-style failures)
- This is an intentional policy choice, not an implementation gap that can be quietly cleaned up later.

**Planning meaning:** capability truth must be treated as **fundamentally uncertain in v1**. Model exposure should stay conservative and user-acknowledged.

## 4) Hard constraints from the existing repo decisions

These are authoritative project constraints and should be treated as fixed planning inputs unless explicitly changed later:

- **No version pinning** to a single OpenCode version/range
- **Warning-first on unknown OpenCode versions**, fail closed only when runtime assumptions break
- **Restart/reload after account changes is acceptable**
- **Simultaneous multi-account usage in the same session is required**
- **One provider per account** is the preferred routing model
- **Fallback sidecar/broker architecture is out of scope**
- **Use OpenCode’s internal login/auth flow wherever possible**
- **TUI-only account management is acceptable for v1**
- **Secrets may be plaintext only for feasibility/beta**, with later secure-storage migration expected
- **Uncertain capability exposure requires explicit user override**
- **Plan mismatch must hard error, persist mismatch state, and prompt whether to overwrite stored plan**
- **Storage location follows OpenCode config directory conventions**
- **macOS/Linux first; Windows best-effort**

## 5) Additional technical constraints in the current implementation

- **Static export ceiling:** active accounts are capped at **8** because the host integration currently depends on static named exports.
- **Host-internal coupling:** current behavior relies on undocumented internals such as `providerID.includes("github-copilot")` and exact plugin export loading behavior.
- **Config mutation path:** provider entries must be written through config-file sync; plugin config hook is read-only.
- **Restart-sensitive architecture:** new account/provider availability depends on restart/reload; hot dynamic registration is not the architecture.
- **File-backed persistence:** full JSON files are rewritten under lock; workable for v1, but not elegant.
- **Cross-process lifecycle caveat:** final removal/drain safety is weaker across separate processes than within a single runtime.
- **Version detection remains incomplete:** current compatibility signaling is still basically a stub.

## 6) Guardrails planning should preserve

- **Fail closed on routing ambiguity**: never fall back from account A to account B.
- **Treat `github-copilot` takeover as compatibility-sensitive**: every host-facing assumption should be validated, documented, and warning-gated.
- **Keep GPT-5+/Responses support explicitly conditional** until custom routing is proven.
- **Keep model exposure conservative**: baseline-safe models by default, uncertain models behind explicit acknowledgment.
- **Preserve restart-based lifecycle** instead of slipping into half-supported hot-reload behavior.
- **Do not treat plaintext secret storage as release-ready**.
- **Do not treat current warning-first version checks as sufficient release hardening**.

## 7) External and internal dependencies that matter most

### Host/runtime dependencies
- OpenCode plugin loader behavior
- OpenCode `ProviderAuth` behavior
- OpenCode built-in Copilot-specific header/custom-loader logic
- OpenCode config-file conventions and overrides

### Service dependencies
- GitHub OAuth device flow
- GitHub Copilot API behavior
- Any upstream Copilot model-routing changes affecting Responses-style models

### Internal modules most relevant to the risk area
- `src/index.ts`
- `src/auth/login-method.ts`
- `src/auth/loader.ts`
- `src/auth/compatibility-check.ts`
- `src/config/providers.ts`
- `src/config/models.ts`
- `src/config/sync.ts`
- `src/routing/provider-account-map.ts`

## 8) Recommended risk framing for roadmap/planning

### Recommended headline
**“Proceed as a hardening-and-compatibility project, not as a greenfield feature build.”**

### How to frame the work
1. **Auth takeover/coexistence hardening**
   - Validate how CopilotHydra’s `github-copilot` setup path behaves beside or instead of built-in host behavior.
2. **Compatibility/version detection hardening**
   - Replace the stub with real host detection and a tested compatibility matrix.
3. **GPT-5+/Responses risk decision**
   - Either implement custom routing support or intentionally bound the model surface for beta.
4. **Release-safety hardening**
   - Secure-storage migration, cross-process edge-case tightening, clearer operator guidance.

### Planning posture
- Treat the project as **viable but not host-guaranteed**.
- Treat **host behavior drift** as the primary rewrite risk.
- Treat **GPT-5+/Responses support** as the primary feature-scope risk.
- Treat **entitlement uncertainty** as a permanent v1 product constraint.
- Treat **auth-login takeover validation** as the immediate gate before claiming native-feeling Copilot replacement.

## 9) Bottom line

CopilotHydra has already crossed the main feasibility threshold for multi-account GitHub Copilot inside OpenCode. The remaining risk is no longer “can multi-account exist?” but **“can auth takeover and runtime replacement stay correct across host behavior, model-routing edge cases, and compatibility drift?”**

That means planning should emphasize **hardening, compatibility verification, and scoped limitations**, not broad new feature expansion.

## Sources
- `docs/PLAN.md`
- `docs/IMPLEMENTATION_SEQUENCE.md`
- `docs/feasibility-notes.md`
- `docs/Loginmethod.md`
- `README.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONCERNS.md`
- `.planning/codebase/INTEGRATIONS.md`
- `.planning/codebase/STACK.md`
- `.planning/codebase/STRUCTURE.md`
- `.planning/codebase/TESTING.md`
- `.planning/codebase/CONVENTIONS.md`

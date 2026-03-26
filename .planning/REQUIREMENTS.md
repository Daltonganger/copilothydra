# Requirements: CopilotHydra GitHub Copilot Host Hardening

**Defined:** 2026-03-25
**Core Value:** A user can use multiple GitHub Copilot accounts side by side inside OpenCode, select models per account explicitly, and trust that auth/login and runtime routing stay clear and correct.

## v1 Requirements

### Authentication Integration

- [ ] **AUTH-01**: User can start GitHub Copilot account login from `opencode auth login` through the CopilotHydra-managed `github-copilot` path
- [ ] **AUTH-02**: User can add a new Copilot account without breaking existing active Copilot accounts
- [ ] **AUTH-03**: User can re-authenticate an existing Copilot account from the same auth-login flow
- [ ] **AUTH-04**: User receives clear guidance when login is abandoned, incomplete, or requires restart/reload before the account becomes usable

### Multi-Account Runtime

- [ ] **RUNT-01**: User can keep multiple Copilot accounts active in the same OpenCode environment at the same time
- [ ] **RUNT-02**: User requests routed through one account never silently fall back to another account
- [ ] **RUNT-03**: User can remove or replace an account without ambiguous runtime state or silent cross-account leakage

### Model Selection

- [ ] **MODL-01**: User sees model choices as separate per-account entries in one shared list
- [ ] **MODL-02**: User can distinguish duplicate model names because each model entry includes clear account labeling
- [ ] **MODL-03**: User can manually choose the exact account/model combination to use, with no automatic routing or fallback policy
- [ ] **MODL-04**: User can see when model availability is user-declared, uncertain, or contradicted by runtime mismatch evidence

### Compatibility & Hardening

- [ ] **COMP-01**: User receives warning-first compatibility/version messaging when OpenCode host behavior is unknown or potentially risky
- [ ] **COMP-02**: User gets actionable failure behavior when runtime/auth assumptions are actually broken
- [ ] **COMP-03**: User is protected from unsupported or high-risk Copilot model paths being implied as fully supported when routing behavior is not proven
- [ ] **COMP-04**: User receives clear guardrails around restart-required lifecycle and active account slot limits

### Operator Readiness

- [ ] **OPER-01**: User-facing docs describe `opencode auth login` as the primary path for Copilot account add/re-auth
- [ ] **OPER-02**: User-facing docs describe known limitations and recovery guidance for compatibility uncertainty, restart requirements, and unresolved routing gaps

## v2 Requirements

### Security & Storage

- **SECU-01**: User secrets are migrated from plaintext storage to secure OS-backed storage

### Platform & Scale

- **PLAT-01**: User can exceed the current static multi-account slot cap without host-export workarounds
- **PLAT-02**: User gets stronger cross-process account removal/finalization guarantees across separate OpenCode runtimes

### Advanced Compatibility

- **ADVC-01**: User can rely on full GPT-5+/Responses parity for custom Copilot account providers
- **ADVC-02**: User gets a richer tested compatibility matrix across OpenCode host versions

## Out of Scope

| Feature | Reason |
|---------|--------|
| Non-Copilot providers | This initiative is explicitly Copilot-only |
| Automatic routing / fallback selection | User requires explicit manual account+model selection |
| Authoritative entitlement discovery | Reliable runtime proof is unavailable; hybrid capability truth is the accepted contract |
| Keychain / secure-storage redesign | Deferred beyond this hardening phase |
| Sidecar / broker architecture | Current project direction is host-integrated hardening, not architectural replacement |
| Removing restart/reload sensitivity | Restart-based lifecycle is accepted for this phase |
| Enterprise GitHub / GHE support | Outside current beta hardening scope |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| AUTH-04 | Phase 1 | Pending |
| RUNT-01 | Phase 2 | Pending |
| RUNT-02 | Phase 2 | Pending |
| RUNT-03 | Phase 2 | Pending |
| MODL-01 | Phase 2 | Pending |
| MODL-02 | Phase 2 | Pending |
| MODL-03 | Phase 2 | Pending |
| MODL-04 | Phase 2 | Pending |
| COMP-01 | Phase 2 | Pending |
| COMP-02 | Phase 2 | Pending |
| COMP-03 | Phase 2 | Pending |
| COMP-04 | Phase 2 | Pending |
| OPER-01 | Phase 3 | Pending |
| OPER-02 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after roadmap creation*
# CopilotHydra Top 12 Improvement Priorities

A concise, ranked view of the highest-value hardening work for CopilotHydra based on the current improvement inventory.

This list includes one concrete UX/operability addition inspired by the account usage visibility shown in `opgginc/opencode-bar`.

## Ranking

1. **Compatibility/version detection + maintained compatibility matrix**  
   Detect host-version risk early and keep a clear tested/untested matrix so operators know when OpenCode internals may have shifted.

2. **Black-box OpenCode regression testing**  
   Add end-to-end host-level tests around `opencode auth login`, provider wiring, and routed requests so regressions are caught without depending on undocumented internals.

3. **Built-in `github-copilot` coexistence and recovery**  
   Make takeover, fallback, and recovery paths explicit so Hydra can coexist with or safely recover from host-native Copilot state.

4. **Capability truth improvements**  
   Tighten declared-plan vs observed-behavior handling so mismatches are visible, actionable, and less confusing during model selection and runtime failures.

5. **Percentage usage visibility for GitHub Copilot accounts**  
   Show a clear per-account usage percentage (and recent history where possible) so operators can tell which Copilot account is nearing quota, borrowing the practical visibility pattern proven by `opgginc/opencode-bar` without changing Hydra's explicit routing model.

6. **Model catalog drift detection**  
   Detect when OpenCode or Copilot model lists change so stale mappings do not silently break routing or expose incorrect choices.

7. **Secure secret storage hardening**  
   Improve storage guarantees, validation, and operator safety around token persistence because auth reliability depends on secrets staying both recoverable and protected. This work now starts with plaintext secret-file permission hardening plus audit/repair visibility before any later keychain migration.

8. **Operator docs and runbooks**  
   Add short operational guides for login issues, mismatch review, recovery, storage repair, and safe restart flows so real-world support is faster and less error-prone.

9. **Broader Responses/Codex parity coverage**  
   Expand test and behavior coverage across Copilot response surfaces so manual routing works consistently beyond the most common chat path.

10. **Enterprise/support-boundary clarity**  
    Document what is supported, what is best-effort, and what remains outside scope so enterprise users understand operational limits before adoption.

11. **8-slot limit removal or clearer mitigation**  
    Address the current static export-slot ceiling or document a stronger operator strategy for working within it, since account scale is a core Hydra value proposition.

12. **Smarter, shorter model/provider naming in OpenCode lists**  
    Make the visible provider name in the model list much more compact so it actually fits inside OpenCode. Let the user choose, in a sensible place, what should be shown there — for example a username, nickname, or short `**`-style label — instead of long labels such as `GitHub Copilot - Personal (Ruben)`.

## Notes

- These items are ranked for hardening impact, not implementation ease.
- The emphasis is on dependable `opencode auth login` takeover, explicit routing, and safer multi-account operation inside OpenCode.
- The new usage-percentage item is intended as operator visibility only, not automatic account switching or hidden fallback.

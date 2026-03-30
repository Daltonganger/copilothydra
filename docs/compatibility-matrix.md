# OpenCode Compatibility Matrix

> **Beta / hardening phase.** CopilotHydra is not yet stable software. See `docs/release-checklist.md` for the current release gate.

CopilotHydra uses a warn-first compatibility policy for OpenCode host internals.
Unknown versions do **not** hard-fail on their own, but the plugin logs warnings
when the host version is untested or when expected `PluginInput` signals are
missing.

## Detection strategy

`src/auth/compatibility-check.ts` only inspects signals already available on the
plugin hook input:

- top-level `PluginInput` fields such as `directory` and `serverUrl`
- version-like fields on `PluginInput`, `client`, `project`, `worktree`, and `$`
- common host keys such as `version`, `opencodeVersion`, `hostVersion`, and `appVersion`

No network probing or undocumented host calls are performed.

## Tested versions

| OpenCode version | Status | Notes |
| --- | --- | --- |
| 1.3.0 | Tested | Locally verified during real host validation of auth/login takeover behavior. |
| 1.3.2 | Tested | Locally verified during host validation after startup-noise/auth-login hardening. |
| 1.3.3 | Tested | Locally verified during Hydra auth/login + provider parity hardening. |

For the current step-1 host-compatibility gate, the matrix above is the source of
truth for tested OpenCode versions.

## Built-in `github-copilot` coexistence and recovery

Current verified behavior for the tested host line:

- unknown or untested OpenCode versions stay warn-first rather than hard-failing
- CopilotHydra config sync removes only Hydra-managed `github-copilot` disable
  state and keeps the built-in provider available for login/add-account flows
- zero-account recovery restores host-native `github-copilot` availability by
  reconciling stale takeover state on startup

Implementation and regression references:

- `src/auth/compatibility-check.ts`
- `tests/compatibility-warning.test.js`
- `src/config/sync.ts`
- `src/index.ts`
- `tests/smoke-sync.test.js`

## Warning cases

CopilotHydra warns when any of the following are true:

- a detectable OpenCode version is not in the tested matrix
- `PluginInput.directory` is missing or not a non-empty string
- `PluginInput.serverUrl` is missing or not a non-empty string/URL
- no version signal is exposed by the host (debug-only; no warning by itself)

## GPT-5+/Responses/Codex support boundary

CopilotHydra currently supports the main GPT-5-family text-generation path for
account-scoped custom provider IDs through its local parity layer.

Supported today:

- GPT-5-family routing through Hydra's local provider wrapper
- routing-selection coverage for the current GPT-5 family boundary (`gpt-5*` except `gpt-5-mini`)
- text-generation flows covered by the current Responses parity tests
- tool-only stream passthrough without synthetic text boundaries
- mixed text and non-text chunk preservation with normalized single-text-part output
- account-scoped request routing with Hydra-managed bearer-token injection

**Forward-matching note:** `shouldUseCopilotResponsesApi` returns `true` for any model ID starting with `gpt-5` except `gpt-5-mini`. This means unknown future `gpt-5.x` variants will automatically route to the Responses API path. This is intentional for forward compatibility but means new variants receive best-effort rather than verified support until explicitly tested and added to this matrix.

Best-effort / not guaranteed as exact built-in parity:

- broader Codex-adjacent or tool-heavy Responses event surfaces
- future OpenCode/GitHub Copilot response event shapes
- full equivalence with OpenCode's exact built-in `CUSTOM_LOADERS["github-copilot"]` behavior

If these paths regress, CopilotHydra should either harden them explicitly or
document a tighter supported boundary rather than silently overclaim parity.

## Support boundary reference

For the broader supported vs best-effort vs out-of-scope policy — including
enterprise-managed GitHub.com and GHES positioning — use
`docs/support-boundaries.md` as the primary reference.

## Operator guidance

If you hit a compatibility warning:

1. confirm the OpenCode version in use
2. verify `opencode auth login` and routed Copilot requests still work
3. capture the warning text and host version for future matrix updates

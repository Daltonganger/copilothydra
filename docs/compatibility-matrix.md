# OpenCode Compatibility Matrix

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
| 1.3.3 | Tested | Locally verified during Hydra auth/login + provider parity hardening. |

## Warning cases

CopilotHydra warns when any of the following are true:

- a detectable OpenCode version is not in the tested matrix
- `PluginInput.directory` is missing or not a non-empty string
- `PluginInput.serverUrl` is missing or not a non-empty string
- no version signal is exposed by the host (debug-only; no warning by itself)

## Operator guidance

If you hit a compatibility warning:

1. confirm the OpenCode version in use
2. verify `opencode auth login` and routed Copilot requests still work
3. capture the warning text and host version for future matrix updates

# CopilotHydra

CopilotHydra is an OpenCode plugin that enables multiple GitHub Copilot accounts side by side.

## Current status

Implemented so far:
- Phase 0 scaffold
- Feasibility spikes A/B/C/E/D
- Feasibility gate: GO
- Phase 1 single-account reference path
- Early tests

## What works now

- Per-account provider IDs in the form `github-copilot-acct-<id>`
- Static plugin slot exports for multiple accounts
- GitHub device-flow based auth hook integration
- OpenCode config sync for provider entries
- Account-specific model labels like `gpt-4o (Personal)`
- Bootstrap CLI for:
  - `copilothydra add-account`
  - `copilothydra list-accounts`
  - `copilothydra sync-config`
- Smoke/config/non-TTY/compatibility tests

## Important behavior

- OpenCode reload/restart is required after account/config changes
- After reload, multiple account-specific providers/models can coexist
- Capability exposure is currently user-declared with runtime mismatch detection policy
- GPT-5+/responses routing is still a known gap for custom provider IDs

## Development

Install:

```bash
npm install
```

Build:

```bash
npm run build
```

Typecheck:

```bash
npm run typecheck
```

Test:

```bash
npm test
```

## Docs

- `docs/PLAN.md`
- `docs/IMPLEMENTATION_SEQUENCE.md`
- `docs/feasibility-notes.md`

## Next step

Phase 2: account registry and storage hardening.

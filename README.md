# CopilotHydra

CopilotHydra is an OpenCode plugin that enables multiple GitHub Copilot accounts side by side.

## Current status

Implemented so far:
- Phase 0 scaffold
- Feasibility spikes A/B/C/E/D
- Feasibility gate: GO
- Phase 1 single-account reference path
- Early tests
- Phase 2 storage hardening (first transaction/locking pass)

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
- Lock-wrapped account/secrets update transactions
- Storage transaction test coverage for account updates

## Important behavior

- OpenCode reload/restart is required after account/config changes
- After reload, multiple account-specific providers/models can coexist
- Capability exposure is currently user-declared with runtime mismatch detection policy
- GPT-5+/responses routing is still a known gap for custom provider IDs

## Known limitations

- **OpenCode compatibility is warning-first, not guaranteed.** Unknown or changed host versions may break internal Copilot assumptions.
- **Version detection is still a stub/hardening TODO.** We warn-first today, but the compatibility matrix and stricter checks still need to be built out.
- **GPT-5+/Responses API routing is a known gap.** Custom provider IDs like `github-copilot-acct-*` do not automatically get OpenCode's exact `CUSTOM_LOADERS["github-copilot"]` behavior.
- **Secrets are still plaintext for now.** This is accepted for current feasibility/beta work only, guarded by explicit project policy and env gating.
- **Capability truth is not authoritative in v1.** Plan/model exposure is user-declared plus runtime mismatch detection, not proven entitlement.

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

## Working agreement

Voor elke implementatiestap/phase werken we volgens dit ritme:

1. implementeer de stap
2. update `README.md` met de nieuwe status/gedragingen
3. update relevante docs (`docs/IMPLEMENTATION_SEQUENCE.md`, eventueel andere docs)
4. run build/typecheck/tests
5. maak een aparte PR voor die stap
6. ga pas daarna door naar de volgende stap

Kort: **één stap = docs bijwerken + PR maken + dan pas verder**.

## Next step

Continue Phase 2: account registry and storage hardening.

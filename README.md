# CopilotHydra

![CopilotHydra logo](https://unpkg.com/copilothydra@0.3.7/assets/branding/copilothydra-logo-512.png)

CopilotHydra is an OpenCode plugin for using multiple GitHub Copilot accounts side by side.

## Status

- **Stable — v0.3.7**
- Tested with **OpenCode 1.3.x and 1.20.x**
- Scope: **GitHub.com Copilot**, macOS/Linux first, Windows best-effort

## What it does

- adds and re-authenticates Copilot accounts through `opencode auth login`
- keeps accounts separated through account-scoped providers
- supports explicit manual routing per account/model
- provides CLI maintenance commands for sync, audit, repair, mismatch review, and usage snapshots

## Quick start

Install globally or as a dev dependency:

```bash
npm install -g copilothydra
# or
npm install copilothydra
```

Then use the primary flow in OpenCode:

```bash
opencode auth login
```

Useful CLI commands:

```bash
copilothydra list-accounts
copilothydra sync-config
copilothydra backfill-keychain
copilothydra export-primary-compat <account-id>
copilothydra audit-storage
copilothydra repair-storage
copilothydra review-mismatch <account-id>
copilothydra usage
```

## Known limitations

- Native OS keychain publishing is best-effort; `copilot-secrets.json` retained for fallback.
- Capped at **8 active accounts** (architecture limit).
- **User-declared plans** — no automatic plan verification; runtime mismatches are flagged.
- macOS/Linux primary, **Windows best-effort**.
- Enterprise-managed GitHub.com and GHES are **not supported**.

See [Operator guide](docs/OPERATORS.md) for native integrations, backfill instructions, and support boundaries.

## Docs

- [Changelog](CHANGELOG.md)
- [Operator guide](docs/OPERATORS.md) — auth/recovery, mismatch review, storage repair, support boundaries
- [Technical reference](docs/REFERENCE.md) — compatibility matrix, release gate, storage security, parity notes

## Development

```bash
npm run build
npm run typecheck
npm test
```

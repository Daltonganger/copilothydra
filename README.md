# CopilotHydra

![CopilotHydra logo](https://unpkg.com/copilothydra@0.1.0-beta.2/assets/branding/copilothydra-logo-512.png)

CopilotHydra is an OpenCode plugin for using multiple GitHub Copilot accounts side by side.

## Status

- **Beta / hardening phase**
- Tested with **OpenCode 1.3.0 / 1.3.2 / 1.3.3**
- Scope: **GitHub.com Copilot**, macOS/Linux first, Windows best-effort

## What it does

- adds and re-authenticates Copilot accounts through `opencode auth login`
- keeps accounts separated through account-scoped providers
- supports explicit manual routing per account/model
- provides CLI maintenance commands for sync, audit, repair, mismatch review, and usage snapshots

## Quick start

```bash
npm install
npm run build
```

Use the primary flow in OpenCode:

```bash
opencode auth login
```

Useful CLI commands:

```bash
copilothydra list-accounts
copilothydra sync-config
copilothydra audit-storage
copilothydra repair-storage
copilothydra usage
```

## Important limitations

- OpenCode compatibility is **warn-first**, not guaranteed
- GPT-5+/Responses/Codex parity is **best-effort**
- secrets are still **plaintext** for beta work
- capability truth is **not authoritative**
- Enterprise-managed GitHub.com and GHES are **not supported v1 paths**
- current runtime support is capped at **8 active accounts**

## Docs

- [OpenCode integration parity](docs/OPENCODE_INTEGRATION_PARITY.md)
- [Release checklist](docs/release-checklist.md)
- [Compatibility matrix](docs/compatibility-matrix.md)
- [Operator auth recovery runbook](docs/operator-auth-recovery-runbook.md)
- [Support boundaries](docs/support-boundaries.md)
- [Archived planning and spike notes](docs/archive/)

## Development

```bash
npm run build
npm run typecheck
npm test
```

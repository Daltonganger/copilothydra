# CopilotHydra

![CopilotHydra logo](https://unpkg.com/copilothydra@0.2.0/assets/branding/copilothydra-logo-512.png)

CopilotHydra is an OpenCode plugin for using multiple GitHub Copilot accounts side by side.

## Status

- **Stable — v0.2.0**
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
copilothydra audit-storage
copilothydra repair-storage
copilothydra review-mismatch <account-id>
copilothydra usage
```

## Known limitations

- Secrets stored as **plaintext** with `0600` file permissions — no keychain. See `docs/plaintext-secret-storage-decision.md`.
- Capped at **8 active accounts** (architecture limit, not temporary).
- **User-declared plans** — no automatic plan verification; runtime mismatches are flagged.
- GPT-5+/Responses/Codex parity is **best-effort** outside documented surfaces.
- Enterprise-managed GitHub.com and GHES are **not supported**.
- macOS/Linux primary, **Windows best-effort**.

## Docs

- [Changelog](CHANGELOG.md)
- [Compatibility matrix](docs/compatibility-matrix.md)
- [Support boundaries](docs/support-boundaries.md)
- [Operator auth & recovery runbook](docs/operator-auth-recovery-runbook.md)
- [Operator mismatch-review runbook](docs/operator-mismatch-review-runbook.md)
- [Operator storage-repair runbook](docs/operator-storage-repair-runbook.md)
- [Plaintext secret storage decision](docs/plaintext-secret-storage-decision.md)
- [Release checklist](docs/release-checklist.md)
- [OpenCode integration parity](docs/OPENCODE_INTEGRATION_PARITY.md)

## Development

```bash
npm run build
npm run typecheck
npm test
```

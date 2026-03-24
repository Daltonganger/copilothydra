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
- Phase 2 storage hardening (corruption recovery pass)
- Phase 2 storage hardening (account removal + orphan cleanup pass)
- Phase 2 storage hardening (schema validation + duplicate detection pass)
- Phase 2 registry hardening (duplicate GitHub account prevention pass)
- Phase 2 repair flow (storage/config reconcile pass)
- Phase 2 account metadata update flow (rename / plan update / revalidate pass)
- Phase 2 audit flow (detect-only storage/config doctor pass)
- Phase 2 storage edge-case hardening (enum/timestamp/optional token validation pass)
- Phase 3 routing foundation (lease-based provider→account routing guards)
- Phase 3 routed token integration (provider→account→token fail-closed path)
- Phase 3 drain-on-remove lifecycle (two-step pending-removal → final cleanup flow)
- Phase 3 token lifecycle serialization (same-account token sync prepared for refresh-safe evolution)

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
  - `copilothydra rename-account <account-id|provider-id> <new-label>`
  - `copilothydra set-plan <account-id|provider-id> <free|student|pro|pro+>`
  - `copilothydra revalidate-account <account-id|provider-id>`
  - `copilothydra audit-storage`
- Smoke/config/non-TTY/compatibility tests
- Lock-wrapped account/secrets update transactions
- Storage transaction test coverage for account updates
- Corrupt account/secret files are quarantined to `*.corrupt-*` and recovered to empty v1 state
- Secret transaction test coverage and corruption recovery tests
- Orphan secret cleanup is available
- `copilothydra remove-account <account-id|provider-id>` removes account metadata, secrets, and synced provider config
- `copilothydra remove-account <account-id|provider-id>` now uses a two-step drain flow: first mark pending-removal, then finalize cleanup on the next call
- Malformed or duplicate account/secret entries are treated as corruption and quarantined before recovery
- Duplicate GitHub usernames are blocked case-insensitively in both account creation and storage validation
- `copilothydra repair-storage` prunes orphan secrets and removes stale CopilotHydra provider entries from OpenCode config
- existing accounts can now be renamed, revalidated, and moved to a new declared plan without manual file editing
- `copilothydra audit-storage` reports orphan secrets and provider drift without mutating storage
- Stored account enums/timestamps and optional secret token fields are now validated strictly and quarantined on malformed state
- Runtime routing now has lease-based in-flight tracking and pending-removal guards per account
- Auth loader requests now sync runtime token state through provider routing and fail closed when routed token state is unavailable
- Pending-removal accounts are now persisted in storage, removed from generated provider config, and finalized only after drain-complete cleanup
- Same-account token lifecycle work is now serialized before auth-header injection, preparing Phase 3 for refresh/exchange without same-account races

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

Continue Phase 3: multi-account routing and request isolation.

## Remaining roadmap

### First: process current open PRs

- PR #11 — Phase 3 routing foundation
- PR #12 — routed token integration
- PR #13 — drain-aware removal
- PR #14 — token lifecycle serialization

Expected effort: **1 merge/cleanup block**

### Phase 3 — multi-account routing (remaining)

Expected remaining: **about 3 PRs**

1. **Refresh/recovery path**
   - real refresh/exchange serialization
   - revoked/expired token recovery
   - fail-closed recovery behavior
2. **Parallel isolation hardening**
   - more concurrency coverage
   - same-account vs cross-account isolation checks
   - no token/account bleed under overlap
3. **Routing lifecycle completion**
   - remaining pending-removal / restart / sync edge cases
   - Phase 3 completion docs and final tests

### Phase 4 — capability/model exposure

Expected remaining: **about 2–3 PRs**

1. **Declared model exposure hardening**
   - centralize plan → model exposure
   - mark uncertain models explicitly
2. **Mismatch/downgrade flow**
   - mismatch state logic
   - stricter-plan overwrite/confirm behavior
3. **Docs/tests pass**
   - capability policy docs
   - Phase 4 completion tests and cleanup

### Phase 5 — TUI

Expected remaining: **about 3–4 PRs**

1. **Menu foundation**
2. **Account actions in TUI**
3. **Lifecycle state presentation**
4. **Polish/tests/docs**

### Hardening

Expected remaining: **about 3 PRs**

1. **Compatibility/version detection**
2. **GPT-5+/Responses gap mitigation or explicit limitation**
3. **Release hardening**
   - regression coverage
   - final docs
   - beta caveats/security notes

### Rough total remaining

- **1 PR block** for current open PR cleanup
- **3 PRs** for Phase 3
- **2–3 PRs** for Phase 4
- **3–4 PRs** for Phase 5
- **3 PRs** for Hardening

Estimated total remaining: **about 12–14 PRs**.

### Most important milestone

The main architectural milestone is: **finish Phase 3**.

After that, the backend/routing core is mostly in place and the remaining work shifts more toward:
- capability policy
- user experience / TUI
- hardening and release quality

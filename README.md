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
- Phase 3 routed token recovery gating (single-flight retry path for expired/missing routed token state)
- Phase 3 parallel isolation hardening (cross-account concurrency and token-state isolation checks)
- Phase 3 lifecycle/runtime finish (ownership mismatch guards and full runtime-state cleanup)
- Phase 4 declared model exposure hardening (uncertain model filtering + explicit override flag)
- Phase 4 mismatch/downgrade flow (runtime mismatch marking + suggested plan review)
- Phase 4 docs/tests completion (capability policy coverage + status/docs closeout)
- Phase 5 TUI foundation (menu entrypoint + empty/account overview screens)
- Phase 5 TUI account actions (rename + revalidate wired into the menu)
- Phase 5 TUI removal and mismatch actions (two-step removal + mismatch review in the menu)
- Phase 5 TUI add-account completion (guided add-account now wired into the menu)
- OpenCode auth-login integration prep (CopilotHydra login method under `opencode auth login`)

## What works now

- Per-account provider IDs in the form `github-copilot-acct-<id>`
- Static plugin slot exports for multiple accounts
- GitHub device-flow based auth hook integration
- A CopilotHydra setup/login method now registers under `opencode auth login` via the plugin auth hook
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
- Routed auth now performs one per-account single-flight recovery attempt when synced token state is expired before failing closed
- Parallel overlap is now covered explicitly: same-account recovery is coalesced while cross-account requests keep independent routed Authorization state
- Routed auth now fail-closes on provider/account ownership mismatch, and final account removal fully clears runtime token/recovery state
- User-declared accounts now hide override-required models by default until explicit override is enabled
- Generated model labels now mark explicitly exposed uncertain entries as `user-declared override`
- `copilothydra set-plan ... --allow-unverified-models` enables those uncertain model entries intentionally
- Runtime 403 entitlement failures now mark the account as `mismatch`, disable unverified-model override exposure, and store the rejected model plus suggested stricter plan
- `copilothydra review-mismatch <account-id|provider-id>` reviews a stored mismatch and can apply the suggested downgrade
- `copilothydra list-accounts` surfaces the current capability state so mismatches are visible without opening storage files
- `copilothydra` / `copilothydra menu` now opens a line-based account manager in TTY environments
- The Phase 5 menu shows empty-state guidance, account overview rows, capability/lifecycle states, and restart-required notice
- The TUI foundation can already resync provider config from inside the menu
- The TUI can now rename an account label and revalidate an account directly from the menu
- The TUI can now mark accounts pending-removal, finalize drained removals, and review/apply mismatch downgrades directly from the menu
- The TUI can now add a new account directly from the menu, including declared plan selection and uncertain-model override acknowledgement
- OpenCode auth login can now drive both first-account creation and existing-account re-auth through dedicated CopilotHydra login options under `github-copilot`
- New accounts created through the auth-login method sync `opencode.json` immediately and return auth success for the account-specific provider id

## Important behavior

- OpenCode reload/restart is required after account/config changes
- After reload, multiple account-specific providers/models can coexist
- Capability exposure is currently user-declared with runtime mismatch detection policy
- User-declared plan exposure now defaults to baseline models only; override-required models stay hidden unless explicitly acknowledged
- A mismatch can preserve the current declared plan, or overwrite it with a suggested stricter one after explicit review
- The TUI Phase 5 scope is now complete as a dependency-free line-based account manager for v1
- `copilothydra add-account` remains available, but OpenCode auth login is now the preferred path for add-account / re-auth orchestration
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
- `docs/Loginmethod.md`
- `docs/top-improvements.md`

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

Continue auth-login hardening and the post-Phase-5 polish/hardening work.

## Remaining roadmap

### Phase 4 — capability/model exposure

Completed in **3 stacked PRs**

1. **Declared model exposure hardening**
   - centralize plan → model exposure ✅
   - mark uncertain models explicitly ✅
2. **Mismatch/downgrade flow**
   - mismatch state logic ✅
   - stricter-plan overwrite/confirm behavior ✅
3. **Docs/tests pass**
   - capability policy docs ✅
   - Phase 4 completion tests and cleanup ✅

### Phase 5 — TUI

Completed in **4 stacked PRs**

1. **Menu foundation** ✅
   - line-based TUI entrypoint
   - empty/account overview screens
   - non-TTY guard for the menu path
2. **Account actions in TUI**
    - rename account ✅
    - revalidate account ✅
    - remove account ✅
    - review mismatch ✅
    - add account ✅
3. **Lifecycle state presentation**
    - pending-removal and mismatch review states are now actionable in-menu ✅
4. **Polish/tests/docs** ✅

### Auth-login integration

In progress: CopilotHydra now exposes a login method in `opencode auth login`, with follow-up hardening still needed

1. **Setup/login entrypoint** ✅
   - `CopilotHydraSetup` now returns an auth hook instead of a no-op
   - add-account / re-auth can start from OpenCode auth login inputs
2. **Host-behavior validation**
   - verify provider-list behavior across more OpenCode versions
   - confirm how the setup hook coexists with built-in `github-copilot`

### Hardening

Expected remaining: **about 3 PRs**

1. **Compatibility/version detection**
2. **GPT-5+/Responses gap mitigation or explicit limitation**
3. **Release hardening**
   - regression coverage
   - final docs
   - beta caveats/security notes

### Rough total remaining

- **0 PRs** for Phase 4
- **0 PRs** for Phase 5
- **1–2 PRs** for auth-login integration
- **3 PRs** for Hardening

Estimated total remaining: **about 4–5 PRs**.

### Most important milestone

The main architectural milestone is now complete: **Phase 3 finished**.

From here, the backend/routing core is mostly in place and the remaining work shifts more toward:
- capability policy
- user experience / TUI
- hardening and release quality

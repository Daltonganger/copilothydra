# CopilotHydra — Operator Guide

**Stable — v0.3.8.** This document covers auth/recovery, mismatch review, storage repair, and support boundaries for CopilotHydra.

---

## Native integrations (0.3.8)

CopilotHydra publishes `copilot-cli`-compatible native credential-store entries after successful auth:

- service: `copilot-cli`
- account: `https://github.com:<githubUsername>`
- password: raw GitHub OAuth token

This means **OpenCode Bar** can discover Hydra-managed accounts natively on macOS without plugin-side changes. If you disable CopilotHydra, tools that already read `copilot-cli` native credentials can still discover the account.

### Confirmed integrations

| Tool | Status | Notes |
|---|---|---|
| [OpenCode Bar](https://github.com/opgginc/opencode-bar) | **Works** | Native keychain discovery via `copilot-cli` credentials on macOS |
| [AIUsageTracker](https://github.com/rygel/AIUsageTracker) | **Single-primary only** | Export via `copilothydra export-primary-compat <account-id>` |
| [opencode-quota](https://github.com/slkiser/opencode-quota) | **Single-primary only** | Export via `copilothydra export-primary-compat <account-id>` |

**AIUsageTracker** and **opencode-quota** are single-account consumers. CopilotHydra exports only a single primary account for those tools. These exports are **non-destructive** — Hydra will not overwrite an existing entry in either destination.

Full multi-account compatibility for those tools requires upstream changes in their repos.

### One-time backfill for existing accounts

If you had CopilotHydra accounts before 0.3.0, re-auth is not required. Run:

```bash
copilothydra backfill-keychain
```

This publishes existing active account tokens from Hydra's local secrets file into the native `copilot-cli` credential-store format.

### Single-primary export for AIUsageTracker / opencode-quota

```bash
copilothydra export-primary-compat <account-id>
```

Exports that account into:
- OpenCode `auth.json` as a `github-copilot` alias (for `opencode-quota`)
- GitHub CLI `hosts.yml` as a `github.com` OAuth token (for `AIUsageTracker`)

CopilotHydra will **not** overwrite an existing entry in either destination.

---

## Support boundaries

### Supported today

- GitHub.com GitHub Copilot multi-account usage through CopilotHydra-managed account-scoped providers
- Primary `opencode auth login` add-account and re-auth flow
- Warn-first host compatibility for tested and untested OpenCode versions (see [REFERENCE.md](./REFERENCE.md))
- Account-scoped provider generation, manual model routing, mismatch detection, and review flows for personal plan tiers: `free`, `student`, `pro`, `pro+`
- Current documented personal-plan model baseline in [REFERENCE.md](./REFERENCE.md): GPT-4.1, GPT-5 variants, Claude Haiku/Sonnet/Opus 4.7, Gemini 2.5/3.x, Grok Code Fast 1, Raptor mini, Goldeneye

### Best-effort / compatibility-sensitive

- OpenCode host internals around `github-copilot` (compatibility-sensitive, partially documented)
- Windows support (not a fully validated primary platform)
- Model parity outside the specifically documented and tested baseline, including future GitHub model churn and business/enterprise-only surfaces
- Capability truth beyond user-declared plan + runtime mismatch detection
- Native credential-store publishing via `@napi-rs/keyring` (best-effort; `copilot-secrets.json` retained for local bookkeeping/fallback)

### Out of scope

- Enterprise-managed GitHub.com and GitHub Enterprise Server (GHES)
- Automatic entitlement truth or authoritative plan verification
- More than 8 simultaneously active accounts (deliberate architecture boundary)
- Hidden fallback or automatic account switching
- Authoritative per-account quota percentages from unsupported billing sources

### Known limitations (canonical list)

- **Hybrid secret storage** — native credential-store entries published best-effort; `copilot-secrets.json` retained for local bookkeeping and fallback.
- **8-account cap** — architecturally capped at 8 simultaneously active accounts. Deliberate boundary, not a temporary limit.
- **User-declared plans** — plan is declared on add-account; mismatches detected at runtime and flagged.
- **macOS/Linux primary, Windows best-effort** — file permission hardening (`chmod 0600`) not supported on Windows.
- **No enterprise or GHES support.**
- **Model parity outside the documented personal-plan baseline is best-effort.**
- **Native consumer compatibility is limited** — OpenCode Bar is confirmed on macOS; AIUsageTracker and opencode-quota read different auth sources and do not auto-discover Hydra accounts.

---

## Auth & recovery

### Auth method labels

When CopilotHydra is active, `opencode auth login` shows:

- `GitHub Copilot (CopilotHydra) — Add new account`
- `GitHub Copilot (CopilotHydra) — Re-auth existing account`

### When restart/reload is required

Required after: adding account, removing account, changing stored plan, syncing config manually, repairing storage with stale entries removed.

Not required as first step after re-auth (re-auth only refreshes token state; no provider/config shape change).

### Add first account

1. `opencode auth login -p github-copilot-hydra`
2. Choose **Add new account**
3. Fill in: GitHub username, label, declared plan, whether uncertain models should be exposed
4. Complete GitHub device flow
5. Restart or reload OpenCode
6. Confirm account-scoped provider/models appear

### Re-auth existing account

1. `opencode auth login -p github-copilot-hydra`
2. Choose **Re-auth existing account**
3. Enter GitHub username
4. Complete device flow

### Recovery scenarios

**CopilotHydra does not appear in `opencode auth login`:**
1. Confirm plugin is configured/loaded
2. Confirm OpenCode was reloaded after last provider/config mutation
3. Run `copilothydra sync-config`
4. If Hydra has zero accounts, built-in `github-copilot` should appear instead

**New provider missing after add-account:**
1. `copilothydra sync-config`
2. Reload/restart OpenCode
3. `copilothydra list-accounts` — confirm account exists
4. `copilothydra audit-storage` — check for missing/stale provider entries or model catalog drift

**Duplicate username blocks add-account:**
Username already stored. Use `copilothydra list-accounts` to find the existing account, then use **Re-auth existing account**.

**Compatibility/version warning appears:**
Check [REFERENCE.md](./REFERENCE.md) for the tested version matrix. If auth and routing still work, treat the warning as a signal to validate, not proof of breakage.

**Zero accounts, need `github-copilot` back:**
Built-in `github-copilot` should restore automatically. If not: `copilothydra sync-config` → reload/restart → `copilothydra audit-storage` → `copilothydra repair-storage`.

### Fallback/admin commands

Read-only: `copilothydra list-accounts`, `copilothydra audit-storage`

Mutating: `copilothydra sync-config`, `copilothydra repair-storage`, `copilothydra review-mismatch <account-id|provider-id>`

---

## Mismatch review

### What is a mismatch?

CopilotHydra uses a *user-declared plan*. At runtime, if the Copilot API rejects a model request with:

- **403 (entitlement rejected)** — the account tries a model outside its actual plan
- **400 (unsupported model)** — the model is not recognised or supported

...the account is marked `capabilityState: "mismatch"` and a `mismatchDetail` is stored (model, HTTP status, message, timestamp, suggested plan).

The account stays active. Other models remain available. The problem-model is blocked until resolved.

### Recognising a mismatch

`copilothydra list-accounts` output:
```
Account: my-github-user (pro)
  capabilityState: mismatch
  mismatchDetail:
    model: gpt-5.4
    httpStatus: 403
    message: entitlement rejected
    detectedAt: 2026-03-30T14:22:01Z
    suggestedPlan: student
```

Log output during active session:
```
[hydra:capability] mismatch detected for account "my-github-user"
  model "gpt-5.4" returned 403 (entitlement rejected)
  run: copilothydra review-mismatch my-github-user
```

### Review-mismatch flow

```
copilothydra review-mismatch <account-id|provider-id>
```

**Interactive (TTY):** shows mismatch details and optional downgrade suggestion. Choose `y` to apply, `n` to leave open.

**Batch (`--apply-suggested`):** applies suggestion automatically if available; exits with a message if manual intervention is needed.

### Understanding the downgrade suggestion

CopilotHydra shows a suggestion when the rejected model is clearly in a higher plan tier and a lower tier is a better fit. It uses "A lower plan tier may match your actual entitlement" — it does not claim certainty.

No suggestion appears when:
- the model is in multiple plans or not clearly tier-specific
- the account is on the lowest plan and can't go lower
- the error may indicate enterprise-only/org-restricted access

### Resolving a mismatch: options

| Option | When to use |
|---|---|
| Apply suggested downgrade | You agree the plan is wrong |
| Decline and investigate | You think the error may be temporary |
| Skip and continue | The model isn't critical |
| Re-auth and retry | Token may be expired |

### After applying a downgrade

1. `copilothydra sync-config` — resync model exposure for the updated plan
2. Reload/restart OpenCode
3. Test the affected account/models

### Downgrade doesn't help

If the account is restricted by enterprise policy or org-level settings, a plan downgrade won't fix it. The account may be permanently restricted for that model. In that case, remove it or use a different account.

### Clearing mismatch state after re-auth

Re-auth does **not** automatically clear mismatch state. After successful re-auth on a mismatched account:
1. `copilothydra review-mismatch <account-id>` — decline the downgrade
2. `copilothydra revalidate-account <account-id>` — reset capability state to `user-declared`

---

## Storage audit & repair

### Audit vs repair

| Command | Type | Description | Risk |
|---|---|---|---|
| `copilothydra audit-storage` | **Read-only** | Detects and reports problems | None |
| `copilothydra repair-storage` | **Mutating** | Resolves detected problems | Removes stale data |

**Rule:** always run `audit-storage` first.

### What `audit-storage` detects

- **Missing provider entries** — account exists in Hydra but has no OpenCode config entry
- **Stale provider entries** — OpenCode config entry exists but account was deleted
- **Orphan secrets** — token exists in `copilot-secrets.json` but no matching account
- **Wrong file permissions** — `copilot-secrets.json` not at `0600`
- **Model catalog drift** — local catalog may be out of date (informational)
- **Quarantined corrupt files** — corrupt JSON files that were auto-quarantined on load

### What `repair-storage` does and does not do

**Does:**
- Prune orphan secrets
- Remove stale provider entries
- Normalize file permissions to `0600`
- Report unresolvable problems

**Does not:**
- Create missing secrets (token is gone; re-auth required)
- Add/remove accounts
- Change plan tiers
- Restore corrupt file contents
- Directly activate OpenCode config (sync + reload still needed)

### Step-by-step: audit → repair → reload

1. `copilothydra audit-storage` — review output
2. If **missing secrets**: re-auth first via `opencode auth login -p github-copilot-hydra` → *Re-auth existing account*, then re-audit
3. If **corrupt files**: see corrupt file recovery below
4. `copilothydra repair-storage`
5. `copilothydra sync-config`
6. Reload or restart OpenCode
7. `copilothydra audit-storage` — verify clean
8. `copilothydra list-accounts` — verify expected accounts present

### Corrupt file recovery

When CopilotHydra can't parse a JSON file on load:
1. The file is auto-renamed to `<filename>.corrupt-<timestamp>`
2. CopilotHydra starts with empty/minimal state for that file
3. `audit-storage` reports the quarantined file

**Manual recovery:**
1. Inspect: `cat accounts.json.corrupt-20260330T142201Z`
2. If the JSON is partially recoverable, fix it manually and save as the original filename
3. If not recoverable: accounts in that file are lost — re-add via `opencode auth login` → *Add new account*
4. Delete the `.corrupt-*` file once resolved
5. `copilothydra sync-config` → reload OpenCode

**Prevention note:** CopilotHydra uses atomic writes (temp file + rename) to minimise corruption risk. Quarantine is the fallback for the rare case where atomic rename fails (e.g. filesystem full).

### What repair can't fix

| Problem | Action |
|---|---|
| Missing OAuth token | Re-auth: `opencode auth login -p github-copilot-hydra` → *Re-auth* |
| Wrong plan tier | `copilothydra review-mismatch <account-id>` |
| Model catalog drift | Update CopilotHydra to latest version |
| Corrupt file contents | Manual recovery or re-add accounts |
| OpenCode host problems | See Auth & recovery section above |

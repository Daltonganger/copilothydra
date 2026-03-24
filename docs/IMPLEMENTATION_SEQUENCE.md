# CopilotHydra — Concrete Implementation Sequence

## Goal

Deze volgorde vertaalt `PLAN.md` naar een concrete uitvoerbare implementatiefase, zodat we direct kunnen starten met bouwen zonder de feasibility-first aanpak los te laten.

## Werkafspraak per stap

Voor elke stap/phase in deze sequence geldt dezelfde uitvoerregel:

1. implementeer de stap
2. werk `README.md` bij
3. werk relevante docs/status bij
4. draai verificatie (`build`, `typecheck`, `tests`)
5. maak een aparte PR voor die stap
6. ga daarna pas door naar de volgende stap

Dus: **geen volgende phase zonder bijgewerkte docs en PR voor de vorige phase**.

---

## Status snapshot

### Afgerond
1. ✅ **Phase 0 repo scaffold**
2. ✅ **Spike A — auth/provider routing**
3. ✅ **Spike B — token chain**
4. ✅ **Spike C — model/provider registration**
5. ✅ **Spike E — storage/platform/TUI**
6. ✅ **Spike D — capability truth**
7. ✅ **Feasibility decision gate: GO**

### Afgerond
8. ✅ **Phase 1 — single-account reference path**
9. ✅ **Early tests**

### Nu bezig
10. ▶️ **Phase 2 — account registry + storage**
   - first pass done: lock-wrapped read-modify-write helpers for accounts/secrets
   - transaction test added for account storage updates
   - corruption recovery pass done: malformed storage files are quarantined and recreated
   - removal pass done: account removal now also cleans secrets and synced provider config

### Belangrijkste bewezen aannames tot nu toe
- OpenCode laadt **alle named exports** uit een pluginmodule en elke export kan één `Hooks.auth` registreren.
- `Hooks.auth` is **singular**, dus multi-account werkt via **meerdere statische plugin exports** (`CopilotHydraSlot0`–`CopilotHydraSlot7`), niet via één auth-array.
- `ProviderAuth` bewaart auth hooks als **`Record<ProviderID, Hook>`**: één auth hook per provider ID.
- De GitHub device-flow token wordt door OpenCode’s Copilot integratie **direct als Bearer token** gebruikt.
- `Auth.callback()` levert success-resultaten terug; **OpenCode slaat die daarna zelf op via `Auth.set()`**.
- `chat.headers` Copilot-specifieke logica gebruikt **`providerID.includes("github-copilot")`**, dus `github-copilot-acct-*` IDs werken hiervoor.
- Provider SDK-resolutie gebeurt via **`model.api.npm`**, niet via provider ID.
- De plugin `config` hook is **read-only** (`Promise<void>`), dus provider entries moeten via config-bestand/CLI geschreven worden, niet via de hook.
- `github-copilot-acct-*` providers kunnen dezelfde SDK-package gebruiken, maar krijgen **niet** automatisch OpenCode’s exacte `CUSTOM_LOADERS["github-copilot"]` model-routing mee.
- Er is **geen betrouwbare officiële entitlement API** voor individuele Copilot accounts; v1 moet dus user-declared capability + runtime mismatch detection gebruiken.
- OpenCode gebruikt zelf geen file-level locking of atomic temp-write JSON pattern; CopilotHydra’s strengere storage-aanpak is acceptabel.

### Toprisico’s die in elke volgende phase zichtbaar moeten blijven
- **Versiedetectie/host-compatibiliteit blijft gevoelig.** Unknown-version gedrag is nu warning-first; echte compatibiliteitsmatrix en hardere checks horen nog bij hardening.
- **GPT-5+/Responses API routing blijft een expliciete open gap** zolang custom provider IDs niet automatisch OpenCode’s `CUSTOM_LOADERS["github-copilot"]` pad krijgen.
- **Plaintext secrets blijven tijdelijk beta-only gedrag** en moeten zichtbaar als security caveat blijven bestaan tot keychain/secure storage is toegevoegd.

---

## 1. Phase 0 repo scaffold

**Status:** ✅ Gereed

Doel: een minimale, nette basis neerzetten voor spikes en verdere implementatie.

### Afgerond werk
- package setup aangemaakt
- `src/` en `docs/` basisstructuur neergezet
- gedeelde types toegevoegd
- basis logging/helpers toegevoegd
- simpele feature flags / debug flags toegevoegd
- storage-, auth-, routing- en UI-stubs opgezet

### Resultaat
- projectstructuur klaar voor spikes
- geen productlogica, alleen fundament
- zero TypeScript errors

---

## 2. Spike A — auth/provider routing

**Status:** ✅ Gereed

### Conclusie
- meerdere providers kunnen naast elkaar bestaan
- multi-account werkt via meerdere statische named exports
- auth-routing blijft per provider ID onderscheidbaar

---

## 3. Spike B — token chain

**Status:** ✅ Gereed

### Conclusie
- GitHub OAuth token uit device flow wordt direct gebruikt als Bearer token
- geen extra Copilot token exchange nodig in huidige hostflow
- loader moet custom `fetch` gebruiken

---

## 4. Spike C — model/provider registration

**Status:** ✅ Gereed

### Conclusie
- provider entries moeten via config-bestand/CLI geschreven worden
- SDK-keuze loopt via `model.api.npm`
- custom Copilot provider IDs zijn haalbaar
- GPT-5+/responses-routing blijft een expliciete gap

---

## 5. Spike E — storage/platform/TUI

**Status:** ✅ Gereed

### Conclusie
- OpenCode config/data dir gedrag is bevestigd
- CopilotHydra mag eigen metadata/secrets in config dir houden op projectbeleid
- lock-file + atomic temp-write aanpak is acceptabel
- browser/device auth flow is TUI-compatibel zolang non-TTY netjes faalt

---

## 6. Spike D — capability truth

**Status:** ✅ Gereed

### Conclusie
- geen betrouwbare API voor per-user entitlement truth
- GitHub Models catalog bewijst geen accounttoegang
- v1 beleid: user-declared plan + runtime mismatch detection

---

## 7. Feasibility decision gate

**Status:** ✅ GO

### Besluit
Verdergaan met implementatie is verantwoord binnen scope, met expliciete documentatie van:
- hostafhankelijkheden
- compatibility sensitivity
- capability beperkingen
- GPT-5+/responses-routing risico

Zie: `docs/feasibility-notes.md`

---

## 8. Phase 1 — single-account reference path

**Status:** ✅ Gereed

Doel: eerst één account volledig correct maken.

### Werk
- één stabiele provider bouwen
- één account flow ondersteunen
- correcte auth/token handling implementeren
- restart-based lifecycle gebruiken
- compatibility/runtime checks vroeg toevoegen
- config-write pad voor provider entries bouwen
- responses-vs-chat gap expliciet testen

### Afgerond
- bootstrap CLI toegevoegd: `dist/cli.js` / `copilothydra`
- single-account accountcreatie en metadata-opslag werkt
- provider entries worden naar OpenCode config gesynchroniseerd
- account-specifieke modellabels worden geschreven (`gpt-4o (Personal)` etc.)
- non-TTY guard werkt voor interactieve account add flow
- runtime warnings voor GPT-5+/responses-gap toegevoegd
- accountlimiet guard toegevoegd (max 8 statische slots)
- smoke test bevestigd dat `copilot-accounts.json` en `opencode.json` correct worden geschreven

### Exit criteria
- single-account flow werkt betrouwbaar ✅
- geen kritische token-onzekerheden meer in de core path ✅

---

## 9. Early tests

**Status:** ✅ Gereed

Doel: vroeg regressies voorkomen op de reference path.

### Werk
- smoke test voor single-account flow
- tests voor unknown-version warning behavior
- basis failure-path tests
- basis parsing/config tests

### Afgerond
- Node built-in test suite toegevoegd onder `tests/`
- smoke test voor account metadata + OpenCode config sync toegevoegd
- JSONC config parsing test toegevoegd
- unknown-version warning behavior test toegevoegd
- non-TTY CLI failure test toegevoegd

### Exit criteria
- reference path is herhaalbaar testbaar ✅

---

## 10. Phase 2 — account registry + storage

**Status:** ▶️ Volgende stap

Doel: meerdere accounts persistent kunnen beheren.

### Werk
- metadata store bouwen
- secrets store bouwen
- lock-wrapped transacties bouwen
- corruption recovery toevoegen
- config-dir resolution implementeren

### Reeds afgerond binnen Phase 2
- `updateAccounts(mutator, configDir?)` toegevoegd als lock-wrapped read-modify-write pad
- `updateSecrets(mutator, configDir?)` toegevoegd als lock-wrapped read-modify-write pad
- `upsertAccount` / `removeAccount` omgezet naar transaction helpers
- `upsertSecret` / `removeSecret` omgezet naar transaction helpers
- storage transaction test toegevoegd voor account updates
- corrupt `copilot-accounts.json` wordt nu naar `*.corrupt-*` verplaatst en daarna hersteld naar lege v1-state
- corrupt `copilot-secrets.json` wordt nu naar `*.corrupt-*` verplaatst en daarna hersteld naar lege v1-state
- tests toegevoegd voor secrets transaction pad en beide corruption-recovery paden
- `pruneOrphanSecrets(...)` toegevoegd voor orphan secret cleanup
- `removeAccountCompletely(...)` toegevoegd voor consistente account+secret+config cleanup
- CLI ondersteunt nu `remove-account <account-id|provider-id>`
- tests toegevoegd voor orphan cleanup, volledige removal helper en CLI removal pad

### Extra aandachtspunten
- plaintext secret-opslag expliciet als tijdelijke/beta-keuze blijven documenteren
- writes/locks moeten fail-closed blijven en geen silent corruption toelaten

---

## 11. Phase 3 — multi-account routing

Doel: correcte isolatie tussen accounts bij parallel gebruik.

### Werk
- provider → account mapping bouwen
- account → token state mapping bouwen
- request routing afdwingen
- concurrency guards toevoegen
- refresh/exchange serialisatie per account toevoegen indien nodig
- drain-on-remove gedrag implementeren

---

## 12. Phase 4 — capability/model exposure

Doel: modelaanbod per account gecontroleerd zichtbaar maken.

### Werk
- user-declared plan tiers ondersteunen
- expliciete override vereisen voor onzekere modellen
- mismatch/downgrade state tonen
- overwrite prompt bouwen voor restrictiever plan

---

## 13. Phase 5 — TUI

Doel: accountbeheer bruikbaar en duidelijk maken.

### Werk
- add account
- remove account
- revalidate account
- rename label
- mismatch review
- pending-removal state tonen
- restart-required state tonen
- non-TTY clean failure

---

## 14. Hardening

Doel: van werkend naar verantwoord beta-niveau.

### Werk
- regression tests uitbreiden
- compatibility matrix opbouwen
- docs afronden
- beta security warning documenteren rond plaintext secrets
- bekende host- en platformrisico’s expliciet maken
- version detection stub vervangen door echte host-compatibiliteitscontrole
- GPT-5+/responses-routing risico verkleinen of expliciet begrenzen

---

## Suggested file/module build order

1. `src/types.ts`
2. `src/auth/compatibility-check.ts`
3. `src/auth/loader.ts`
4. `src/auth/device-flow.ts`
5. `src/auth/token-state.ts`
6. `src/config/providers.ts`
7. `src/config/models.ts`
8. `src/storage/accounts.ts`
9. `src/storage/secrets.ts`
10. `src/storage/locking.ts`
11. `src/routing/provider-account-map.ts`
12. `src/config/capabilities.ts`
13. `src/ui/menu.ts`
14. `src/ui/select.ts`
15. `docs/feasibility-notes.md`
16. `docs/compatibility-matrix.md`

---

## Immediate next step

**Start Phase 2: account registry + storage hardening.**

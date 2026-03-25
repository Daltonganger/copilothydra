# CopilotHydra — Feasibility Notes

## Status

**Feasibility gate: GO**

Het project is uitvoerbaar binnen de afgesproken scope, **mits** we de bekende beperkingen expliciet meenemen in ontwerp, docs en runtime gedrag.

---

## Samenvatting

De verplichte feasibility spikes zijn afgerond:

1. ✅ Phase 0 repo scaffold
2. ✅ Spike A — auth/provider routing
3. ✅ Spike B — token chain
4. ✅ Spike C — model/provider registration
5. ✅ Spike E — storage/platform/TUI feasibility
6. ✅ Spike D — capability truth research

Kernconclusie:
- **multi-account GitHub Copilot binnen OpenCode is haalbaar**
- niet via één dynamische auth hook, maar via **meerdere statische plugin exports**
- met **provider IDs per account**
- met **config-geschreven provider entries**
- en met **warning-first / fail-closed** compatibiliteitsgedrag

---

## Spike A — auth/provider routing

### Vraag
Kan OpenCode meerdere Copilot-achtige providers tegelijk apart routeren?

### Bewezen
- `Hooks.auth` is **singular**: één auth hook per `Hooks` object.
- OpenCode laadt **alle named exports** uit een pluginmodule.
- `ProviderAuth` bouwt een **`Record<ProviderID, Hook>`**.
- Daardoor is multi-account haalbaar via **meerdere statische exports** (`CopilotHydraSlot0`–`CopilotHydraSlot7`).
- Elke export registreert precies één `auth.provider`.

### Conclusie
**Ja.** Auth-routing per provider werkt, zolang elke account een eigen provider ID heeft.

### Implicatie voor implementatie
- provider ID formaat: `github-copilot-acct-<stableId>`
- geen dynamische auth-array
- restart/reload-based lifecycle blijft acceptabel

---

## Spike B — token chain

### Vraag
Welke token is echt nodig voor Copilot requests?

### Bewezen
- GitHub device-flow OAuth token wordt door OpenCode’s Copilot integratie **direct gebruikt als Bearer token**.
- Er is in de huidige OpenCode-flow **geen extra Copilot token exchange vereist**.
- `callback()` geeft auth-data terug; **OpenCode slaat die zelf op via `Auth.set()`**.
- `auth.loader` moet een **custom `fetch`** leveren die per request auth injecteert.
- Copilot headers worden deels door onze loader gezet en deels door OpenCode’s `chat.headers` hook.

### Conclusie
**Ja.** De token chain is reproduceerbaar en voldoende begrepen.

### Implicatie voor implementatie
- gebruik GitHub OAuth token direct als Bearer token
- 401 behandelen als auth/token probleem
- fail closed bij ontbrekende of ongeldige auth state

---

## Spike C — model/provider registration

### Vraag
Hoe moeten provider entries en modellen exact geregistreerd worden?

### Bewezen
- OpenCode’s plugin `config` hook is **read-only** (`Promise<void>`).
- Providers moeten dus via **config-bestand / CLI mutatie** toegevoegd worden.
- SDK-resolutie gebeurt via **`model.api.npm`**, niet via provider ID.
- Een custom provider ID zoals `github-copilot-acct-<id>` kan dus dezelfde SDK-package gebruiken.
- `chat.headers` blijft werken omdat OpenCode controleert op `providerID.includes("github-copilot")`.

### Belangrijke beperking
OpenCode’s exacte `CUSTOM_LOADERS["github-copilot"]` routing (responses-vs-chat voor sommige modellen, zoals GPT-5+) is gekoppeld aan het exacte provider ID `github-copilot`.
Onze custom IDs krijgen die logica **niet automatisch**.

### Conclusie
**Ja, met beperking.** Provider-per-account registratie is haalbaar, maar custom Copilot provider IDs missen een stukje host-specifieke model-routing.

### Implicatie voor implementatie
- provider entries in config schrijven
- standaard starten met veilige/ondersteunde modelset
- GPT-5+/responses-routing als expliciet open risico behandelen

---

## Spike E — storage/platform/TUI feasibility

### Vraag
Zijn storage-, locking-, path- en TUI-aannames acceptabel?

### Bewezen
- OpenCode gebruikt:
  - config dir: `~/.config/opencode`
  - data dir: `~/.local/share/opencode`
- `auth.json` staat in de **data dir**.
- OpenCode ondersteunt overrides zoals:
  - `OPENCODE_CONFIG_DIR`
  - `OPENCODE_CONFIG`
  - `OPENCODE_TUI_CONFIG`
  - `OPENCODE_TEST_HOME`
- Browser/device auth is polling-based en browser-assisted.
- OpenCode heeft zelf **geen file-level locking** en **geen temp-file+rename JSON helper**.

### Projectbesluit
CopilotHydra bewaart eigen metadata/secrets in de **config dir** op basis van expliciet projectbeleid, ondanks OpenCode’s `auth.json` keuze voor de data dir.

### Conclusie
**Ja.** Onze strengere aanpak met lock-file + atomic temp-write is acceptabel en verdedigbaar.

### Implicatie voor implementatie
- config-dir resolution honoreren
- non-TTY clean failure behouden
- Windows best effort blijven documenteren

### Huidige implementatiestatus
- Phase 5 foundation gebruikt nu een dependency-free, line-based TUI-entrypoint
- non-TTY clean failure blijft expliciet aanwezig op het menu-pad
- rijkere raw-mode polish en volledige accountacties blijven vervolgwerk binnen Phase 5

---

## Spike D — capability truth

### Vraag
Kunnen we per account betrouwbaar automatisch bewijzen welke modellen/plannen beschikbaar zijn?

### Bewezen
- Er is **geen betrouwbare officiële API** om individuele Copilot plan/model entitlement direct vast te stellen.
- Org-level billing/copilot APIs bestaan, maar vereisen admin/billing permissies en zijn ongeschikt voor gewone runtime detectie.
- GitHub Models catalog toont **model existence**, niet account entitlement.
- Betrouwbare mismatchsignalen bestaan wel, vooral via **403-style runtime failures**.
- 401 moet doorgaans als auth/token-fout behandeld worden, niet als capability mismatch.

### Conclusie
**Nee, niet betrouwbaar genoeg voor verified capability truth in v1.**

### V1-beleid
- **user-declared plan**
- **runtime mismatch detection**
- geen poging om entitlement als autoritatieve waarheid te auto-proven

### Implicatie voor implementatie
- capability tables blijven compatibiliteitsmap, niet waarheid
- mismatch-state duidelijk opslaan en tonen
- restrictievere overwrite flow ondersteunen

---

## Feasibility gate

## Besluit
**GO** voor verdere implementatie.

## Waarom GO
De vier harde go-criteria uit de implementatiesequence zijn voldoende beantwoord:

- auth-routing per provider werkt ✅
- token flow is reproduceerbaar ✅
- modelregistratie is bruikbaar ✅
- storage/locking/TUI aanpak is acceptabel ✅

Daarnaast is de capability-vraag voldoende beantwoord voor een veilige v1-strategie:
- verified entitlement truth → **nee voor v1**
- user-declared + mismatch detection → **ja, acceptabel**

---

## Bekende risico’s / beperkingen

Deze drie punten moeten in alle volgende phases expliciet zichtbaar blijven:

- **Version detection / host-compatibiliteit is nog niet hard genoeg.** De huidige strategie is warning-first op onbekende versies; echte matrix + strengere checks moeten nog volgen.
- **GPT-5+/responses-routing voor custom provider IDs is nog niet opgelost.** Dit blijft een functionele beperking totdat we eigen routing toevoegen of de modelset bewust begrenzen.
- **Plaintext secret storage is alleen acceptabel voor huidige beta/feasibility-fase.** Dit mag niet stilzwijgend permanent worden.

### 1. OpenCode interne Copilot detectie is fragiel
We vertrouwen op ongedocumenteerde hostlogica zoals checks op `includes("github-copilot")`.

**Mitigatie:**
- startup compatibility checks
- warning-first gedrag op onbekende versies
- duidelijke failure messages
- compatibiliteitsmatrix bijhouden

### 2. Custom provider IDs missen exacte Copilot custom loader
Onze `github-copilot-acct-*` IDs krijgen niet vanzelf OpenCode’s `CUSTOM_LOADERS["github-copilot"]` pad.

**Risico:**
- GPT-5+/responses-routing kan afwijken

**Mitigatie:**
- starten met veilige modelset
- dit expliciet testen in Phase 1
- indien nodig eigen routinglaag toevoegen of modelset beperken

### 3. Capability truth blijft user-declared in v1
We kunnen entitlement niet betrouwbaar bewijzen.

**Mitigatie:**
- mismatch detectie
- expliciete UX rond plan state
- geen stilzwijgend optimistische model exposure

### 4. Windows blijft best effort
OpenCode zelf gebruikt XDG-gebaseerde paden universeel, ook op Windows.

**Mitigatie:**
- documenteer platform caveats expliciet
- houd locking/path code defensief

### 5. Geen officiële stabiele host-API garantie
Deze integratie blijft compatibiliteitsgevoelig.

**Mitigatie:**
- fail closed
- version warning strategy
- docs en matrix onderhouden

---

## Aanbevolen vervolg

### Direct volgende stap
**Early tests op de single-account reference path**

### Concreet
1. smoke tests op accounts/config sync toevoegen
2. unknown-version warning behavior testen
3. failure-paths rond config parsing en non-TTY CLI gedrag testen
4. daarna doorgaan met Phase 2 storage hardening

---

## Phase 1 status update

Phase 1 is afgerond op reference-path niveau:

- bootstrap CLI toegevoegd voor account-add/list/sync
- account metadata wordt opgeslagen in CopilotHydra storage
- OpenCode provider config wordt correct geschreven/gesynchroniseerd
- account-specifieke modellabels werken
- non-TTY guard werkt voor interactieve add-account flow
- smoke test bevestigde correcte output in `copilot-accounts.json` en `opencode.json`

Nog open buiten Phase 1:
- echte OpenCode runtime auth/login validatie in hostcontext
- GPT-5+/responses-routing gap verder beperken of oplossen
- test-suite automatiseren

---

## Beslisformulering

CopilotHydra is **haalbaar als best-effort, compatibility-sensitive OpenCode plugin** voor meerdere GitHub Copilot accounts.

Het project moet verdergaan met:
- fail-closed routing
- restart-based lifecycle
- user-declared capability policy
- expliciete documentatie van hostafhankelijkheden

Niet behandelen als stabiele hostgegarandeerde extensielaag, maar als een integratie met bekende grenzen.

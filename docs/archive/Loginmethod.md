# CopilotHydra Login Method

## Goal

Deze documentatie legt vast hoe CopilotHydra onder `opencode auth login` moet verschijnen, zodat account-toevoegen en re-auth niet alleen via de losse `copilothydra` TUI lopen.

## Waarom deze stap bestaat

CopilotHydra had al twee losse stukken:

1. **plugin auth hooks** voor bestaande account-providers (`github-copilot-acct-*`)
2. **eigen CLI/TUI** voor accountcreatie en beheer

Daardoor werkte auth voor bestaande accounts al binnen OpenCode, maar **het aanmaken van een account begon nog buiten OpenCode**.

Deze stap verplaatst dat eerste stuk naar de plugin auth-methode zelf.

## Referentiegedrag

Doelgedrag is vergelijkbaar met plugins zoals `opencode-antigravity-auth`:

- OpenCode roept plugin `auth.methods[].authorize(inputs)` aan vanuit `opencode auth login`
- de plugin mag op basis van `inputs` eerst account-keuze / account-creatie doen
- daarna start de plugin de echte OAuth/device-flow

Voor CopilotHydra betekent dat:

- `github-copilot` wordt gebruikt als **setup/login entrypoint**
- succesvolle login wordt teruggegeven met `provider: github-copilot-acct-<id>`
- bestaande per-account loaders blijven daarna de runtime requests afhandelen

## Huidige implementatie

### Nieuwe gedeelde module

`src/auth/login-method.ts`

Deze module bouwt gedeelde auth-methods voor OpenCode login:

- `createCopilotLoginMethods()`
- splitst de flow op in twee aparte OpenCode login-opties:
  - **re-auth existing account** met alleen `githubUsername`
  - **add new account** met `githubUsername`, `label`, `plan` en `allowUnverifiedModels`
- voorkomt daarmee dat OpenCode onterecht new-account prompts als verplicht behandelt tijdens re-auth

### Nieuwe flow

1. OpenCode toont twee CopilotHydra login-opties in auth login
2. gebruiker vult inputs in
3. CopilotHydra bepaalt:
   - **re-auth existing account** → bestaand account op username laden
   - **add new account** → metadata aanmaken + provider config syncen
4. CopilotHydra start GitHub device flow
5. callback retourneert success met:
   - `provider: account.providerId`
   - `accountId: account.id`
6. OpenCode kan die auth daarna onder de per-account provider opslaan

## Belangrijke ontwerpkeuzes

### 1. Geen nieuw unsupported auth-method type

We blijven binnen de bestaande plugin-shape:

- `type: "oauth"`
- `prompts?: Array<{ type: "text" ... }>`
- `authorize(inputs)`

Dus: **geen custom `type: "add-account"`** of andere host-onbewezen uitbreiding.

### 2. Setup-provider gebruikt `github-copilot`

De setup-hook exposeert:

- `provider: "github-copilot"`

Dat is de entrypoint die zo dicht mogelijk zit op wat de gebruiker verwacht in `opencode auth login`.

De echte runtime providers blijven:

- `github-copilot-acct-<stableId>`

### 3. Nieuwe accounts blijven restart/reload-sensitive

Voor **nieuwe** accounts wordt tijdens login wel direct metadata + `opencode.json` bijgewerkt, maar de nieuwe provider-hook is nog steeds afhankelijk van reload/startup om als slot-plugin geladen te worden.

Daarom meldt de login-instructie bij nieuwe accounts expliciet dat OpenCode daarna moet reloaden/herstarten.

Voor **re-auth van een bestaand account** is die extra restart-notitie niet nodig.

## Wat deze stap al oplost

- eerste account kan nu vanuit OpenCode auth login gestart worden
- extra account toevoegen kan nu via een aparte add-account login-optie, niet alleen via `copilothydra add-account`
- bestaande accounts kunnen via een aparte re-auth login-optie opnieuw auth doen
- de losse CopilotHydra CLI/TUI blijft beschikbaar als fallback-beheerpad

## Wat nog niet volledig af is

- echt bewijzen hoe OpenCode zich gedraagt als plugin-provider `github-copilot` naast/boven built-in `github-copilot` staat op alle hostversies
- de resterende menu-acties in Phase 5 (remove-account + mismatch review)
- hardening rond host-compatibiliteit, docs en release-risico’s

## Kernbestanddelen in code

- `src/index.ts`
  - `CopilotHydraSetup()` exposeert nu een auth hook in plaats van `{}`
- `src/auth/login-method.ts`
  - gedeelde login/add/re-auth orchestration
- `src/config/sync.ts`
  - schrijft per-account providers naar `opencode.json`
- `src/auth/device-flow.ts`
  - start en voltooit GitHub device flow
- `src/auth/loader.ts`
  - bestaande per-account runtime auth-loader blijft ongewijzigd de request-routing doen

## Praktische conclusie

CopilotHydra verschuift hiermee van:

- **"beheer eerst via eigen CLI, daarna pas OpenCode auth"**

naar:

- **"OpenCode auth login is nu ook een primaire ingang voor add-account en re-auth"**

Dat is dichter bij de bedoelde UX-richting: de gebruiker hoort dit onder OpenCode auth te kunnen starten.

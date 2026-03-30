# CopilotHydra Operator Storage Repair Runbook

> **Beta / hardening phase.** CopilotHydra is not yet stable software. This runbook reflects the current beta path. See `docs/release-checklist.md` for the current release gate.

This runbook covers the operator procedure for auditing and repairing CopilotHydra's on-disk storage: account data, provider entries, secrets, and config files.

Scope note: this runbook covers storage-repair procedures for personal-plan accounts. For the full support boundary definition, see [docs/support-boundaries.md](./support-boundaries.md). For the current release gate and hardening status, see [docs/release-checklist.md](./release-checklist.md).

## 1. Wanneer gebruik je audit vs repair?

CopilotHydra biedt twee storage-commando's met een verschillend risicoprofiel:

| Commando | Type | Wat het doet | Risico |
|---|---|---|---|
| `copilothydra audit-storage` | **Read-only** | Detecteert en rapporteert problemen | Geen — muteert niets |
| `copilothydra repair-storage` | **Mutating** | Lost gedetecteerde problemen op | Verwijdert stale data, pruunt secrets, normaliseert permissies |

**Regel:** voer **altijd eerst `audit-storage` uit** voordat je `repair-storage` gebruikt. De audit geeft je een overzicht van wat er mis is, zodat je een bewuste beslissing kunt nemen voordat er iets wordt gewijzigd.

Gebruik `repair-storage` niet "voor de zekerheid" zonder eerst te auditen. Sommige problemen die audit signaleert (zoals een ontbrekende secret) zijn niet door repair op te lossen en vereisen een andere actie.

## 2. Wat doet `audit-storage`?

`copilothydra audit-storage` is een read-only diagnostic. Het scant alle CopilotHydra-opslag op disk en rapporteert bevindingen zonder iets te wijzigen.

Het detecteert de volgende problemen:

### Ontbrekende provider-entries
Een account bestaat in de CopilotHydra-opslag maar heeft geen bijbehorende provider-entry in de OpenCode-configuratie. Dit betekent dat het account niet beschikbaar is in OpenCode, ondanks dat het wel is geregistreerd.

**Signaal in output:**
```
⚠️ missing provider entry for account "my-user" (pro)
```

### Stale provider-entries
Een provider-entry bestaat in de OpenCode-configuratie maar het bijbehorende CopilotHydra-account is verwijderd of bestaat niet meer. Dit is dode data die onnodig ruimte inneemt en verwarring kan veroorzaken.

**Signaal in output:**
```
⚠️ stale provider entry "copilothydra-my-user" — no matching account found
```

### Orphan secrets
Een secret (OAuth-token) bestaat in `copilot-secrets.json` maar er is geen CopilotHydra-account dat ernaar verwijst. Dit zijn overgebleven tokens van verwijderde accounts.

**Signaal in output:**
```
⚠️ orphan secret for key "my-removed-user" — no matching account
```

### Verkeerde bestandspermissies
CopilotHydra verwacht dat `copilot-secrets.json` permissies `0o600` heeft (alleen-leesbaar door de eigenaar). Als de permissies te ruim zijn (bijv. `0o644`), is dit een beveiligingsrisico.

**Signaal in output:**
```
⚠️ insecure permissions on copilot-secrets.json: 0o644 (expected 0o600)
```

### Model-catalog drift
De lijst van modellen die CopilotHydra kent is mogelijk niet meer actueel ten opzichte van wat de Copilot API daadwerkelijk aanbiedt. Dit is informatief en vereist meestal een CopilotHydra-update, geen repair.

**Signaal in output:**
```
ℹ️ model catalog drift detected: 2 models in local catalog not confirmed by recent API responses
```

### Corrupte bestanden
Als CopilotHydra bij het laden een JSON-bestand aantreft dat niet geparsed kan worden, wordt het automatisch gequarantineerd (zie sectie 5). De audit rapporteert of er quarantaine-bestanden aanwezig zijn.

**Signaal in output:**
```
⚠️ quarantined corrupt file: accounts.json.corrupt-20260330T142201Z
```

## 3. Wat doet `repair-storage`?

`copilothydra repair-storage` muteert de on-disk opslag. Het lost een deel van de door audit gedetecteerde problemen op.

### Wat repair WEL doet

| Actie | Wat er gebeurt | Risico |
|---|---|---|
| **Prune orphan secrets** | Verwijdert secrets uit `copilot-secrets.json` waaraan geen account meer is gekoppeld | Laag — de tokens zijn al niet meer in gebruik |
| **Verwijder stale provider entries** | Verwijdert provider-entries uit de OpenCode-configuratie die niet meer aan een CopilotHydra-account zijn gekoppeld | Laag — het zijn dode entries. Maar: vereist een sync + reload achteraf |
| **Normaliseer bestandspermissies** | Zet de permissies van `copilot-secrets.json` (en andere gevoelige bestanden) terug naar `0o600` | Laag — beveiligingsverbetering |
| **Rapporteer onoplosbare problemen** | Signaleert problemen die niet automatisch opgelost kunnen worden (zie hieronder) | Geen — informatief |

### Wat repair NIET doet

| Wat het NIET doet | Waarom |
|---|---|
| **Ontbrekende secrets aanmaken** | Als een account's OAuth-token ontbreekt, kan repair dit niet herstellen. De token is weg en moet via re-auth opnieuw worden verkregen: `opencode auth login -p github-copilot` → *Re-auth existing account* |
| **Accounts aanmaken of verwijderen** | Repair beheert geen account-levenscyclus. Gebruik de normale auth-flow voor add/remove. |
| **Plan-tiers wijzigen** | Gebruik `review-mismatch` voor plan-wijzigingen, niet repair. |
| **Corrupte bestanden herstellen** | Repair probeert niet de inhoud van een corrupt bestand te reconstrueren. Het quarantaine-proces is al bij het laden gebeurd (zie sectie 5). Repair ruimt eventueel quarantaine-bestanden op als daarom gevraagd wordt, maar herstelt de originele data niet. |
| **OpenCode-config direct activeren** | Na repair is een `sync-config` + reload nodig (zie sectie 4). |

## 4. Stappenplan: eerst audit, dan repair, dan sync + reload

Volg deze stappen in de aangegeven volgorde:

### Stap 1: Audit uitvoeren

```
copilothydra audit-storage
```

Lees de output aandachtig. Noteer:

- Hoeveel en welke typen problemen er zijn
- Of er **ontbrekende secrets** zijn (deze kunnen niet door repair worden opgelost)
- Of er **corrupte bestanden** in quarantaine staan (zie sectie 5)

### Stap 2: Beslissen of repair nodig is

- Als de audit alleen **orphan secrets**, **stale provider entries**, of **permissie-problemen** rapporteert: ga door naar stap 3.
- Als de audit **ontbrekende secrets** rapporteert: repair lost dit niet op. Voer eerst re-auth uit via `opencode auth login -p github-copilot` → *Re-auth existing account*. Voer daarna audit opnieuw uit.
- Als de audit **corrupte bestanden** rapporteert: zie sectie 5 voor de herstel-flow.

### Stap 3: Repair uitvoeren

```
copilothydra repair-storage
```

Repair toont een samenvatting van de uitgevoerde acties:

```
Repair summary:
  ✓ pruned 2 orphan secrets
  ✓ removed 1 stale provider entry
  ✓ normalized permissions on copilot-secrets.json (0o644 → 0o600)
  ⚠ 1 issue requires manual action: missing secret for account "broken-user"
```

### Stap 4: Configuratie synchroniseren

Na repair moet de OpenCode-configuratie opnieuw worden gegenereerd:

```
copilothydra sync-config
```

Dit zorgt dat de bijgewerkte opslag (minder entries, schonere config) wordt doorgevoerd in de OpenCode-provider-configuratie.

### Stap 5: OpenCode herladen

- **Herladen** (aanbevolen): gebruik de reload-functie van je editor/host.
- **Herstarten** (als herladen niet mogelijk is): sluit en open OpenCode opnieuw.

### Stap 6: Verifiëren

```
copilothydra audit-storage
```

Voer audit opnieuw uit om te bevestigen dat de problemen zijn opgelost. De verwachte output is een schone audit zonder waarschuwingen (of alleen nog de problemen die handmatige actie vereisen).

```
copilothydra list-accounts
```

Bevestig dat alle verwachte accounts aanwezig zijn en de juiste status tonen.

## 5. Corrupt bestand herstellen (quarantine-flow)

Wanneer CopilotHydra bij het opstarten of laden een JSON-bestand niet kan parsen (bijv. leeg bestand, afgebroken JSON, disk-corruptie), past het de volgende quarantine-flow toe:

1. **Automatisch bij laden:** Het oorspronkelijke bestand wordt hernoemd naar `<filename>.corrupt-<timestamp>`. Bijvoorbeeld: `accounts.json` wordt `accounts.json.corrupt-20260330T142201Z`.
2. **Fallback:** CopilotHydra start met een lege of minimale versie van het bestand. Accounts die in het corrupte bestand stonden zijn tijdelijk niet beschikbaar.
3. **Audit rapporteert de quarantaine:** `audit-storage` toont de aanwezigheid van het `.corrupt-*` bestand.

### Handmatig herstel

Omdat repair de originele data niet kan reconstrueren, is handmatig herstel nodig:

1. **Inspecteer het quarantaine-bestand:**
   ```
   cat accounts.json.corrupt-20260330T142201Z
   ```

2. **Probeer de JSON handmatig te herstellen:**
   - Als de corruptie klein is (afgebroken schrijf-operatie), kun je de JSON mogelijk handmatig repareren.
   - Sla het herstelde bestand op als het originele bestand (bijv. `accounts.json`).

3. **Als herstel niet mogelijk is:**
   - De accounts in het corrupte bestand zijn verloren.
   - Voeg de accounts opnieuw toe via `opencode auth login -p github-copilot` → *Add new account*.
   - Verwijder het `.corrupt-*` bestand nadat je het hebt geïnspecteerd en de situatie hebt geaccepteerd.

4. **Na herstel:** voer `copilothydra sync-config` uit en herlaad OpenCode.

**Preventie:** CopilotHydra gebruikt een atomic-write patroon (schrijf naar `.tmp`, dan `rename`) om corruptie door crashes te minimaliseren. Quarantaine is een vangnet voor het onwaarschijnlijke geval dat het atomic-write patroon toch faalt (bijv. filesystem-full op het moment van rename).

## 6. Wat repair NIET oplost

De volgende problemen worden door `repair-storage` niet opgelost en vereisen een andere actie:

| Probleem | Waarom niet | Oplossing |
|---|---|---|
| **Ontbrekende secret (missing OAuth token)** | De token bestaat niet meer op disk en kan niet worden gereconstrueerd | Re-auth het account via `opencode auth login -p github-copilot` → *Re-auth existing account* |
| **Verkeerd plan-tier** | Repair beheert geen account-plannen | Gebruik `copilothydra review-mismatch <account-id>` |
| **Model-catalog drift** | Dit vereist een CopilotHydra-update, geen storage-repair | Update CopilotHydra naar de laatste versie |
| **Corrupt bestand inhoud herstellen** | Repair kan data niet reconstrueren | Zie sectie 5: handmatig herstel of accounts opnieuw toevoegen |
| **OpenCode host-problemen** | CopilotHydra beheert de OpenCode-host niet | Zie `docs/operator-auth-recovery-runbook.md` voor host-herstel |

## 7. Scope note

Dit runbook dekt de storage-audit en -repair procedures voor CopilotHydra. Voor de actuele release-status en hardening-gates, zie [docs/release-checklist.md](./release-checklist.md).

Gerelateerde documentatie:

- [docs/operator-auth-recovery-runbook.md](./operator-auth-recovery-runbook.md) — algemeen auth-herstel
- [docs/operator-mismatch-review-runbook.md](./operator-mismatch-review-runbook.md) — mismatch-review procedures
- [docs/support-boundaries.md](./support-boundaries.md) — ondersteuningsgrenzen
- [docs/compatibility-matrix.md](./compatibility-matrix.md) — actuele model- en versieondersteuning

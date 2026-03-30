# CopilotHydra Operator Mismatch Review Runbook

> **Beta / hardening phase.** CopilotHydra is not yet stable software. This runbook reflects the current beta path. See `docs/release-checklist.md` for the current release gate.

This runbook covers the operator procedure for detecting, reviewing, and resolving capability mismatches reported by CopilotHydra at runtime.

Scope note: this runbook covers personal-plan accounts only (`free`, `student`, `pro`, `pro+`). Enterprise-managed GitHub.com and GitHub Enterprise Server (GHES) are out of scope. See [docs/support-boundaries.md](./support-boundaries.md) for the full boundary definition.

## 1. Wat betekent een mismatch?

CopilotHydra werkt met een *user-declared plan*: bij het toevoegen van een account kies je welke plan-tier je hebt (`free`, `student`, `pro`, `pro+`). Op basis daarvan bepaalt CopilotHydra welke modellen beschikbaar zijn voor dat account.

Tijdens het gebruik kan CopilotHydra erachter komen dat de gekozen plan-tiek niet klopt met wat de Copilot API daadwerkelijk toestaat. Dit gebeurt wanneer een API-request een van de volgende fouten retourneert:

- **403 (entitlement rejected):** het account probeert een model te gebruiken dat niet in het werkelijke plan zit. Bijvoorbeeld: het account is gedeclareerd als `pro` maar de API weigert `gpt-4.5` omdat het werkelijke plan `student` is.
- **400 (unsupported model):** het account probeert een model aan te roepen dat de Copilot API helemaal niet herkent of niet ondersteunt in de huidige context.

Wanneer CopilotHydra zo'n fout detecteert, wordt het account gemarkeerd met `capabilityState: "mismatch"` en wordt een `mismatchDetail` opgeslagen met de specifieke fout-informatie (welk model, welke HTTP-status, welk bericht).

**In gewone taal:** een mismatch betekent "CopilotHydra dacht dat dit account model X kon gebruiken, maar de API zegt van niet". Het account blijft bestaan en andere modellen blijven beschikbaar, maar het probleem-model wordt geblokkeerd totdat de operator het oplost.

## 2. Hoe herken je een mismatch?

Er zijn twee primaire signalen:

### `copilothydra list-accounts` output

Wanneer een account een mismatch heeft, toont `list-accounts` het volgende:

```
Account: my-github-user (pro)
  capabilityState: mismatch
  mismatchDetail:
    model: gpt-4.5
    httpStatus: 403
    message: entitlement rejected
    detectedAt: 2026-03-30T14:22:01Z
    suggestedPlan: student
```

Het `capabilityState` veld is normaal `declared`. Een waarde van `mismatch` betekent dat er een onopgelost probleem is.

### Log-output tijdens gebruik

Als een mismatch optreedt tijdens een actieve sessie, logt CopilotHydra een waarschuwing:

```
[hydra:capability] mismatch detected for account "my-github-user"
  model "gpt-4.5" returned 403 (entitlement rejected)
  account capabilityState set to "mismatch"
  run: copilothydra review-mismatch my-github-user
```

Als je deze log-regels ziet, is het tijd om de review-flow uit te voeren.

## 3. Primaire flow: review-mismatch uitvoeren

Het commando voor het oplossen van een mismatch is:

```
copilothydra review-mismatch <account-id|provider-id>
```

Dit commando kent twee modi: **interactief** en **batch**.

### 3a. Interactief pad (TTY)

Wanneer je het commando in een terminal uitvoert met TTY-ondersteuning:

1. CopilotHydra toont de mismatch-details: welk model, welke HTTP-status, welk bericht, wanneer gedetecteerd.
2. Als er een **automatische downgrade-suggestie** beschikbaar is, wordt deze getoond:

   ```
   Detected mismatch for account "my-github-user":
     model: gpt-4.5
     httpStatus: 403
     message: entitlement rejected
     suggested downgrade: pro → student

   Apply this change? (y/n):
   ```

3. Kies `y` om de suggestie toe te passen. Het account wordt bijgewerkt naar het voorgestelde plan.
4. Kies `n` om de mismatch te laten staan. Dit is nuttig als je denkt dat de fout tijdelijk is (zie sectie 6).

### 3b. Batch pad (`--apply-suggested`)

Voor scripting of CI-omgevingen zonder TTY:

```
copilothydra review-mismatch <account-id|provider-id> --apply-suggested
```

Dit gedraagt zich als volgt:

- Als er een automatische suggestie beschikbaar is: **wordt direct toegepast** zonder bevestiging.
- Als er **geen** automatische suggestie beschikbaar is: **geen actie**, het commando sluit af met een melding dat handmatige interventie nodig is. Gebruik in dat geval de interactieve modus of pas het account handmatig aan.

Let op: `--apply-suggested` is veilig in de zin dat het alleen een suggestie toepast als CopilotHydra er een heeft. Als er geen suggestie is, muteert het niets.

## 4. Wanneer is er geen automatische suggestie?

CopilotHydra kan niet altijd een downgrade-suggestie geven. De volgende situaties leveren geen suggestie op:

### Onbekend model

Als de API een `400 (unsupported model)` retourneert voor een modelnaam die CopilotHydra niet kent, kan het systeem niet bepalen welk plan al dan niet toegang geeft. Het model staat niet in de interne model-catalogus.

**Oplossing:** controleer of de modelnaam correct is. Het kan gaan om een typefout, een verouderde modelnaam, of een model dat nog niet in de CopilotHydra-catalogus is opgenomen. Controleer `docs/compatibility-matrix.md` voor de actuele lijst van bekende modellen.

### Enterprise-only model

Sommige modellen zijn alleen beschikbaar via enterprise Copilot-abonnementen, niet via persoonlijke plannen. Als een `pro+` account een 403 krijgt voor zo'n model, is er geen lagere personal-plan tier die het probleem oplost.

**Oplossing:** dit is geen plan-downgrade probleem. Het account blijft op `pro+` staan, maar het specifieke model is simpelweg niet beschikbaar voor persoonlijke accounts. Pas indien nodig de model-selectie aan in je OpenCode-configuratie.

### API-fout die niet op plan-niveau te classificeren is

In zeldzame gevallen kan de API een 403 retourneren om een reden die niets met het plan te maken heeft (bijv. regionaal niet beschikbaar, tijdelijke rate-limit, organisatie-restrictie). In die gevallen genereert CopilotHydra geen suggestie omdat een downgrade het probleem niet zou oplossen.

## 5. Na een apply: sync + reload instructies

Wanneer een mismatch-suggestie is toegepast (interactief of via `--apply-suggested`), is de account bijgewerkt in de CopilotHydra-opslag. De wijziging is echter **nog niet actief** in OpenCode.

Voer deze stappen uit:

1. **Sync de configuratie:**
   ```
   copilothydra sync-config
   ```

2. **Herlaad of herstart OpenCode:**
   - OpenCode herladen (aanbevolen): gebruik de reload-functie van je editor/host.
   - OpenCode herstarten (als herladen niet mogelijk is): sluit en open OpenCode opnieuw.

3. **Verifieer de wijziging:**
   ```
   copilothydra list-accounts
   ```
   Bevestig dat:
   - `capabilityState` nu `declared` is (niet meer `mismatch`)
   - Het account-plan overeenkomt met de toegepaste wijziging
   - De verwachte modellen beschikbaar zijn

## 6. Wanneer is een mismatch geen echte downgrade nodig?

Niet elke mismatch betekent dat het account-plan verkeerd is. Overweeg de volgende situaties voordat je een downgrade toepast:

### Tijdelijke API-fout

De Copilot API kan incidenteel een 403 retourneren door een tijdelijk probleem aan de kant van GitHub (rate-limit, interne fout, CDN-probleem). Dit kan een valse mismatch triggeren.

**Signalen:**
- De mismatch is zeer recent (binnen enkele minuten)
- Andere modellen van hetzelfde account werken prima
- De API-statuspagina van GitHub meldt een incident

**Actie:** pas geen downgrade toe. Wacht enige tijd en test of het model weer werkt. Als de mismatch blijft, voer dan de review-flow uit. Je kunt de mismatch-timestamp controleren in de `list-accounts` output onder `detectedAt`.

### Organisatie-restrictie

Als je GitHub-account deel uitmaakt van een organisatie die Copilot-toegang beperkt (bijv. alleen bepaalde modellen toestaat), kan een 403 optreden ondanks dat je plan het model wel zou moeten ondersteunen.

**Signalen:**
- Je hebt een `pro` of `pro+` plan maar krijgt 403 voor een model dat in je plan zou moeten zitten
- De mismatch ontstond nadat je lid werd van een nieuwe organisatie

**Actie:** controleer de organisatie-Copilot-policy. Dit is geen CopilotHydra-probleem en een downgrade lost het niet op. Los het op via de GitHub-organisatie-instellingen.

### Model tijdelijk uit de catalogus verwijderd

GitHub kan modellen tijdelijk uitschakelen of vervangen. Als een model dat vroeger werkte plotseling een 403 geeft, kan dit komen door een wijziging aan de kant van GitHub.

**Actie:** controleer `docs/compatibility-matrix.md` of het model nog in de ondersteunde lijst staat. Als het model is verwijderd, is dit geen plan-probleem.

## 7. Scope note

Dit runbook dekt de mismatch-review flow voor persoonlijke Copilot-plannen (`free`, `student`, `pro`, `pro+`). Voor de volledige ondersteuningsgrenzen, inclusief wat wel en niet binnen scope valt, zie [docs/support-boundaries.md](./support-boundaries.md).

Gerelateerde documentatie:

- [docs/operator-auth-recovery-runbook.md](./operator-auth-recovery-runbook.md) — algemeen auth-herstel
- [docs/operator-storage-repair-runbook.md](./operator-storage-repair-runbook.md) — storage-repair procedures
- [docs/compatibility-matrix.md](./compatibility-matrix.md) — actuele model- en versieondersteuning

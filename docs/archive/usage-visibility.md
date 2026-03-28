# CopilotHydra Usage Visibility Contract

This document defines what CopilotHydra may and may not claim for per-account GitHub Copilot usage visibility.

## Goal

The purpose of usage visibility is operator awareness only:

- help operators see which account may be approaching quota pressure
- support explicit manual routing decisions
- avoid hidden fallback or automatic account switching

## What CopilotHydra must not claim yet

- authoritative per-account quota percentage
- authoritative remaining premium requests
- authoritative per-plan billing truth
- browser-cookie-derived billing results as if they were tied to a specific Hydra-managed account

Until those semantics are proven, usage percentage must be treated as **unknown**, not inferred.

## Trust levels for possible data sources

### 1. Browser-cookie billing scraping

Status: **unsupported for CopilotHydra usage percentage truth**

Why:

- tied to a browser profile session, not cleanly to one Hydra-managed account
- platform-specific and operationally fragile
- can easily imply the wrong account in a multi-account setup

CopilotHydra should not use browser cookies as the source of truth for per-account usage percentages.

### 2. Token-bound GitHub account snapshot endpoints

Status: **best-effort signal only**

Token-bound GitHub endpoints may be queried with the same GitHub OAuth token already associated with a Hydra-managed account.

These signals may be useful for:

- account-scoped plan metadata
- reset dates
- lightweight account-scoped status snapshots

They are **not yet sufficient** to claim a trustworthy usage percentage unless the returned fields and semantics are validated first.

### 3. Local request counters inside CopilotHydra

Status: **local activity signal only**

CopilotHydra can count its own routed requests, but that only proves local CopilotHydra activity, not GitHub Copilot quota truth.

Local counters may be useful later as supplementary telemetry, but they must not be presented as GitHub quota percentage.

## Safe first implementation rule

If CopilotHydra exposes usage visibility before quota semantics are proven, it must:

- label the data source clearly
- include a timestamp or snapshot origin where appropriate
- present unknown values as `unknown`, not guessed percentages
- keep the feature read-only and operator-facing
- avoid any routing behavior change based on the signal

## Deferred until semantics are proven

- percentage badges in the main account list
- quota-driven warnings that imply authoritative truth
- automatic switching or fallback based on usage
- persisted usage percentages in account metadata
- browser-cookie-based billing scraping

## Current recommended direction

The safest next engineering step is to validate whether a token-bound GitHub endpoint exposes enough account-scoped quota information to support a real percentage. Until then, CopilotHydra should document the boundary and avoid overclaiming usage truth.

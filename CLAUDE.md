<!-- GSD:project-start source:PROJECT.md -->
## Project

**CopilotHydra: GitHub Copilot Host Hardening**

CopilotHydra is a brownfield OpenCode plugin project that extends GitHub Copilot usage from a single built-in account model to a multi-account model. This initiative is not a greenfield feature build; it is the hardening phase that makes `github-copilot` login/auth takeover via `opencode auth login` dependable enough for real OpenCode use while preserving simultaneous Copilot accounts, per-account model selection, and explicit manual routing.

**Core Value:** A user can use multiple GitHub Copilot accounts side by side inside OpenCode, select models per account explicitly, and trust that auth/login and runtime routing stay clear and correct.

### Constraints

- **Host compatibility**: OpenCode internals around `github-copilot` are compatibility-sensitive and partially undocumented — hardening must be defensive
- **Entrypoint**: Primary user flow must start from `opencode auth login` — standalone TUI/CLI remains fallback/admin tooling
- **Routing model**: Routing must stay manual and explicit per account/model — no hidden fallback or auto-selection
- **Capability truth**: Entitlement cannot be authoritatively proven at runtime — product must use hybrid user-declared + mismatch-aware behavior
- **Lifecycle**: Restart/reload after account/config changes is acceptable — architecture does not need hot dynamic reload
- **Provider scope**: Work is Copilot-only — no non-Copilot provider expansion in this initiative
- **Platform scope**: macOS/Linux first, Windows best effort — current docs already bound platform expectations this way
- **Architecture**: Sidecar/broker fallback and broad rewrites are out of scope — hardening must build on the existing plugin/storage/routing design
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.x - all source code lives under `src/**/*.ts`; package metadata is in `package.json` and compiler settings are in `tsconfig.json`.
- JavaScript (Node test files) - compiled/runtime tests live under `tests/*.test.js` and execute against `dist/**/*.js` via the `npm test` script in `package.json`.
- Markdown - operator and project docs live in `README.md` and `docs/*.md`.
- JSON / JSONC - runtime and generated config handling is implemented for `opencode.json` / `opencode.jsonc` in `src/config/opencode-config.ts`.
## Runtime
- Node.js >=18 - enforced by `package.json` `engines.node`; the code also depends on built-in `fetch`, ESM, and `node:test` behavior.
- ESM / NodeNext modules - configured in `tsconfig.json` with `module: "NodeNext"` and `moduleResolution: "NodeNext"`.
- npm - lockfile is `package-lock.json`.
- Lockfile: present (`package-lock.json`, lockfileVersion 3).
## Frameworks
- OpenCode plugin runtime - the plugin entrypoint is `src/index.ts`; the optional peer dependency contract is declared in `package.json` as `@opencode-ai/plugin`.
- Node.js standard library only for implementation code - filesystem, path, crypto, and readline usage appears in `src/storage/accounts.ts`, `src/storage/secrets.ts`, `src/account.ts`, `src/cli.ts`, and `src/ui/select.ts`.
- Node built-in test runner - `package.json` runs `node --test tests/**/*.test.js` after building.
- `node:assert/strict` and ad-hoc helpers are used from the compiled JS tests under `tests/`.
- TypeScript compiler (`tsc`) - build, watch, and typecheck scripts are defined in `package.json`; emitted artifacts go to `dist/` per `tsconfig.json`.
- No bundler detected - output is direct TypeScript compilation to `dist/`.
- Lint script exists (`eslint src --ext .ts` in `package.json`), but no ESLint config file or eslint dependency is detected in the repository root.
## Key Dependencies
- `typescript` 5.9.3 resolved in `package-lock.json` - compiles all plugin, CLI, config, storage, and auth code from `src/` to `dist/`.
- `@types/node` 22.19.15 resolved in `package-lock.json` - provides Node typings for `node:fs/promises`, `node:path`, `node:crypto`, `node:process`, and `node:readline/promises` imports used across `src/`.
- `@opencode-ai/plugin` (optional peer dependency in `package.json`) - the code mirrors its runtime hook shapes in `src/types.ts` and integrates with OpenCode through `src/index.ts`.
- `@ai-sdk/openai-compatible` - referenced as the provider npm package written into OpenCode config by `src/config/providers.ts`; it is not installed here because the package expects OpenCode to provide/bundle it at runtime.
- Native `fetch` - used for GitHub and Copilot HTTP calls in `src/auth/device-flow.ts` and `src/auth/loader.ts`.
## Configuration
- OpenCode path resolution uses `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `XDG_CONFIG_HOME`, `OPENCODE_TEST_HOME`, `HOME`, and `USERPROFILE` in `src/config/opencode-config.ts` and `src/storage/accounts.ts`.
- Runtime/debug flags are centralized in `src/flags.ts`: `COPILOTHYDRA_DEBUG`, `COPILOTHYDRA_DEBUG_AUTH`, `COPILOTHYDRA_DEBUG_ROUTING`, `COPILOTHYDRA_DEBUG_STORAGE`, `COPILOTHYDRA_SKIP_VERSION_CHECK`, and `COPILOTHYDRA_UNSAFE_PLAINTEXT_CONFIRM`.
- No `.env` files are detected in the repository root; runtime configuration is environment-variable driven rather than checked-in dotenv files.
- Compiler config: `tsconfig.json`.
- Package manifest and scripts: `package.json`.
- Lockfile: `package-lock.json`.
- Plugin/runtime behavior reference docs: `README.md`, `docs/PLAN.md`, `docs/IMPLEMENTATION_SEQUENCE.md`, and `docs/Loginmethod.md`.
## Platform Requirements
- Install dependencies with npm as described in `README.md` and `package.json`.
- Build before testing because tests run compiled output from `dist/` (`package.json` and `tests/*.test.js`).
- Development assumes an OpenCode-compatible host runtime because plugin hooks and provider config synchronization target OpenCode files from `src/index.ts` and `src/config/sync.ts`.
- Deployment target is an OpenCode plugin package/CLI consumed by a local OpenCode installation; runtime provider entries are written to the user OpenCode config via `src/config/opencode-config.ts` and `src/config/sync.ts`.
- Persistent local state is stored in the OpenCode config directory as `copilot-accounts.json`, `copilot-secrets.json`, and `opencode.json` / `opencode.jsonc` via `src/storage/accounts.ts`, `src/storage/secrets.ts`, and `src/config/opencode-config.ts`.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- Use kebab-case for source and test files, with domain grouping by directory. Examples: `src/account-update.ts`, `src/auth/login-method.ts`, `src/storage/provider-account-map.ts` is not used; the actual routing file is `src/routing/provider-account-map.ts`, and tests mirror behavior names like `tests/account-update.test.js` and `tests/auth-loader-routing.test.js`.
- Keep one primary concern per file. Storage helpers live under `src/storage/*.ts`, config helpers under `src/config/*.ts`, auth helpers under `src/auth/*.ts`, and UI prompt code under `src/ui/*.ts`.
- Use camelCase for functions, including exported APIs such as `createAccountMeta` in `src/account.ts`, `updateAccountPlan` in `src/account-update.ts`, `buildAuthLoader` in `src/auth/loader.ts`, and `renderAccountManagerScreen` in `src/ui/menu.ts`.
- Use verb-first names for operations (`loadAccounts`, `saveAccounts`, `syncAccountsToOpenCodeConfig`, `beginAccountRemoval`) and `build*` / `create*` prefixes for factory helpers (`buildAuthResult`, `buildPlanOptions`, `createCopilotLoginMethods`).
- Internal helpers remain unexported and narrowly named, such as `requireTextInput` in `src/auth/login-method.ts`, `sleep` in `src/storage/locking.ts`, and `buildTuiMismatchMessage` in `src/ui/menu.ts`.
- Use descriptive camelCase locals such as `allowUnverifiedModels`, `existingForUsername`, `restartRequired`, and `mismatchAccounts` in `src/cli.ts` and `src/ui/menu.ts`.
- Use leading underscore only for exceptional module-level state or intentionally unused names. Examples: `_accounts`, `_loadError`, and `_accountPlugins` in `src/index.ts`, and caught error names like `err_` or `_inputs` in `src/index.ts`.
- Use uppercase snake case for constant tables and flags such as `VALID_PLANS` in `src/cli.ts` and `src/auth/login-method.ts`, plus `DEBUG_AUTH` and `UNSAFE_PLAINTEXT_CONFIRMED` in `src/flags.ts`.
- Use PascalCase for interfaces and type aliases, such as `CopilotAccountMeta`, `AccountsFile`, `AuthLoader` in `src/types.ts`, `LoginMethodDependencies` in `src/auth/login-method.ts`, and `MenuDependencies` in `src/ui/menu.ts`.
- Prefer literal unions for constrained state instead of enums. Examples: `PlanTier`, `CapabilityState`, and `AccountLifecycleState` in `src/types.ts`.
## Code Style
- Formatter config files are not detected. `.prettierrc*`, `biome.json`, and `eslint.config.*` are absent at repository root.
- Source formatting is still consistent: 2-space indentation, semicolons, double quotes, trailing commas in multiline objects/calls, and `.js` import suffixes in TypeScript ESM files. See `src/cli.ts`, `src/storage/accounts.ts`, and `src/ui/menu.ts`.
- Long unions and object literals are wrapped across lines instead of compressed. Examples appear in `src/ui/menu.ts` lines 26-66 and `src/types.ts`.
- A lint script exists in `package.json` (`eslint src --ext .ts`), but no ESLint config file is present and `eslint` is not declared in `package.json`.
- TypeScript strictness is the strongest enforced style signal. `tsconfig.json` enables `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitReturns`, and `noFallthroughCasesInSwitch`.
## Import Organization
- Tests follow the same pattern: built-ins first, then local helpers from `tests/helpers.js`, e.g. `tests/storage-recovery.test.js` and `tests/account-removal.test.js`.
- Path aliases are not used. All imports are relative and include explicit `.js` extensions, for example `./storage/accounts.js` in `src/cli.ts` and `../config/sync.js` in `src/auth/login-method.ts`.
## Error Handling
- Throw `Error` with user-facing, prefixed messages for invalid input and impossible state. Examples: `src/cli.ts`, `src/account-update.ts`, `src/storage/accounts.ts`, and `src/auth/login-method.ts` use the `[copilothydra]` prefix consistently.
- Validate early and fail fast with small helper functions. Examples: `requireString` / `requireIsoTimestamp` in `src/storage/validation.ts`, `parsePlanTier` in `src/auth/login-method.ts`, and TTY/account guards in `src/cli.ts` and `src/ui/menu.ts`.
- Use `try`/`finally` around resources that must always close or release, such as readline interfaces in `src/cli.ts` and `src/ui/select.ts`, and file locks in `src/storage/locking.ts`.
- Catch only when converting errors into logs, quarantine behavior, or failed auth results. Examples: corruption handling in `src/storage/accounts.ts`, device-flow failure handling in `src/index.ts` and `src/auth/login-method.ts`, and module-init logging in `src/index.ts`.
## Logging
- Use `info`, `warn`, and `error` from `src/log.ts` instead of direct `console.*`; no `console.` calls are present under `src/`.
- Pass a scope string first (`"plugin"`, `"auth"`, `"storage"`, `"routing"`) and a human-readable message second. Examples: `src/index.ts`, `src/auth/device-flow.ts`, and `src/storage/accounts.ts`.
- Send logs to stderr so stdout stays reserved for CLI/TUI output and host protocols. This is enforced in `src/log.ts`.
- Keep secrets out of logs. The rule is stated in `src/log.ts` and repeated in `src/flags.ts` comments.
## Comments
- Use file-header block comments to explain module purpose, constraints, and phase assumptions. Examples: `src/index.ts`, `src/storage/accounts.ts`, `src/storage/locking.ts`, `src/ui/menu.ts`, and `src/log.ts`.
- Use section dividers (`// ---------------------------------------------------------------------------`) to break large modules into navigable regions, especially in `src/index.ts`, `src/storage/accounts.ts`, and `src/storage/locking.ts`.
- Inline comments document non-obvious design choices, such as atomic write strategy in `src/storage/accounts.ts` and static export slot limitations in `src/index.ts`.
- Use targeted doc comments on exported APIs or tricky internal contracts, not on every function. Examples: `buildAuthLoader` in `src/auth/loader.ts`, `resolveConfigDir` in `src/storage/accounts.ts`, and `acquireLock` / `withLock` in `src/storage/locking.ts`.
## Function Design
- Keep most exported functions focused and single-purpose. Examples: `createAccountMeta` in `src/account.ts`, validation helpers in `src/storage/validation.ts`, and token helpers in `src/auth/token-state.ts`.
- Allow orchestrator-style entry points to be larger when they coordinate many flows. `main` in `src/cli.ts`, `launchMenu` in `src/ui/menu.ts`, and the plugin bootstrap in `src/index.ts` are the main exceptions.
- Prefer typed object parameters for optional settings and dependency injection. Examples: `UpdateOptions` in `src/account-update.ts`, override objects in `createCopilotLoginMethods` in `src/auth/login-method.ts`, and `launchMenu(overrides)` in `src/ui/menu.ts`.
- Use primitive positional arguments only for small, stable APIs such as `renameAccount(accountId, label)` in `src/account-update.ts` and `selectOne(prompt, options)` in `src/ui/select.ts`.
- Return typed domain objects or small result objects rather than booleans when more context is useful. Examples: `beginAccountRemoval` in `src/account-removal.ts`, `auditStorage` in `src/storage-audit.ts`, and `repairStorage` in `src/storage-repair.ts`.
- Use `null` or `undefined` intentionally for cancelled selections and optional lookups, as seen in `src/ui/select.ts` and `src/storage/accounts.ts`.
## Module Design
- Prefer named exports only. Files such as `src/account.ts`, `src/log.ts`, `src/storage/accounts.ts`, and `src/ui/menu.ts` expose explicit named APIs; default exports are not used.
- Co-locate dependencies behind overridable defaults when testability matters. `src/ui/menu.ts` and `src/auth/login-method.ts` define `DEFAULT_DEPS` objects and merge `Partial<...>` overrides.
- Barrel files are not used. Import modules from their concrete paths such as `src/config/sync.ts`, `src/auth/login-method.ts`, and `src/storage/secrets.ts`.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- `src/index.ts` is the plugin runtime entrypoint and builds OpenCode auth hooks from persisted account metadata.
- `src/cli.ts` and `src/ui/menu.ts` are separate operator entrypoints that mutate storage/config, then rely on OpenCode restart to reload plugin state.
- `src/storage/*.ts`, `src/config/*.ts`, `src/auth/*.ts`, and `src/routing/*.ts` separate persistence, generated provider config, auth exchange, and in-memory request routing.
## Layers
- Purpose: Accept host/plugin calls and user commands, then delegate to lower layers.
- Location: `src/index.ts`, `src/cli.ts`, `src/ui/menu.ts`, `src/auth/login-method.ts`
- Contains: OpenCode plugin exports, CLI command dispatch, line-based TUI flows, auth-login prompts.
- Depends on: `src/storage/accounts.ts`, `src/account-update.ts`, `src/account-removal.ts`, `src/config/sync.ts`, `src/auth/device-flow.ts`, `src/auth/loader.ts`
- Used by: OpenCode plugin loading via `dist/index.js`, CLI execution via `dist/cli.js`, OpenCode auth login methods under provider `github-copilot`.
- Purpose: Apply account lifecycle rules without embedding storage details in the entrypoints.
- Location: `src/account.ts`, `src/account-update.ts`, `src/account-removal.ts`, `src/storage-audit.ts`, `src/storage-repair.ts`, `src/runtime-checks.ts`
- Contains: Account creation, rename/revalidate/plan mutation, two-step removal, reconcile/audit flows, runtime guard checks.
- Depends on: `src/storage/accounts.ts`, `src/storage/secrets.ts`, `src/config/sync.ts`, `src/routing/provider-account-map.ts`, `src/config/models.ts`
- Used by: `src/cli.ts`, `src/ui/menu.ts`, `src/config/capabilities.ts`, `src/auth/login-method.ts`.
- Purpose: Persist account metadata, secrets, and lock-coordinated file transactions.
- Location: `src/storage/accounts.ts`, `src/storage/secrets.ts`, `src/storage/locking.ts`, `src/storage/validation.ts`
- Contains: Config-directory resolution, JSON read/write, validation, corruption quarantine, lock files, orphan cleanup.
- Depends on: Node FS/path APIs and shared types from `src/types.ts`.
- Used by: Nearly every mutating flow, especially `src/index.ts`, `src/account-update.ts`, `src/account-removal.ts`, `src/storage-audit.ts`, and `src/storage-repair.ts`.
- Purpose: Translate stored accounts into OpenCode provider entries and model lists.
- Location: `src/config/providers.ts`, `src/config/models.ts`, `src/config/capabilities.ts`, `src/config/opencode-config.ts`, `src/config/sync.ts`
- Contains: Provider-id helpers, plan→model tables, mismatch handling, OpenCode config parsing/writing, full sync reconciliation.
- Depends on: `src/storage/accounts.ts`, `src/account-update.ts`, `src/storage/locking.ts`.
- Used by: `src/cli.ts`, `src/ui/menu.ts`, `src/auth/loader.ts`, `src/auth/login-method.ts`, `src/account-update.ts`, `src/account-removal.ts`.
- Purpose: Isolate each provider request to one account and inject bearer auth at request time.
- Location: `src/auth/loader.ts`, `src/auth/device-flow.ts`, `src/auth/token-state.ts`, `src/auth/compatibility-check.ts`, `src/routing/provider-account-map.ts`
- Contains: Device-flow exchange, runtime token registry, single-flight/serialized token lifecycle, provider→account lease registry, compatibility warnings.
- Depends on: `src/log.ts`, `src/config/capabilities.ts`, `src/types.ts`.
- Used by: `src/index.ts` runtime plugin hooks and `src/auth/login-method.ts` callback success paths.
- Purpose: Provide shared contracts, flags, and logging used across all layers.
- Location: `src/types.ts`, `src/log.ts`, `src/flags.ts`
- Contains: Stable type definitions, env-gated debug flags, scoped log helpers.
- Depends on: Node process globals only.
- Used by: All feature modules in `src/`.
## Data Flow
- Durable state lives in JSON files managed by `src/storage/accounts.ts`, `src/storage/secrets.ts`, and `src/config/opencode-config.ts`.
- Runtime-only state lives in in-memory registries inside `src/routing/provider-account-map.ts` and `src/auth/token-state.ts`.
- Restart/reload is part of the architecture: config changes are persisted first, then picked up by reloading the plugin host.
## Key Abstractions
- Purpose: Represent one logical Copilot account across storage, config generation, and UI.
- Examples: `src/types.ts`, `src/account.ts`, `src/storage/accounts.ts`
- Pattern: Stable `CopilotAccountMeta` record with lifecycle, capability, and provider identity fields.
- Purpose: Bridge dynamic account lists into OpenCode's static module export model.
- Examples: `src/index.ts`
- Pattern: Top-level account load plus eight static slot exports created by `makeSlotPlugin()`.
- Purpose: Tie each outbound provider request to one account and track in-flight work for drain-on-remove.
- Examples: `src/routing/provider-account-map.ts`, `src/auth/loader.ts`
- Pattern: Acquire/release lease around each fetch, with fail-closed resolution and per-account in-flight counters.
- Purpose: Make `opencode.json`/`opencode.jsonc` the generated mirror of active CopilotHydra accounts.
- Examples: `src/config/sync.ts`, `src/config/providers.ts`, `src/config/opencode-config.ts`
- Pattern: Remove all `github-copilot-acct-*` entries, rebuild from active accounts, and write atomically under lock.
- Purpose: Prevent same-account token lifecycle races while allowing cross-account concurrency.
- Examples: `src/auth/token-state.ts`, `src/auth/loader.ts`
- Pattern: Per-account serialized tail promise plus single-flight recovery map.
## Entry Points
- Location: `src/index.ts`
- Triggers: OpenCode plugin discovery/loading of `dist/index.js`
- Responsibilities: Load accounts, register routing, expose setup/login auth methods, expose up to eight account runtime slots.
- Location: `src/cli.ts`
- Triggers: `copilothydra` bin from `package.json`
- Responsibilities: Dispatch commands such as `menu`, `add-account`, `sync-config`, `remove-account`, `review-mismatch`, `repair-storage`, and `audit-storage`.
- Location: `src/ui/menu.ts`
- Triggers: `copilothydra` default command or `copilothydra menu`
- Responsibilities: Render account overview, collect interactive choices, and delegate to update/removal/sync flows.
- Location: `src/auth/login-method.ts`
- Triggers: OpenCode `auth login` under shared provider `github-copilot`
- Responsibilities: Re-auth existing accounts or create new accounts before returning account-scoped OAuth success.
## Error Handling
- `src/auth/loader.ts` throws on provider mismatch, missing routed token, pending-removal routing, and capability mismatch instead of silently falling back.
- `src/storage/accounts.ts` and `src/storage/secrets.ts` quarantine corrupt JSON to `*.corrupt-*` and recover to empty version-1 state.
- `src/cli.ts` and `src/ui/menu.ts` surface actionable operator messages and require restart after storage/config changes.
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

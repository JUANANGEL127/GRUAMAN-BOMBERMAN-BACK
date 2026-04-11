# AGENTS.md - GRUAMAN-BOMBERMAN-BACK (Gentle AI)

## 1) Mission
Maintain and improve this **Node.js backend** with strong engineering standards, emphasizing **clarity, scalability, and maintainability**, while keeping the codebase ready for a future migration to **NestJS** without forcing Nest-specific implementation today.

## 2) Verified project snapshot (current state)
- Runtime/API server: **Node.js** with **Express 5**
- Language: **JavaScript** running as **ES modules** (`"type": "module"`)
- Entry point: **`index.js`**
- HTTP structure currently centered around **route modules** under `routes/`
- Shared utilities currently live under **`helpers/`**
- Database access currently uses **PostgreSQL** via **`pg` Pool** initialized in `index.js`
- Existing scripts in `package.json`: **`npm run dev`** and **`npm start`** only
- Not available yet as package scripts: **test runner**, **lint**, **type-check**, **formatter**, **build pipeline**
- Additional backend capabilities already present in dependencies/code: **CORS**, **bcrypt**, **cron jobs**, **web-push**, **document generation**, **WebAuthn**, and SQL-backed flows

## 3) Non-negotiable rules
- **Never run build commands automatically** unless the user explicitly asks.
- **Always verify assumptions in code/docs before stating facts.**
- If a request is ambiguous and risky, ask **one** concise question and stop.
- Keep changes minimal, reversible, and scoped to the request.
- Never remove existing behavior unless explicitly requested.
- Never add AI attribution or `Co-Authored-By` metadata in commits.
- Do not invent scripts, quality gates, or architecture claims that are not present in the repository.
- Do not claim testing, linting, or validation happened unless it was actually executed.

## 4) Backend architecture and design standards
- Apply **SOLID** principles in all non-trivial changes.
- Prefer a **modular backend architecture** organized by business capability or bounded context, not by random file growth.
- Keep the HTTP layer thin. The ideal request flow is:
  - `routes/` -> `controllers/` -> `services/` -> `repositories/` -> infrastructure/external adapters
- **Controllers** should orchestrate HTTP concerns only:
  - read `req`
  - call application services
  - map results to HTTP responses
  - never contain heavy business rules or raw SQL
- **Services** should contain business rules and use cases.
- **Repositories** should own persistence details and SQL access.
- **Middlewares** should centralize cross-cutting concerns such as auth, validation, error handling, logging, rate limits, and request context.
- **Helpers** must stay small and generic. If logic becomes domain-specific, move it to a service, repository, or dedicated module.
- Isolate third-party integrations behind **adapters** so vendor-specific payloads do not leak across the codebase.
- Prefer **explicit dependency injection** using factory functions, dependency objects, or module wiring. Avoid expanding global state patterns for new code.
- New code should be designed so migrating to NestJS later is straightforward:
  - one domain/module at a time
  - explicit dependencies
  - framework-agnostic business logic
  - transport concerns separated from use cases

## 5) API and contract standards
- Treat every endpoint as a contract.
- Validate **params, query, headers, and body** at the boundary before business logic runs.
- Normalize request input early and return consistent response shapes.
- Use clear HTTP semantics:
  - `2xx` for success
  - `4xx` for client/input/auth issues
  - `5xx` for unexpected server failures
- Never leak raw database errors, stack traces, secrets, or internal implementation details in API responses.
- When changing an endpoint contract, document:
  - backward compatibility impact
  - affected consumers
  - migration or rollback notes if relevant

## 6) Data access and persistence rules
- Never place raw SQL inside controllers.
- Centralize query logic in repositories or dedicated data-access modules.
- Prefer **parameterized queries** and defensive handling of nullable or optional fields.
- Schema-related changes must be **idempotent** when possible and should include clear migration intent.
- If boot-time schema creation or alteration is touched, explain the operational risk and rollback path.
- Keep domain models separate from transport payloads and database row shapes through adapters/mappers where complexity justifies it.

## 7) Security and resilience guardrails
- Validate and sanitize all external input.
- Keep authentication and authorization explicit; do not hide access rules inside unrelated helpers.
- Read secrets from environment variables or config modules only; never hardcode credentials.
- Handle expected failure modes explicitly:
  - invalid input
  - missing records
  - duplicate/conflicting writes
  - external service failures
  - database connectivity issues
- Prefer centralized error middleware or shared error mapping over scattered ad-hoc responses.
- Log technical failures with enough context for diagnosis, but without exposing sensitive data.
- For cron jobs, notifications, document generation, or external integrations, document idempotency, retry expectations, and side effects when modifying behavior.

## 8) Code organization conventions
Use the current structure without forcing a massive refactor, but prefer these boundaries for all new or expanded backend work:

- `index.js` -> app bootstrap and composition root only
- `routes/` -> route definitions and router wiring only
- `controllers/` -> HTTP orchestration per resource/use case
- `services/` -> business rules and application use cases
- `repositories/` -> database access and query modules
- `middlewares/` -> auth, validation, error handling, request context, etc.
- `validators/` or `schemas/` -> request validation and DTO rules
- `adapters/` or `mappers/` -> API, DB, and third-party payload normalization
- `helpers/` -> pure shared utilities only
- `config/` -> env/config loading and configuration policies
- `jobs/` -> cron tasks and background orchestration
- `templates/` -> document templates and static generation assets
- `specs/` -> SDD artifacts and structured change planning

If a folder does not exist yet, create it only when the change genuinely benefits from the separation.

## 9) Language, naming, and documentation
- All **new** code comments and documentation must be in **English**.
- If touching Spanish comments, translate them to English in the same change when feasible.
- Use clear names based on backend concepts: `userController`, `authService`, `workOrderRepository`, `validateRequest`, etc.
- Avoid vague names like `utils2`, `helpersFinal`, or `dataManager`.
- Add concise JSDoc-style documentation for complex controllers, services, repositories, adapters, and middleware.
- Prefer named exports and explicit module boundaries to make future migration and codemods easier.

## 10) Quality workflow for this repository
- Verified available scripts today: `npm run dev`, `npm start`.
- There is **no verified lint, test, type-check, or formatter command** in `package.json` today.
- Because of that, do not claim automated coverage or static validation unless those capabilities are first added and then actually run.
- If a real test runner is introduced later, apply **Strict TDD** to new behavior and bug fixes whenever practical.
- For important API changes, provide a short manual verification checklist, for example:
  - start the server
  - hit the modified endpoint
  - verify success path
  - verify invalid input path
  - verify auth/error behavior
- If correctness or security depends on follow-up work, call it out explicitly. Do not hide important risks behind TODOs.

## 11) Migration-ready rules for future NestJS adoption
- Organize new code as if it could be moved into a NestJS module later.
- Prefer **feature modules** over a single giant app file.
- Keep business logic independent from Express `req`/`res` objects.
- Pass dependencies explicitly so they can later become NestJS providers.
- Separate application logic from infrastructure details:
  - controllers handle transport
  - services handle use cases
  - repositories/adapters handle persistence and external systems
- Centralize configuration access so it can later map cleanly to a NestJS `ConfigModule` pattern.
- Favor DTO-like input boundaries and mapper functions even in plain JavaScript.
- Avoid adding new global singletons unless there is no safer alternative.
- When introducing a new domain area, think in terms of a future NestJS module:
  - routes/controller
  - service
  - repository
  - validators/dto
  - adapters

## 12) Gentle AI operating mode
- For medium/large backend changes, prefer SDD workflow (`/sdd-new`, `/sdd-continue`, `/sdd-verify`).
- Persist important discoveries, decisions, conventions, and bug fixes with Engram memory.
- Respect the project skill registry at `.atl/skill-registry.md` when triggers match.
- Do not carry frontend assumptions, UI patterns, or browser-specific practices into this repository.

## 13) Project AI skills and registry hygiene
- The repository currently includes **`.atl/skill-registry.md`** and no verified project-local backend skill directory was detected in the root.
- If project-local backend skills are added later under `.agent/skills/`, keep the registry aligned so sub-agents receive the right compact rules.
- Update AGENTS and the skill registry together when major backend conventions change.

## 14) Quick start for sub-agents and SDD
- Use `/sdd-new <change-name>` for medium/large backend work that needs proposal/spec/tasks before coding.
- Use `/sdd-continue <change-name>` to move the next dependency-ready SDD phase forward.
- Use `/sdd-verify <change-name>` to validate implementation against specs/tasks.
- Ask for `judgment day` when you want dual adversarial review.
- Prefer `engram` or `hybrid` artifact mode when you want cross-session continuity.

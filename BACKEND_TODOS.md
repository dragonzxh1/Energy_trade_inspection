# Database & Backend TODOs

Execution order: strict top-to-bottom (no skipping).

## Checklist
- [x] T0 Define and persist TODO list in repository (`BACKEND_TODOS.md`)
- [x] T1 Switch DB plan to Docker + PostgreSQL (per user requirement)
- [x] T2 Add Postgres dependencies (`pg`, `@types/pg`)
- [x] T3 Add Docker infra (`docker-compose.yml`) and local env defaults
- [x] T4 Create migration runner + migration SQL scaffold
- [x] T5 Create backend repository layer scaffold (search/entity/flag helpers)
- [ ] T6 Implement deterministic seed script (companies + vessels + aliases)
- [ ] T7 Implement `GET /api/v1/search` with quota consume + DB query
- [ ] T8 Implement `GET /api/v1/entities/[id]` with DB query
- [ ] T9 Implement `GET /api/v1/quota` (monthly usage + reset date)
- [ ] T10 Implement `POST /api/v1/flags` pending-review flow
- [ ] T11 Update compatibility routes: `/api/search`, `/api/entity/[id]`
- [ ] T12 Run DB startup + migrations + seed (dockerized Postgres)
- [ ] T13 Run QA checks (`type-check`, `build`) and endpoint smoke tests
- [ ] T14 Update this TODO file with final completion status

## Progress Log
- 2026-04-04: Initialized TODO and began execution.
- 2026-04-04: Migrated plan from SQLite to Docker Postgres after user clarification.

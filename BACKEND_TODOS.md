# Backend TODOs

Current phase: backend consolidation, not backend bootstrap.

## Status Summary

### Already completed
- [x] B0 Dockerized PostgreSQL is in place (`docker-compose.yml`)
- [x] B1 Core migration runner exists and applies SQL migrations on startup
- [x] B2 Core entity schema exists (`entities`, `entity_aliases`, `risk_flags`, `user_query_usage`, `query_log`)
- [x] B3 Search repository is implemented (`searchEntities`)
- [x] B4 Entity detail repository is implemented (`getEntityByKey`)
- [x] B5 Sanctions cache + sync schema is implemented
- [x] B6 Watchlist schema and routes are implemented
- [x] B7 AIS cache and vessel intelligence routes are implemented
- [x] B8 PSC / ports / ICIJ schema and repository helpers are implemented
- [x] B9 Document screening route is implemented (`/api/screen`)
- [x] B10 Trade check route is implemented (`/api/trade`)
- [x] B11 PDF report generation routes are implemented
- [x] B12 Stripe auth/account subscription groundwork exists
- [x] B13 Search browse query was parameterized
- [x] B14 Unlimited quota serialization was fixed
- [x] B15 `pgcrypto` extension enablement and migration locking were fixed

### Main gap now
- [x] C0 Backend task list is aligned with real code status
- [x] C1 Quota capability is exposed as a dedicated API
- [x] C2 Risk flag submission is exposed as a dedicated API
- [x] C3 API naming/versioning strategy is defined (`/api/*` vs `/api/v1/*`)
- [x] C4 Page-level direct DB/repository access is reduced
- [x] C5 Heavy route orchestration is extracted into service-level modules
- [x] C6 Migration triggering is moved out of normal request/page paths

## Execution Order

### Phase 1: planning and contract cleanup
- [x] T0 Rewrite this todo file to reflect actual backend state
- [x] T1 Add a concise backend architecture status section to this file after code audit
- [x] T2 Decide API standardization strategy:
  - keep current `/api/*` as canonical
  - add `/api/v1/*` only as a compatibility layer if external clients require it
  - avoid migrating canonical internal routes during the current consolidation batch

### Phase 2: missing formal APIs
- [x] T3 Implement `GET /api/quota`
  - reuse `getQuotaStatus`
  - require auth
  - return stable quota contract
- [x] T4 Implement `POST /api/flags`
  - reuse `createRiskFlag`
  - require auth
  - validate `entityId`, `flagType`, `severity`
  - return pending-review payload

### Phase 3: page/data boundary cleanup
- [x] T5 Refactor [search/page.tsx](D:/Github/Energy_trade_inspection/src/app/search/page.tsx)
  - reduce direct `db` usage for browse mode
  - prefer route/service boundary
- [x] T6 Refactor [company/[slug]/page.tsx](D:/Github/Energy_trade_inspection/src/app/company/[slug]/page.tsx)
  - reduce direct watchlist query coupling
  - isolate page-facing data loader
- [x] T7 Refactor [vessel/[imo]/page.tsx](D:/Github/Energy_trade_inspection/src/app/vessel/[imo]/page.tsx)
  - reduce direct watchlist query coupling
  - isolate page-facing data loader
- [x] T8 Refactor [watchlist/page.tsx](D:/Github/Energy_trade_inspection/src/app/watchlist/page.tsx)
  - reduce direct page-level SQL
  - move listing and alert queries behind server helpers or routes

### Phase 4: route orchestration cleanup
- [x] T9 Extract trade-check orchestration from [trade/route.ts](D:/Github/Energy_trade_inspection/src/app/api/trade/route.ts)
  - create dedicated service module
  - keep route thin
- [x] T10 Extract document-screening orchestration from [screen/route.ts](D:/Github/Energy_trade_inspection/src/app/api/screen/route.ts)
  - create dedicated service module
  - keep route thin

### Phase 5: startup/runtime cleanup
- [x] T11 Reduce repeated `applyMigrations()` calls from pages/routes
- [x] T12 Define one stable startup path for migrations

### Phase 6: verification and documentation
- [x] T13 Run validation after each backend consolidation batch
  - `npm run type-check`
  - `npm run build`
  - endpoint smoke checks deferred until a live local server session
- [x] T14 Update this file after each completed task

## Current Backend Assessment

### Database
- Stable and already product-oriented.
- Not a blocker.
- Main work is schema ownership and cleanup, not database creation.

### API layer
- Functional, but naming and boundaries are not fully standardized.
- Several important capabilities already exist without dedicated formal endpoints.

### Service / repository layer
- Stronger than the task file previously suggested.
- Main issue is that some orchestration still lives in route handlers.

### Next priority
- Start frontend-side integration against the stabilized backend boundaries.
- Optionally add `/api/v1/*` compatibility routes only if an external client needs versioned URLs.

## Progress Log
- 2026-04-04: Initial backend todo created during Docker/Postgres setup phase.
- 2026-04-09: Todo rewritten after full code audit; project reclassified from bootstrap phase to backend consolidation phase.
- 2026-04-09: Added dedicated `quota` and `flags` APIs, moved trade/screen orchestration into service modules, reduced page-level direct DB access on search/company/vessel/watchlist, and standardized migration startup through `src/instrumentation.ts`.

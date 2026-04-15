# Frontend TODOs

Current phase: frontend boundary consolidation, not a full frontend rewrite.

## Assessment

### Necessary now
- [x] F0 Define the frontend consolidation scope before implementation
- [x] F1 Confirm that backend boundaries are now stable enough to build against
- [x] F2 Decide that we will not force all pages through HTTP routes when a server helper is the cleaner boundary

### Why this batch is necessary
- [x] Frontend pages still exist that import `db` directly, which keeps page rendering coupled to storage details.
- [x] Backend routes and services are now stable enough that page-level direct DB access is the wrong boundary.
- [x] The goal is boundary cleanup, not aesthetic or layout refactoring.

### What this batch is not
- [x] Not a full SPA/API rewrite
- [x] Not a full `/api/v1/*` migration
- [x] Not a UI redesign
- [x] Not replacing clean server helpers with unnecessary internal fetch calls

## Priority Buckets

### P0: Must clean now
- [x] P0.1 Home page [page.tsx](D:/Github/Energy_trade_inspection/src/app/page.tsx)
  - remove direct `db` query for featured entities
  - reuse repository/helper boundary
- [x] P0.2 Account page [page.tsx](D:/Github/Energy_trade_inspection/src/app/account/page.tsx)
  - remove direct `db` query in billing portal flow
  - move account data access behind a server helper
- [x] P0.3 Reports page [page.tsx](D:/Github/Energy_trade_inspection/src/app/reports/page.tsx)
  - remove direct `db` usage for session history
  - move report history loading behind a server helper
- [x] P0.4 Terminal page [page.tsx](D:/Github/Energy_trade_inspection/src/app/terminal/[id]/page.tsx)
  - remove direct `db` usage for watch state and related page data
  - align with company/vessel page loaders

### P1: Worth cleaning in the same batch if low-risk
- [x] P1.1 Search page [page.tsx](D:/Github/Energy_trade_inspection/src/app/search/page.tsx)
  - keep using server helper boundary
  - decide later whether browse/search should call route or stay server-side
- [x] P1.2 Company page [page.tsx](D:/Github/Energy_trade_inspection/src/app/company/[slug]/page.tsx)
  - keep entity/intelligence access behind helper/repository boundary
- [x] P1.3 Vessel page [page.tsx](D:/Github/Energy_trade_inspection/src/app/vessel/[imo]/page.tsx)
  - keep entity/PSC access behind helper/repository boundary
- [x] P1.4 Watchlist page [page.tsx](D:/Github/Energy_trade_inspection/src/app/watchlist/page.tsx)
  - confirm helper boundary is sufficient and avoid reintroducing SQL in page layer

### P2: Not necessary in this batch
- [ ] P2.1 Do not force all SSR pages to call internal HTTP routes
- [ ] P2.2 Do not add `/api/v1/*` just for frontend consistency
- [ ] P2.3 Do not touch API routes that are already the correct data boundary for client actions

## Execution Order
- [x] T0 Create and maintain this todo file
- [x] T1 Clean home page boundary
- [x] T2 Clean account page boundary
- [x] T3 Clean reports page boundary
- [x] T4 Clean terminal page boundary
- [x] T5 Re-verify search/company/vessel/watchlist page boundaries
- [x] T6 Run validation
- [x] T7 Update this file with actual outcomes

## Validation
- [x] `npm run type-check`
- [x] `npm run build`

## Progress Log
- 2026-04-09: Initial frontend boundary-consolidation assessment created after backend consolidation completed.
- 2026-04-09: Completed P0 page-boundary cleanup for home/account/reports/terminal and re-verified search/company/vessel/watchlist boundaries without forcing internal HTTP fetches.

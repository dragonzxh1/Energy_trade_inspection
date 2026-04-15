# Phase 1: Architecture Hardening - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver four architectural fixes that harden the existing ETI codebase:
1. Centralized `middleware.ts` auth guard replacing 16 per-route `auth()` calls (ARCH-01)
2. OpenSanctions API circuit breaker with `status: degraded` fallback (ARCH-02)
3. Admin sync endpoint returns 403 (not 401) and explicitly checks admin role (ARCH-03)
4. Python binary path cross-platform fix verified and hardened with startup detection (ARCH-04)

No new features, no UI changes, no schema migrations. Pure security and reliability hardening.

</domain>

<decisions>
## Implementation Decisions

### ARCH-01: Middleware Route Classification

**Claude's Discretion** — User delegated all decisions.

- **Middleware-protected routes** (require authenticated session):
  - `/api/screen` — document upload
  - `/api/trade` — trade risk check
  - `/api/intelligence/**` — company/vessel/terminal intelligence
  - `/api/ais/**` — AIS vessel data
  - `/api/watchlist/**` — watchlist CRUD + trade monitoring
  - `/api/quota` — quota status
  - `/api/report/**` — PDF report generation
  - `/api/admin/**` — admin sync (middleware handles auth; admin role checked inside handler)

- **Excluded from middleware** (public or special-auth routes):
  - `/api/search` — public entity search (no auth required)
  - `/api/entity/**` — public entity detail (no auth required)
  - `/api/flags` — anonymous risk flag submission
  - `/api/stripe/**` — Stripe webhook (uses Stripe signature verification, not session auth)
  - `/api/auth/**` — NextAuth callbacks (must remain public)
  - `/api/cron/**` — cron cleanup (uses Bearer token, not session auth)

- **Migration approach:** After middleware is in place, REMOVE per-route `auth()` calls from all middleware-protected routes. Do NOT keep belt-and-suspenders duplicates — clean removal is the goal. REQUIREMENTS state "per-route auth() calls are removed and behavior is equivalent."

- **Matcher pattern:** Use `middleware.ts` with a `matcher` config that explicitly excludes the above public/special routes. Prefer a positive matcher (list what IS protected) over a negative matcher (exclusions only) to avoid accidentally protecting new routes.

### ARCH-02: OpenSanctions Circuit Breaker

**Claude's Discretion** — User delegated all decisions.

- **Scope:** Circuit breaker applies to `checkApiSanctions()` in `src/lib/server/sync/sanctions.ts` — the external `sanctions.network` API fallback path. The local DB query path does not need a circuit breaker (it's a DB query, not an external API).

- **Implementation:** Simple in-memory state (module-level variables — no library). Three variables:
  - `circuitOpen: boolean` — whether external API calls are blocked
  - `circuitOpenedAt: number` — timestamp when circuit opened
  - `failureCount: number` — consecutive failures counter

- **Thresholds:**
  - Open after: **3 consecutive failures**
  - Reset (half-open attempt) after: **60 seconds** cooldown
  - On half-open success: reset `failureCount` to 0, set `circuitOpen = false`
  - On half-open failure: extend cooldown another 60 seconds

- **Degraded response shape** — returned by `checkSanctions()` when circuit is open or API call fails:
  ```ts
  { status: 'degraded', listed: false, sources: [], reason: 'opensanctions_api_unavailable' }
  ```
  The caller (screening service) must handle `status: 'degraded'` and surface it in the report — NOT silently treat it as clean.

- **Screening service surface:** When `checkSanctions()` returns `status: degraded`, the screening report must include a `degraded_sources` field or equivalent. This prevents silent false-negatives (i.e., an entity appearing clean when the check actually failed).

### ARCH-03: Admin Sync Endpoint Authorization

**Claude's Discretion** — User delegated all decisions.

- **Role check mechanism:** Keep the email allowlist (`ADMIN_EMAILS` env var) — no DB schema change or new role column. The allowlist is already the established pattern in this codebase and adding a migration adds risk without proportionate gain.

- **Fix 401 → 403:** Distinguish two cases:
  - No session at all (unauthenticated): return **401 Unauthorized**
  - Session exists but user is not admin: return **403 Forbidden**
  - This matches HTTP semantics and satisfies ARCH-03's requirement that "a non-admin user calling `/api/admin/sync` receives a 403"

- **Authorization check refactor:** The `isAuthorized()` function should remain but be updated to return a typed result: `{ authorized: boolean; reason: 'no_session' | 'bearer_valid' | 'admin_email' | 'not_admin' }` so the route handler can choose 401 vs 403 correctly.

- **No localhost bypass in production:** The current code grants access when no `ADMIN_SECRET` is set AND host is localhost. This is acceptable for dev but should log a warning in production mode (`NODE_ENV === 'production'` and no `ADMIN_SECRET` set → warn at startup).

### ARCH-04: Python Path Verification

**Claude's Discretion** — User delegated all decisions.

- **Status:** The cross-platform path logic is **already implemented** in `src/lib/server/intelligence.ts` (commit `4cddc7d`). The code correctly uses `process.platform === 'win32'` to pick `Scripts/python.exe` vs `bin/python`.

- **Additional hardening** (this phase's deliverable for ARCH-04):
  - Add `existsSync()` check at module load time: if the resolved Python binary does not exist, log a clear error message: `"[intelligence] Python binary not found at {path}. Run: py -3.11 -m venv .venv && .venv/Scripts/pip install -r intelligence/requirements.txt"`
  - This turns a cryptic ENOENT runtime error into an actionable startup warning.
  - No timeout change, no new environment variables — just the existence check and error message.

### Claude's Discretion (Summary)

All four implementation areas were delegated to Claude. Decisions above are locked for downstream planning and execution.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Authentication & Middleware
- `src/auth.ts` — NextAuth v5 config, `auth()` export, Google OAuth + PostgreSQL adapter
- `src/app/api/admin/sync/route.ts` — Current admin auth pattern (`isAuthorized()` function) to replace/refactor
- `CLAUDE.md` §Architecture — NextAuth v5 beta caveat: avoid deep API coupling

### Routes with per-route auth() to migrate (ARCH-01)
- `src/app/api/screen/route.ts`
- `src/app/api/trade/route.ts`
- `src/app/api/intelligence/company/[slug]/route.ts`
- `src/app/api/intelligence/terminal/[id]/route.ts`
- `src/app/api/intelligence/vessel/[imo]/route.ts`
- `src/app/api/ais/vessel/[imo]/route.ts`
- `src/app/api/ais/vessel/[imo]/draft-check/route.ts`
- `src/app/api/quota/route.ts`
- `src/app/api/watchlist/route.ts`
- `src/app/api/watchlist/refresh/route.ts`
- `src/app/api/watchlist/trades/route.ts`
- `src/app/api/watchlist/trades/refresh/route.ts`
- `src/app/api/watchlist/trades/[id]/route.ts`
- `src/app/api/flags/route.ts` — currently calls auth() but is public; verify intent

### Circuit Breaker (ARCH-02)
- `src/lib/server/sync/sanctions.ts` — `checkSanctions()` and `checkApiSanctions()` — circuit breaker wraps `checkApiSanctions()`
- `src/lib/server/screening-service.ts` — consumes `checkSanctions()`, must handle `status: degraded`

### Python Intelligence (ARCH-04)
- `src/lib/server/intelligence.ts` — Python path already fixed; add existsSync() hardening

### Project Constraints
- `.planning/REQUIREMENTS.md` — ARCH-01 through ARCH-04 acceptance criteria
- `.planning/ROADMAP.md` §Phase 1 — Success criteria (5 items)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/auth.ts` exports `auth()` — existing NextAuth session helper used by all current routes; middleware will use the same export via `export { auth as middleware }`
- `isAuthorized()` in `src/app/api/admin/sync/route.ts` — refactor in place rather than rewrite

### Established Patterns
- All API routes use `NextRequest` / `NextResponse` from `next/server`
- Auth failure response pattern: `NextResponse.json({ error: 'Unauthorized' }, { status: 401 })` — will change to 403 where appropriate
- Module-level constants for configuration (e.g., `TIMEOUT_MS` in intelligence.ts) — circuit breaker thresholds follow same pattern
- No ORM — circuit breaker state is in-memory (module variables), not DB-backed

### Integration Points
- `middleware.ts` sits at project root alongside `next.config.js` — Next.js loads it automatically
- `checkSanctions()` is the only public interface for sanctions lookup — circuit breaker is encapsulated inside this function
- `screening-service.ts` is the primary consumer of `checkSanctions()` — it must be updated to surface degraded status

</code_context>

<specifics>
## Specific Ideas

No specific references or external examples provided — implementation follows standard Next.js middleware patterns and simple circuit breaker pattern (no library).

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. All four ARCH requirements are addressed.

</deferred>

---

*Phase: 01-architecture-hardening*
*Context gathered: 2026-04-13 via discuss-phase (Claude's Discretion — all areas)*

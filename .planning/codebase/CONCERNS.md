# Technical Concerns

## Technical Debt

### Large Files with High Complexity

| File | Lines | Risk |
|------|-------|------|
| `src/lib/server/repository.ts` | ~1263 | Monolithic data access — hard to test, hard to change |
| `src/lib/server/ais.ts` | ~866 | Complex AIS parsing + caching logic combined |
| `src/lib/server/trade-rules.ts` | ~756 | Large rule engine — all rules in one file |

**Impact:** These files are difficult to unit test and have high cognitive load. A bug in `repository.ts` can affect any feature.

### No Automated Tests

- Zero test coverage (see TESTING.md)
- Complex scoring, rule evaluation, and entity matching logic runs untested
- Sanctions similarity threshold (`0.6`) was recently adjusted — no regression tests protect it
- LLM entity extraction has no validation tests

### Database Migration Gap

- Migration `025_*.sql` is missing (jumps from 024 to 026) — indicates a migration was removed or skipped
- Migrations run automatically with advisory lock, but there's no rollback mechanism

### NextAuth Beta Dependency

- `next-auth: ^5.0.0-beta.30` — still beta, API may change before stable release
- Upgrading will require review of `src/auth.ts` and session handling

## Security Concerns

### Resolved (Recent Commits)

- ✓ Replaced vulnerable `xlsx` with `exceljs` (security fix, commit `308d9a1`)
- ✓ Added file magic byte validation for uploads (commit `289e928`)
- ✓ Rate limiting added (commit `289e928`)
- ✓ CSP headers configured (commit `289e928`)
- ✓ HTTP security headers added (commit `98fd1f5`)

### Active Concerns

**CSP `unsafe-eval`:** `next.config.ts` requires `unsafe-eval` for Next.js webpack/hydration. This weakens XSS protection.

**No middleware.ts:** No centralized authentication middleware — each API route manually checks `auth()`. A missed check on a new route would create an unprotected endpoint.

**OpenAI key exposure:** OpenAI API key is not listed in `.env.local.example`, suggesting it may be in a different env variable (`OPENAI_API_KEY`) — the extraction service uses it but the example template doesn't document it.

**Admin sync endpoint:** `/api/admin/sync` triggers full data sync — needs to verify admin auth is enforced.

**SQL injection surface:** Raw SQL queries throughout `repository.ts` use parameterized queries (`$1`, `$2`) — correctly prevents injection. However, the `intelligence-cache.ts` has a string interpolation:
```typescript
`NOW() + INTERVAL '${TTL_HOURS} hours'`
```
`TTL_HOURS` is a hardcoded constant (24), so currently safe, but the pattern is fragile.

## Performance Concerns

### Connection Pool Pressure

- Pool max: 10 connections
- Multiple simultaneous document screenings could exhaust the pool (screening involves many queries + external API calls)
- No queue or backpressure mechanism

### External API Latency

- Document screening calls multiple external APIs in sequence (sanctions check, registry lookup, AIS data, intelligence)
- No timeout configuration visible on external calls
- OpenAI entity extraction can timeout (Qwen thinking mode was disabled specifically for this — commit `20dd9a2`)

### Intelligence Cache TTL

- 24-hour TTL for intelligence cache (`intelligence-cache.ts`)
- Sanctions data can change between cache refreshes — a newly sanctioned entity could show as clean for up to 24 hours

### Large Codebase Map

- `repository.ts` at 1263 lines is loaded into every API context that needs data access
- No lazy loading or module splitting at the repository level

## External Dependency Risks

### OpenSanctions API

- Requires commercial license for SaaS use
- If API is unavailable, sanctions screening may fail silently
- No circuit breaker pattern observed

### AIS Data Quality

- AIS data can be spoofed or turned off by vessels intentionally
- Dark period detection is only as reliable as AIS coverage
- HiFleet/AIS provider not confirmed in code — dependency hidden in `ais.ts`

### Company Registry APIs

- UK Companies House, Singapore ACRA, Swiss Zefix, OpenCorporates — each has rate limits
- No shared rate limiter across sync modules
- Registry data may be stale if sync hasn't run recently

## Known Issues / Fragile Areas

### Encoding Issues in Source Files

- Garbled Unicode visible in comments of some files:
  - `src/lib/server/scoring.ts:20` — box-drawing characters corrupted
  - `src/lib/server/intelligence-cache.ts:44` — Chinese comment garbled
- Likely caused by UTF-8 BOM handling on Windows
- Cosmetic issue but indicates potential encoding inconsistencies

### Pinyin Search Limitation

- CJK → pinyin conversion only works for person names reliably
- Company names only match if stored name is pinyin-romanized (not translated)
- Documented in `src/app/api/search/route.ts` comments

### Phase 2 Scoring

- `tradingTrackRecord` dimension (max 25 pts) is always 0 — placeholder for Phase 2
- Total possible score is effectively 75/100 until Phase 2 ships
- Users may be confused by apparent cap on scores

### Missing Migration 025

- Migration files jump from `024_watched_trades.sql` to `026_enable_pgcrypto.sql`
- Migration 025 was likely removed after being applied — could indicate schema state inconsistency in older databases

## Deployment Concerns

### Windows Development, Linux Production

- `npm run build:win` with `--max-old-space-size=4096` needed on Windows
- Cross-platform path handling in `src/lib/server/migrations.ts` uses `process.cwd()` + `path.join()` — should be OK but worth monitoring
- WSL2 may be preferable for development consistency

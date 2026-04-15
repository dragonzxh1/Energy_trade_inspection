# Architecture

## Pattern

**Next.js 15 App Router + Service Layer + Repository Pattern**

Three-tier architecture:
1. **Presentation:** Next.js App Router pages + React 19 components
2. **Service Layer:** Orchestration logic in `src/lib/server/`
3. **Data Layer:** `repository.ts` + raw PostgreSQL queries

## Data Flow

```
Browser Request
    ↓
Next.js App Router (src/app/)
    ↓
API Route Handler (src/app/api/*/route.ts)
    ↓ auth check via next-auth
Service Layer (src/lib/server/*-service.ts)
    ↓                    ↓
Repository           External APIs
(repository.ts)      (sanctions, AIS, registries)
    ↓                    ↓
PostgreSQL           Cache Tables
                     (ais_cache, intelligence_cache)
```

## Startup Flow

`src/instrumentation.ts` → `register()` (Node.js runtime only)
1. `applyMigrations()` — runs any new SQL migrations under advisory lock 402601
2. `syncLegitDomains()` — auto-syncs the 307+ legitimate domain whitelist

## Core Service Orchestrators

### `src/lib/server/screening-service.ts`
Document screening pipeline:
1. Parse uploaded document (PDF/DOCX/XLSX)
2. Extract entities via OpenAI LLM
3. Screen each entity (sanctions + registry + fraud + domain checks)
4. Run trade-level risk rules
5. Return `ScreeningReport` with risk verdicts

### `src/lib/server/trade-service.ts`
Trade risk check:
- Inputs: seller company + vessel + port
- Runs trade rules engine (`trade-rules.ts`)
- Returns trade risk verdict with flags

## Key Server Modules

| File | Role | Size |
|------|------|------|
| `src/lib/server/repository.ts` | Core data access — entity search, lookup, full object building | ~1263 lines |
| `src/lib/server/ais.ts` | AIS position fetching, caching, dark period detection | ~866 lines |
| `src/lib/server/trade-rules.ts` | Trade-level risk judgment rules | ~756 lines |
| `src/lib/server/scoring.ts` | Authenticity Score engine (0–100) | ~200 lines |
| `src/lib/server/intelligence.ts` | Aggregates multi-source intelligence per entity | — |
| `src/lib/server/intelligence-cache.ts` | 24h cache layer for intelligence aggregation | ~50 lines |
| `src/lib/server/migrations.ts` | Advisory-locked, transactional migration runner | ~70 lines |
| `src/lib/server/db.ts` | Singleton PostgreSQL pool (global in dev) | ~24 lines |
| `src/lib/server/entity-extractor.ts` | OpenAI-based entity extraction from documents | — |
| `src/lib/server/document-parser.ts` | PDF/DOCX/XLSX text extraction | — |

## Scoring Engine (`src/lib/server/scoring.ts`)

Authenticity Score dimensions (Phase 1, max 75 points):
- **Entity Existence** (max 25): Registry records, IMO number, verifiable existence
- **Asset Reality** (max 30): AIS position, draught, port calls, dark periods
- **Document Consistency** (max 10): AIS vs. registry coherence
- **Community Reputation** (max 10): PSC detention records
- **Trading Track Record** (max 25): Phase 2, always 0 for now

**Sanction overrides:**
- `listed` → all dimensions zero, total ≤ 10
- `unknown` → all scores × 0.7
- `not_listed` → no adjustment

**Risk level thresholds:**
- 85–100 → Low
- 60–84 → Medium
- 35–59 → High
- 0–34 → Critical

## Monetization / Content Lock

Three content tiers enforced via CSS blur + overlay (not hidden — preserves SEO):
- **F1 (always free):** Entity name, authenticity score, sanction badge
- **F2 (always free):** Summary, basic info
- **F3 (paid):** Registration details, directors, vessels, documents, full audit trail

User `plan` field: `free` | `starter` | `enterprise`

## Authentication Pattern

All protected API routes use:
```typescript
const session = await auth()
if (!session?.user) {
  return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
}
```

## API Route Patterns

All routes use `export const runtime = 'nodejs'` where needed for Node.js APIs.
Routes return `NextResponse.json()` with typed generics.

## Sync Architecture

`src/lib/server/sync/` modules each handle one data source:
- `index.ts` — orchestrates all syncs
- Each module: fetch → parse → upsert into PostgreSQL
- Sync triggered via `/api/admin/sync` (admin only) or cron

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Design Resources

- **Sketch findings for ETI** (design decisions, CSS patterns, visual direction) → `Skill("sketch-findings-Energy_trade_inspection")`

## Project Overview

Energy Trade Inspection (ETI) is a B2B compliance and risk screening platform for energy traders. It screens companies, vessels, and terminals against sanctions lists (OFAC, EU FSF, UN), AIS data, corporate registries, and other intelligence sources to produce an **Authenticity Score** (0–100) and trade-level risk verdicts.

## Commands

```bash
# Development
npm run dev          # Start Next.js dev server on port 3000
npm run build        # Production build
npm run build:win    # Windows build with 4GB Node heap
npm start            # Start production server

# Code Quality
npm run lint         # ESLint
npm run type-check   # tsc --noEmit (TypeScript strict check)

# Local database (Docker)
docker-compose up -d  # Start PostgreSQL 16 container
```

**Environment:** Copy `.env.local.example` to `.env.local` before running. Key variables: `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `OPENSANCTIONS_API_KEY`, `NEXT_PUBLIC_APP_URL`.

**Migrations run automatically** on startup via `src/instrumentation.ts` → `applyMigrations()`. No manual migration step needed. Uses PostgreSQL advisory lock `402601` to prevent concurrent runs.

## Architecture

### Stack
- **Frontend:** Next.js 15 App Router, React 19, TypeScript (strict), custom CSS (no Tailwind)
- **Database:** PostgreSQL 16 via raw `node-postgres` (`pg`). No ORM. Pool max 10 connections.
- **Auth:** NextAuth v5 + Google OAuth, database-backed sessions (`@auth/pg-adapter`). Session carries `user.id` and `user.plan`.
- **Payments:** Stripe webhook-driven subscriptions (`/api/stripe/webhook`, `/api/stripe/checkout`)
- **LLM:** OpenAI SDK for entity extraction from uploaded documents
- **Document parsing:** `pdf-parse`, `mammoth` (DOCX), `xlsx`

### Data Flow

```
API Route → Service Layer → Repository (src/lib/server/repository.ts) → PostgreSQL
                         → External APIs (Sanctions, AIS, Registries)
                         → Cache Tables (intelligence_cache, ais_cache)
```

The two core service orchestrators are:
- `src/lib/server/screening-service.ts` — document upload → party extraction → entity screening → report
- `src/lib/server/trade-service.ts` — seller + vessel + port → trade risk rules → verdict

### Key Server Modules

| File | Purpose |
|------|---------|
| `src/lib/server/repository.ts` (44KB) | Core data access — search, entity lookup, building full entity objects |
| `src/lib/server/ais.ts` (33KB) | AIS position fetching, caching, dark period detection |
| `src/lib/server/trade-rules.ts` (32KB) | Trade-level risk judgment rules |
| `src/lib/server/scoring.ts` | Authenticity Score engine (0–100) |
| `src/lib/server/intelligence.ts` | Aggregates multi-source intelligence per entity |
| `src/lib/server/intelligence-cache.ts` | Cache layer for intelligence aggregation |
| `src/lib/server/sync/` | External data sync (OFAC, EU FSF, Companies House, ACRA, Zefix, OpenCorporates) |
| `src/lib/server/migrations.ts` | Advisory-locked, transactional migration runner |
| `src/lib/server/db.ts` | Singleton pool (global in dev to survive hot reload) |

### Scoring Engine (`src/lib/server/scoring.ts`)

Authenticity Score dimensions (Phase 1, max 75 points):
- **Entity Existence** (max 25): Registry records, IMO number, verifiable existence
- **Asset Reality** (max 30): AIS position, draught, port calls, dark periods
- **Document Consistency** (max 10): AIS vs. registry coherence
- **Community Reputation** (max 10): PSC detention records

**Sanction overrides:** `listed` → always `critical` riskLevel regardless of authenticity score. `unknown` → authenticity score unchanged; riskLevel capped at `medium` (cannot reach `low`). `not_listed` → riskLevel derived purely from authenticity score thresholds.

**Risk level thresholds:** 85–100 Low | 60–84 Medium | 35–59 High | 0–34 Critical

### Monetization / Content Lock

Three content tiers enforced via CSS blur + overlay (not hidden — preserves SEO):
- **F1 (always free):** Entity name, authenticity score, sanction badge
- **F2 (always free):** Summary, basic info
- **F3 (paid):** Registration details, directors, vessels, documents, full audit trail

User `plan` field: `free` | `starter` | `enterprise`. Stripe webhooks update the `plan` column in `users`.

### API Route Structure

- `/api/search` — Full-text entity search; cached with `s-maxage=60`
- `/api/intelligence/company|vessel|terminal/[id]` — Aggregated intelligence snapshot
- `/api/entity/[id]` — Raw entity detail
- `/api/ais/vessel/[imo]` — AIS data (position, port calls, dark periods)
- `/api/screen` — Document upload → extract parties → screen → report
- `/api/trade` — Trade risk check (seller + vessel + port)
- `/api/watchlist/*` — Watchlist CRUD + trade monitoring
- `/api/report/[id]` — PDF report generation
- `/api/stripe/checkout` + `/api/stripe/webhook` — Payments
- `/api/admin/sync` — Trigger data sync (admin only)
- `/api/quota` — User quota status
- `/api/flags` — Anonymous risk flag submission
- `/api/cron/cleanup` — Periodic cleanup job

### Database Migrations

26 numbered SQL files in `db/migrations/`, applied in alphabetical order. Key extensions: `pg_trgm` (full-text search), `uuid-ossp`, `pgcrypto`.

### External Data Sources

Sync modules in `src/lib/server/sync/`: OFAC SDN, EU FSF, UN (via `sanctions.ts`), UK Companies House, Singapore ACRA, Swiss Zefix, OpenCorporates. `src/lib/server/gleif.ts` handles GLEIF LEI data.

### Production Deployment

Ubuntu 24.04 / Nginx / PM2 / PostgreSQL 16. Nginx reverse-proxies port 80/443 to Next.js on port 3000. `trustHost: true` is set in NextAuth for the reverse-proxy setup. See `DEPLOY.md` for full deployment steps.

## Path Alias

`@/*` resolves to `./src/*` (configured in `tsconfig.json`).

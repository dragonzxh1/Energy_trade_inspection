# Directory Structure

## Top-Level Layout

```
energy-trade-inspection/
├── db/
│   └── migrations/         # 30 numbered SQL migration files (001–030)
├── src/
│   ├── app/                # Next.js App Router (pages + API routes)
│   ├── components/         # Reusable React components
│   ├── lib/                # Shared utilities
│   │   ├── pdf/            # PDF report generation helpers
│   │   ├── server/         # Server-only modules (DB, services, sync)
│   │   │   └── sync/       # External data sync modules
│   │   └── *.ts            # Shared types and utilities
│   ├── styles/             # Global CSS (no Tailwind — custom CSS only)
│   └── types/              # TypeScript type definitions
├── .env.local.example      # Required environment variables
├── docker-compose.yml      # PostgreSQL 16 local dev container
├── next.config.ts          # Next.js config (CSP, headers, etc.)
├── tsconfig.json           # TypeScript config (strict, ES2022)
└── package.json
```

## App Router Pages (`src/app/`)

```
src/app/
├── api/                            # API routes
│   ├── admin/sync/route.ts         # Trigger data sync (admin only)
│   ├── ais/vessel/[imo]/
│   │   ├── route.ts                # AIS vessel data
│   │   └── draft-check/route.ts   # Draught check at port
│   ├── auth/[...nextauth]/route.ts # NextAuth handler
│   ├── cron/cleanup/route.ts       # Periodic cleanup job
│   ├── entity/[id]/route.ts        # Raw entity detail
│   ├── flags/route.ts              # Anonymous risk flag submission
│   ├── intelligence/
│   │   ├── company/[slug]/route.ts
│   │   ├── terminal/[id]/route.ts
│   │   └── vessel/[imo]/route.ts   # Aggregated intelligence snapshot
│   ├── quota/route.ts              # User quota status
│   ├── report/[id]/route.tsx       # PDF report generation
│   ├── screen/
│   │   ├── route.ts                # Document upload + screening
│   │   └── report/route.tsx        # Screening PDF report
│   ├── search/route.ts             # Full-text entity search
│   ├── stripe/
│   │   ├── checkout/route.ts       # Create Stripe checkout session
│   │   └── webhook/route.ts        # Handle Stripe events
│   ├── trade/
│   │   ├── route.ts                # Trade risk check
│   │   └── [id]/report/route.tsx   # Trade PDF report
│   └── watchlist/
│       ├── route.ts                # Watchlist CRUD
│       ├── refresh/route.ts        # Refresh watchlist data
│       └── trades/                 # Watched trades management
├── account/                        # Account management page
├── company/[slug]/                 # Company entity detail page
├── pricing/                        # Pricing / upgrade page
├── reports/                        # Saved reports list
├── screen/                         # Document screening UI
├── search/                         # Search results page
├── sign-in/                        # Authentication page
├── terminal/[id]/                  # Terminal entity detail page
├── trade/                          # Trade risk check UI
├── upgrade/                        # Upgrade flow (success/cancel)
├── vessel/[imo]/                   # Vessel entity detail page
├── watchlist/                      # Watchlist management UI
├── layout.tsx                      # Root layout
└── page.tsx                        # Home page
```

## Components (`src/components/`)

```
src/components/
├── entity/         # Entity card, detail, scoring display
├── layout/         # Navigation, header, footer
├── pricing/        # Pricing cards, plan comparison
├── search/         # Search bar, results
├── trade/          # Trade risk UI components
├── ui/             # Generic UI primitives
└── watchlist/      # Watchlist UI components
```

## Server Library (`src/lib/server/`)

```
src/lib/server/
├── sync/
│   ├── index.ts               # Sync orchestrator
│   ├── acra.ts                # Singapore ACRA registry
│   ├── companies-house.ts     # UK Companies House
│   ├── eu.ts                  # EU FSF sanctions
│   ├── fraud-alerts.ts        # Industry fraud blacklist
│   ├── legitimate-domains.ts  # Verified domain whitelist
│   ├── ofac.ts                # OFAC SDN sanctions
│   ├── opencorporates.ts      # OpenCorporates global
│   ├── sanctions.ts           # OpenSanctions aggregated
│   └── zefix.ts               # Swiss Zefix registry
├── ais.ts                     # AIS vessel tracking
├── db.ts                      # PostgreSQL pool singleton
├── document-parser.ts         # PDF/DOCX/XLSX parsing
├── domain-check.ts            # Domain verification
├── entity-extractor.ts        # OpenAI entity extraction
├── fraud-check.ts             # Fraud alert matching
├── gleif.ts                   # GLEIF LEI lookup
├── intelligence-cache.ts      # 24h intelligence cache
├── intelligence.ts            # Multi-source intelligence aggregation
├── migrations.ts              # Advisory-locked migration runner
├── normalize.ts               # Entity name normalization
├── repository.ts              # Core data access (1263 lines)
├── scoring.ts                 # Authenticity Score engine
├── screening-service.ts       # Document screening orchestrator
├── trade-rules.ts             # Trade risk rules engine (756 lines)
└── trade-service.ts           # Trade risk orchestrator
```

## Key Naming Conventions

- **API routes:** `route.ts` or `route.tsx` (if rendering PDF)
- **Page files:** `page.tsx`
- **Layout files:** `layout.tsx`
- **Server modules:** camelCase `.ts` files in `src/lib/server/`
- **Type imports:** `import type { ... }` — explicit type-only imports
- **Path imports:** Use `@/` alias (e.g., `@/lib/server/db`)
- **Database rows:** Suffixed with `Row` (e.g., `EntityRow`, `BrowseRow`)

## Database Migrations (`db/migrations/`)

30 SQL files, applied alphabetically at startup:
- 001–009: Initial schema, auth tables, Stripe, watchlist, seed data
- 010–019: OpenSanctions, ports/PSC/ICIJ, AIS cache, intelligence cache
- 020–030: Screening sessions, trade sessions, events, fraud alerts, domain whitelist

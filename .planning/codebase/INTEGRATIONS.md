# External Integrations

## Database

| Service | Config | Files |
|---------|--------|-------|
| PostgreSQL 16 | `DATABASE_URL` env var | `src/lib/server/db.ts` |

- Singleton pool pattern (global in dev to survive hot reload)
- Max 10 connections
- Docker Compose for local: `docker-compose up -d`

## Authentication

| Service | Config | Files |
|---------|--------|-------|
| NextAuth v5 | Built-in session | `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts` |
| Google OAuth | Google Cloud Console | `src/auth.ts` |

- `trustHost: true` set for Nginx reverse-proxy in production
- Session stored in PostgreSQL via `@auth/pg-adapter`

## Payments

| Service | Config | Files |
|---------|--------|-------|
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `src/app/api/stripe/checkout/route.ts`, `src/app/api/stripe/webhook/route.ts` |

- Webhook-driven subscription updates
- Updates `plan` column in `users` table
- Three plans: `free`, `starter`, `enterprise`

## LLM / AI

| Service | Config | Files |
|---------|--------|-------|
| OpenAI | API key (env var not shown in .env.example) | `src/lib/server/entity-extractor.ts` |

- Used for extracting entities from uploaded trade documents
- Qwen thinking mode was disabled (caused timeouts — see commit `20dd9a2`)

## Sanctions & Compliance Data

| Source | Type | Sync Module |
|--------|------|-------------|
| OFAC SDN | Sanctions list | `src/lib/server/sync/ofac.ts` |
| EU FSF | Sanctions list | `src/lib/server/sync/eu.ts` |
| UN Sanctions | Sanctions list | `src/lib/server/sync/sanctions.ts` |
| OpenSanctions | Aggregated sanctions | `src/lib/server/sync/sanctions.ts` |

- OpenSanctions requires commercial license for SaaS use
- API key: `OPENSANCTIONS_API_KEY`
- Results cached in `sanctions_cache` table

## Corporate Registries

| Source | Coverage | Sync Module |
|--------|----------|-------------|
| UK Companies House | UK companies | `src/lib/server/sync/companies-house.ts` |
| Singapore ACRA | SG companies | `src/lib/server/sync/acra.ts` |
| Swiss Zefix | CH companies | `src/lib/server/sync/zefix.ts` |
| OpenCorporates | Global (100+ jurisdictions) | `src/lib/server/sync/opencorporates.ts` |
| GLEIF LEI | Legal Entity Identifiers | `src/lib/server/gleif.ts` |

## AIS (Vessel Tracking)

| Service | Files |
|---------|-------|
| AIS provider (HiFleet?) | `src/lib/server/ais.ts` |

- Fetches vessel position, port calls, draught data
- Detects "dark periods" (AIS transponder off)
- Cached in `ais_cache` table
- API routes: `src/app/api/ais/vessel/[imo]/route.ts`, `src/app/api/ais/vessel/[imo]/draft-check/route.ts`

## Industry Intelligence

| Source | Files |
|--------|-------|
| Fraud alerts / blacklists | `src/lib/server/sync/fraud-alerts.ts` |
| Legitimate domains whitelist | `src/lib/server/sync/legitimate-domains.ts` |
| PSC (Port State Control) detention records | Via intelligence aggregation |
| ICIJ (Panama/Pandora Papers) | `src/lib/server/repository.ts` |

- Legitimate domains: 307+ verified entries, auto-synced on startup
- ICIJ data for officer network analysis

## Intelligence Aggregation Cache

- Table: `intelligence_cache`
- TTL: 24 hours
- Files: `src/lib/server/intelligence-cache.ts`, `src/lib/server/intelligence.ts`

## App URL

- `NEXT_PUBLIC_APP_URL` — used for absolute URL generation
- Default: `http://localhost:3000`

## Production Infrastructure

- Ubuntu 24.04 / Nginx / PM2 / PostgreSQL 16
- Nginx reverse-proxies port 80/443 → Next.js port 3000
- See `DEPLOY.md` for full deployment steps

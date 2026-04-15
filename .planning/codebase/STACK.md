# Tech Stack

## Language & Runtime

- **Language:** TypeScript 5.7 (strict mode enabled)
- **Runtime:** Node.js (Next.js server, via `NEXT_RUNTIME=nodejs`)
- **Target:** ES2022
- **Module resolution:** bundler (Next.js native)
- **Path alias:** `@/*` → `./src/*`

## Framework

- **Next.js:** ^16.2.3 (App Router, React Server Components)
- **React:** 19.0.0
- **React DOM:** 19.0.0

## Database

- **PostgreSQL 16** via raw `node-postgres` (`pg` ^8.20.0)
- **No ORM** — raw SQL queries throughout
- **Connection pool:** max 10 connections (`src/lib/server/db.ts`)
- **Extensions:** `pg_trgm` (full-text search), `uuid-ossp`, `pgcrypto`
- **Migrations:** 30 numbered SQL files in `db/migrations/`, auto-applied at startup via advisory lock 402601

## Authentication

- **next-auth:** ^5.0.0-beta.30
- **Adapter:** `@auth/pg-adapter` ^1.11.1 (database-backed sessions)
- **Provider:** Google OAuth
- **Session:** carries `user.id` and `user.plan`
- **Config file:** `src/auth.ts`

## Payments

- **Stripe:** ^22.0.0
- Webhook-driven subscription management
- Plans: `free` | `starter` | `enterprise`

## LLM

- **OpenAI SDK:** ^6.33.0
- Used for entity extraction from uploaded documents

## Document Parsing

- **pdf-parse:** ^2.4.5 — PDF text extraction
- **mammoth:** ^1.12.0 — DOCX parsing
- **exceljs:** ^4.4.0 — XLSX parsing (replaces xlsx; security fix)
- **@react-pdf/renderer:** ^4.3.3 — PDF report generation

## External Data

- **fast-xml-parser:** ^5.5.10 — XML parsing for sanctions feeds
- **cheerio:** ^1.2.0 — HTML scraping for company registries
- **ws:** ^8.20.0 — WebSocket client for AIS data

## Chinese Support

- **pinyin-pro:** ^3.28.0 — CJK character to pinyin conversion for search

## Build & Dev Tools

- **cross-env:** ^10.1.0 — cross-platform env vars (`npm run build:win`)
- **eslint:** ^9.0.0 + `eslint-config-next` 15.3.1
- **TypeScript:** strict mode, `noEmit` for type-check pass

## Configuration Files

- `next.config.ts` — CSP headers, serverExternalPackages, allowed dev origins
- `tsconfig.json` — strict TypeScript, ES2022 target, bundler module resolution
- `.env.local.example` — required environment variables
- `docker-compose.yml` — PostgreSQL 16 local development container

## Key npm Scripts

```bash
npm run dev          # Next.js dev server on port 3000
npm run build        # Production build
npm run build:win    # Windows build with 4GB Node heap
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
```

## Security Headers (next.config.ts)

- Content Security Policy (CSP)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Strict-Transport-Security (HSTS)
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: deny camera/mic/geolocation

# Code Conventions

## TypeScript Style

- **Strict mode** enabled (`"strict": true` in tsconfig.json)
- **Target:** ES2022 — modern syntax allowed (optional chaining, nullish coalescing, etc.)
- **Type imports:** Use `import type { ... }` for type-only imports (enforced by isolatedModules)
- **No ORM** — raw SQL everywhere; types defined as plain interfaces

### Type Definitions Example

```typescript
// src/lib/server/repository.ts
interface EntityRow {
  id: string
  entity_type: 'company' | 'vessel' | 'terminal'
  name: string
  slug: string | null
  imo: string | null
  registration_number: string | null
  country: string
  sanction_status: 'not_listed' | 'listed' | 'unknown'
  authenticity_score: number
  risk_level: 'low' | 'medium' | 'high' | 'critical'
}
```

## Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `screening-service.ts`, `trade-rules.ts` |
| Functions | camelCase | `applyMigrations()`, `searchEntities()` |
| Interfaces | PascalCase | `EntityRow`, `ScreeningReport`, `ScoringInputs` |
| Types | PascalCase | `RiskLevel`, `SanctionStatus` |
| Database rows | `Row` suffix | `EntityRow`, `BrowseRow`, `FeaturedRow` |
| Constants | camelCase or UPPER_SNAKE | `TTL_HOURS = 24`, `MIGRATION_LOCK_ID = 402601` |
| React components | PascalCase | Components in `src/components/` |

## API Route Pattern

```typescript
// src/app/api/search/route.ts
import { NextRequest, NextResponse } from 'next/server'
import type { SearchResponse } from '@/lib/types'

export const runtime = 'nodejs'  // Required for Node.js APIs

export async function GET(request: NextRequest) {
  // Input validation
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') ?? ''

  if (!query || query.length < 3) {
    return NextResponse.json<SearchResponse>({ results: [], query, total: 0 })
  }

  try {
    const results = await searchEntities(query)
    return NextResponse.json<SearchResponse>(
      { results, query, total: results.length },
      { headers: { 'Cache-Control': 'public, s-maxage=60' } }
    )
  } catch (err) {
    console.error('[search]', err)
    return NextResponse.json({ error: 'Search unavailable' }, { status: 200 })
  }
}
```

## Authentication Pattern

```typescript
// All protected routes
const session = await auth()
if (!session?.user) {
  return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
}
```

## Database Access Pattern

```typescript
// Direct pool queries (no ORM)
import { db } from './db'

const result = await db.query<RowType>(
  'SELECT * FROM entities WHERE id = $1',
  [entityId]
)
return result.rows[0] ?? null

// With transaction (client checkout)
const client = await db.connect()
try {
  await client.query('BEGIN')
  // ... multiple queries
  await client.query('COMMIT')
} catch (err) {
  await client.query('ROLLBACK')
  throw err
} finally {
  client.release()
}
```

## Error Handling

- API routes: `try/catch` → return JSON error response, never throw
- Service layer: errors propagate up; let API route handle them
- Console logging: `console.error('[module-name]', err)` pattern
- Cache failures: swallowed with `console.error` (non-blocking)

```typescript
// Cache write failure pattern (src/lib/server/intelligence-cache.ts)
try {
  await db.query(/* ... */)
} catch (err) {
  console.error('[intelligence-cache] write failed:', err)
  // Don't throw — cache failure is non-fatal
}
```

## Import Organization

```typescript
// 1. Node built-ins
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

// 2. Next.js
import { NextRequest, NextResponse } from 'next/server'

// 3. Internal server modules
import { db } from './db'
import { searchEntities } from './repository'

// 4. Types (import type)
import type { SearchResult, RiskLevel } from '@/lib/types'
```

## CSS Conventions

- **No Tailwind** — custom CSS only
- Files in `src/styles/`
- Blur + overlay pattern for content locking (not `display: none`)

## Comments

- JSDoc comments on exported functions and complex modules
- Inline comments for non-obvious logic
- Garbled Unicode visible in some comments (encoding issue in some files, e.g., `src/lib/server/scoring.ts` line 20, `src/lib/server/intelligence-cache.ts` line 44) — indicates UTF-8 files with BOM or encoding mismatch

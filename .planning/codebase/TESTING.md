# Testing

## Current State

**No automated tests exist in this codebase.**

- No `*.test.ts`, `*.spec.ts`, or `*.test.tsx` files found
- No test framework configured (Jest, Vitest, Playwright, etc.)
- No `test` script in `package.json`
- No CI pipeline configuration found (no `.github/workflows/`)

## Quality Assurance Approach

The project currently relies on:
1. **TypeScript strict mode** — catches type errors at compile time
2. **ESLint** (`next lint`) — enforces code style rules
3. **Manual testing** — browser-based verification
4. **Type checking** (`npm run type-check` / `tsc --noEmit`)

## Key Modules That Should Be Tested

### High Priority (complex business logic)

| Module | Why |
|--------|-----|
| `src/lib/server/scoring.ts` | Authenticity Score calculation — numerical precision matters |
| `src/lib/server/trade-rules.ts` | Risk rule evaluation — false positives/negatives have business impact |
| `src/lib/server/repository.ts` | Data access — complex SQL + external API fan-out |
| `src/lib/server/entity-extractor.ts` | LLM entity extraction — output validation |

### Medium Priority

| Module | Why |
|--------|-----|
| `src/lib/server/ais.ts` | Dark period detection logic |
| `src/lib/server/sync/sanctions.ts` | Sanctions matching thresholds (currently 0.6 — recently adjusted) |
| `src/lib/server/domain-check.ts` | Domain whitelist/blacklist matching |
| `src/lib/server/normalize.ts` | Entity name normalization (used in search) |

### Integration Test Candidates

| Flow | Complexity |
|------|-----------|
| Document upload → entity extraction → sanctions check | High |
| Trade risk check (seller + vessel + port) | High |
| Search with CJK characters → pinyin conversion | Medium |

## If Tests Were Added

**Recommended framework:** Vitest (fast, TypeScript-native, works with Node.js modules)

**Recommended structure:**
```
src/lib/server/__tests__/
├── scoring.test.ts
├── trade-rules.test.ts
├── repository.test.ts (requires DB or mocking)
└── normalize.test.ts
```

**Mocking needs:**
- `db` pool → mock `pg` queries
- OpenAI SDK → mock API responses
- External sync modules → mock HTTP calls

**Add to package.json:**
```json
{
  "scripts": {
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

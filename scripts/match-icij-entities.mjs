#!/usr/bin/env node
/**
 * match-icij-entities.mjs
 *
 * Bulk-matches company entities in our DB against ICIJ offshore leaks data
 * using PostgreSQL trigram similarity. Sets linked_entity_id and match_confidence
 * on icij_entities rows that match our entities above the confidence threshold.
 *
 * Strategy: iterate over our entities in batches, for each entity use the
 * GIN trgm index on icij_entities.lower(name) to find candidates quickly.
 *
 * Usage:
 *   # Match all unlinked companies (default threshold 0.82)
 *   node scripts/match-icij-entities.mjs
 *
 *   # Dry run — print matches without writing to DB
 *   node scripts/match-icij-entities.mjs --dry-run
 *
 *   # Custom threshold
 *   node scripts/match-icij-entities.mjs --threshold 0.85
 *
 *   # Limit entities processed (for testing)
 *   node scripts/match-icij-entities.mjs --limit 500
 *
 *   # Re-match already linked entities (force re-run)
 *   node scripts/match-icij-entities.mjs --force
 *
 * Performance: ~10-30ms per entity lookup. For 200K entities, expect ~1-2 hours.
 * Safe to interrupt and re-run — already-linked entities are skipped by default.
 */

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir   = path.resolve(__dirname, '..')

// ── Args ──────────────────────────────────────────────────────────────────────

const args      = process.argv.slice(2)
const hasFlag   = (f) => args.includes(f)
const getArg    = (f, def) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : def }

const DRY_RUN   = hasFlag('--dry-run')
const FORCE     = hasFlag('--force')
const THRESHOLD = parseFloat(getArg('--threshold', '0.82'))
const LIMIT     = parseInt(getArg('--limit', '0'), 10)
const BATCH     = parseInt(getArg('--batch', '500'), 10)

// ── Env ───────────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(rootDir, '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
  }
}
loadEnv()

// ── DB ────────────────────────────────────────────────────────────────────────

const CONCURRENCY_CFG = parseInt(getArg('--concurrency', '4'), 10)
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: CONCURRENCY_CFG + 2,   // extra connections for batch fetch + link writes
})

// ── Normalize (mirrors repository.ts normalizeInput) ─────────────────────────

function normalize(value) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(sa|ltd|limited|inc|corp|bv|gmbh|pte|fze|fzco|llc|plc)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Find ICIJ entities matching a single company entity.
 * Uses the GIN index on icij_entities.lower(name).
 */
async function findIcijMatches(client, entityId, normalizedName) {
  const whereLinked = FORCE ? '' : 'AND linked_entity_id IS NULL'
  const { rows } = await client.query(
    `SELECT node_id, name, dataset,
            similarity(lower(name), $1) AS conf
     FROM icij_entities
     WHERE lower(name) % $1
       ${whereLinked}
     ORDER BY conf DESC
     LIMIT 5`,
    [normalizedName]
  )
  return rows.filter((r) => parseFloat(r.conf) >= THRESHOLD)
}

/**
 * Link ICIJ entities to our entity.
 */
async function linkMatches(client, entityId, matches) {
  for (const m of matches) {
    await client.query(
      `UPDATE icij_entities
       SET linked_entity_id = $1, match_confidence = $2
       WHERE node_id = $3`,
      [entityId, m.conf, m.node_id]
    )
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`ICIJ Entity Matcher`)
  console.log(`  Threshold : ${THRESHOLD}`)
  console.log(`  Batch size: ${BATCH}`)
  if (DRY_RUN) console.log('  Mode      : DRY RUN')
  if (FORCE)   console.log('  Force     : re-linking already-linked entities')
  if (LIMIT)   console.log(`  Limit     : ${LIMIT} entities`)
  console.log()

  // Get the set of already-linked entity IDs (small — currently 4 records)
  const countClient = await pool.connect()
  let linkedIds = new Set()
  try {
    if (!FORCE) {
      const { rows } = await countClient.query(
        `SELECT DISTINCT linked_entity_id FROM icij_entities WHERE linked_entity_id IS NOT NULL`
      )
      linkedIds = new Set(rows.map((r) => r.linked_entity_id))
    }
  } finally {
    countClient.release()
  }

  // Estimate total from pg stats (no expensive COUNT)
  const total = LIMIT > 0 ? LIMIT : 200595  // approx company entity count
  console.log(`Entities to process: ~${LIMIT > 0 ? LIMIT : total} (skipping ${linkedIds.size} already linked)`)

  let offset = 0
  let processed = 0
  let totalMatches = 0
  let totalLinked = 0

  while (LIMIT === 0 || processed < LIMIT) {
    const batchClient = await pool.connect()
    try {
      // Fetch a batch of entities
      const { rows: entities } = await batchClient.query(
        `SELECT id, name, normalized_name
         FROM entities
         WHERE entity_type = 'company'
           AND normalized_name IS NOT NULL
           AND normalized_name != ''
         ORDER BY id
         LIMIT $1 OFFSET $2`,
        [BATCH, offset]
      )

      if (entities.length === 0) break

      // Process entities concurrently
      const toProcess = entities.filter((entity) => {
        if (LIMIT > 0 && processed >= LIMIT) return false
        if (!FORCE && linkedIds.has(entity.id)) { processed++; return false }
        const norm = normalize(entity.name)
        if (!norm || norm.length < 3) { processed++; return false }
        return true
      })

      // Chunk into groups of CONCURRENCY and run each group in parallel
      for (let i = 0; i < toProcess.length; i += CONCURRENCY_CFG) {
        if (LIMIT > 0 && processed >= LIMIT) break
        const chunk = toProcess.slice(i, i + CONCURRENCY_CFG)

        const results = await Promise.all(
          chunk.map(async (entity) => {
            const conn = await pool.connect()
            try {
              const normalized = normalize(entity.name)
              const matches = await findIcijMatches(conn, entity.id, normalized)
              return { entity, normalized, matches }
            } finally {
              conn.release()
            }
          })
        )

        for (const { entity, matches } of results) {
          if (matches.length > 0) {
            totalMatches += matches.length
            if (DRY_RUN) {
              console.log(`\n  [DRY] ${entity.name}:`)
              matches.forEach((m) =>
                console.log(`    → ${m.name} [${m.dataset}] conf=${parseFloat(m.conf).toFixed(3)}`)
              )
            } else {
              const writeConn = await pool.connect()
              try {
                await linkMatches(writeConn, entity.id, matches)
                totalLinked += matches.length
              } finally {
                writeConn.release()
              }
            }
          }
          processed++
        }

        // Progress every 500 entities
        if (processed % 500 === 0) {
          const pct = ((processed / total) * 100).toFixed(1)
          process.stdout.write(
            `\r  Progress: ${processed}/${total} (${pct}%) — matches found: ${totalMatches}  `
          )
        }
      }

      offset += entities.length
    } finally {
      batchClient.release()
    }
  }

  console.log(`\n\nDone.`)
  console.log(`  Entities processed : ${processed}`)
  console.log(`  ICIJ matches found : ${totalMatches}`)
  if (!DRY_RUN) console.log(`  Matches linked     : ${totalLinked}`)

  await pool.end()
}

main().catch((err) => {
  console.error(err)
  pool.end().catch(() => {})
  process.exit(1)
})

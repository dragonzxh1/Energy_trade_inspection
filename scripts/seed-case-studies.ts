/**
 * Seed script: imports 100 OFAC/DOJ case seeds into seo_content table,
 * then generates narrative / FAQ / meta / structured_data via Qwen LLM.
 *
 * Usage:
 *   npx tsx scripts/seed-case-studies.ts
 */

import fs from 'fs'
import path from 'path'
import { db } from '../src/lib/server/db'
import { generateCaseContent } from '../src/lib/server/seo-content-generator'
import { upsertSeoContent } from '../src/lib/server/seo-repository'

interface RawCaseSeed {
  slug: string
  title: string
  year: number
  entities: string[]
  industry_focus: string
  amount_usd: number | null
  source_kind: 'official' | 'OFAC SDN designation' | 'DOJ press release'
  source_urls: string[]
  verified_facts: string[]
  risk_types: string[]
  legal_disclaimer: string
}

async function main() {
  const seedPath = path.join(process.cwd(), 'data', 'seed-cases.json')
  const rawSeeds: RawCaseSeed[] = JSON.parse(fs.readFileSync(seedPath, 'utf8'))

  console.log(`Found ${rawSeeds.length} case seeds. Starting import...\n`)

  let success = 0
  let failed = 0
  let skipped = 0

  for (let i = 0; i < rawSeeds.length; i++) {
    const seed = rawSeeds[i]
    console.log(`[${i + 1}/${rawSeeds.length}] Processing: ${seed.slug}`)

    try {
      // Generate AI content
      const generated = await generateCaseContent(seed)

      await upsertSeoContent({
        slug: seed.slug,
        content_type: 'case_study',
        title: seed.title,
        year: seed.year,
        verified_facts: seed.verified_facts.map((f, idx) => ({ fact: f, source_index: idx < seed.source_urls.length ? idx : 0 })),
        source_urls: seed.source_urls,
        source_level: 'official',
        source_kind: seed.source_kind,
        risk_types: seed.risk_types,
        entities: seed.entities,
        industry_focus: seed.industry_focus,
        amount_usd: seed.amount_usd,
        legal_disclaimer: seed.legal_disclaimer,
        narrative: generated.narrative,
        meta_description: generated.meta_description,
        meta_keywords: generated.meta_keywords,
        faq: generated.faq,
        structured_data: generated.structured_data,
        published: true,
      })

      success++
      console.log(`  -> OK (${seed.source_kind})`)
    } catch (err) {
      console.error(`  -> FAILED:`, err instanceof Error ? err.message : String(err))
      failed++
    }
  }

  console.log(`\n=== Import Complete ===`)
  console.log(`Success: ${success}`)
  console.log(`Failed:  ${failed}`)
  console.log(`Skipped: ${skipped}`)

  await db.end()
  process.exit(failed > 0 ? 1 : 0)
}

main()

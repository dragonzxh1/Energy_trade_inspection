import assert from 'node:assert/strict'
import test from 'node:test'
import { buildQuickQuery } from '../dist/quick-research.js'

const base = {
  market_date: '2026-08-01',
  source_dossiers: [],
  claims_to_verify: [{ claim_text: 'The EIA publishes a weekly petroleum report.' }],
  research_questions: ['Find the official report page.'],
  allowed_source_tiers: [1],
  max_queries: 1,
  max_pages: 1,
  max_workers: 1,
  timeout_seconds: 60,
}

test('quick query prefers the research question and requests an official source', () => {
  assert.equal(buildQuickQuery(base), 'Find the official report page. official source')
})

test('quick query falls back to the claim text', () => {
  assert.equal(buildQuickQuery({ ...base, research_questions: [], allowed_source_tiers: [1, 2] }), base.claims_to_verify[0].claim_text)
})

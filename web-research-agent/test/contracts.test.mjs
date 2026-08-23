import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isJsonSchemaEcho,
  normalizeAgentEvidence,
  parseAgentJson,
  publicHost,
  selectAgentOutput,
} from '../dist/contracts.js'

test('blocks private and loopback hosts', () => {
  assert.equal(publicHost('127.0.0.1'), false)
  assert.equal(publicHost('192.168.1.8'), false)
  assert.equal(publicHost('www.reuters.com'), true)
})

test('drops evidence with unsafe URLs', () => {
  const result = normalizeAgentEvidence({ evidence: [
    { canonical_url: 'http://127.0.0.1/admin', evidence_text: 'private', page_text: 'private' },
    { canonical_url: 'https://www.reuters.com/world/example', evidence_text: 'Oil output fell.', page_text: 'Update: Oil output fell. More.' },
  ] })
  assert.equal(result.evidence.length, 1)
})

test('drops search snippets that are absent from scraped page text', () => {
  const result = normalizeAgentEvidence({ evidence: [
    {
      canonical_url: 'https://www.reuters.com/world/example',
      evidence_text: 'Search engine summary invented this sentence.',
      page_text: 'The actual article contains a different statement.',
    },
  ] })
  assert.equal(result.evidence.length, 0)
})

test('parses fenced agent JSON without accepting free text', () => {
  assert.deepEqual(parseAgentJson('```json\n{"evidence":[]}\n```'), { evidence: [] })
  assert.equal(parseAgentJson('not json'), 'not json')
})

test('detects Agent Core schema echoes', () => {
  assert.equal(isJsonSchemaEcho({ type: 'object', properties: { evidence: {} }, required: ['evidence'] }), true)
  assert.equal(isJsonSchemaEcho({ type: 'object', properties: { evidence: {} }, required: ['evidence'], evidence: [] }), true)
  assert.equal(isJsonSchemaEcho({ evidence: [] }), false)
})

test('falls back from stringified schema data to agent text', () => {
  const schema = JSON.stringify({ type: 'object', properties: { evidence: {} }, required: ['evidence'] })
  assert.equal(selectAgentOutput(schema, '{"evidence":[]}'), '{"evidence":[]}')
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactToolResultForModel } from '../vendor/firecrawl-web-agent/agent-core/dist/agent.js'

test('compacts large tool results without invoking getters', () => {
  let getterCalled = false
  const input = {
    markdown: 'x'.repeat(30_000),
    items: Array.from({ length: 30 }, (_, index) => ({ index })),
  }
  Object.defineProperty(input, 'data', {
    enumerable: true,
    get() { getterCalled = true; return ['unsafe'] },
  })
  const output = compactToolResultForModel(input, 24_000)
  assert.equal(getterCalled, false)
  assert.match(output.markdown, /\[truncated\]$/)
  assert.ok(JSON.stringify(output).length < 25_000)
})

test('limits tool-result arrays to twenty items', () => {
  const output = compactToolResultForModel(Array.from({ length: 30 }, (_, index) => index))
  assert.equal(output.length, 20)
})

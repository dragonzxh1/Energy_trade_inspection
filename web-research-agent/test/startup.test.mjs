import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'

test('starts the packaged service and serves healthz', { timeout: 15_000 }, async () => {
  const port = 14318 + Math.floor(Math.random() * 1000)
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      FIRECRAWL_API_KEY: 'test-firecrawl-key',
      DEEPSEEK_FLASH_AGENT_API_KEY: 'test-deepseek-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
  try {
    await Promise.race([
      once(child.stdout, 'data'),
      once(child, 'exit').then(([code]) => { throw new Error(`service exited ${code}: ${stderr}`) }),
    ])
    const response = await fetch(`http://127.0.0.1:${port}/healthz`)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { status: 'ok' })
  } finally {
    child.kill('SIGTERM')
    await once(child, 'exit').catch(() => undefined)
  }
})

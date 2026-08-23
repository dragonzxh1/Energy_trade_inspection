import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { downloadToFile, fetchJson } from './lib/http-client.mjs'

async function startServer(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

test('fetchJson follows every standard redirect status and resolves relative locations', async (t) => {
  const seen = []
  const fixture = await startServer((request, response) => {
    seen.push(request.url)
    if (request.url === '/payload') {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ updated_at: '2026-08-23T12:53:01Z' }))
      return
    }

    const statusCode = Number(request.url.slice(1))
    response.writeHead(statusCode, { Location: '/payload' })
    response.end()
  })
  t.after(fixture.close)

  for (const statusCode of [301, 302, 303, 307, 308]) {
    const payload = await fetchJson(`${fixture.baseUrl}/${statusCode}`)
    assert.equal(payload.updated_at, '2026-08-23T12:53:01Z')
  }
  assert.equal(seen.filter((url) => url === '/payload').length, 5)
})

test('downloadToFile follows a 307 redirect and streams the complete file', async (t) => {
  const fixture = await startServer((request, response) => {
    if (request.url === '/latest.csv') {
      response.writeHead(307, { Location: '/artifact.csv' })
      response.end()
      return
    }
    response.writeHead(200, { 'Content-Type': 'text/csv' })
    response.end('id,name\n1,Example\n')
  })
  t.after(fixture.close)

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'eti-sanctions-http-'))
  const destination = path.join(tempDir, 'targets.csv')
  t.after(() => fs.promises.rm(tempDir, { recursive: true, force: true }))

  const result = await downloadToFile(`${fixture.baseUrl}/latest.csv`, destination)

  assert.equal(result.redirectCount, 1)
  assert.equal(result.bytes, 18)
  assert.equal(await fs.promises.readFile(destination, 'utf8'), 'id,name\n1,Example\n')
})

test('redirects without Location fail clearly', async (t) => {
  const fixture = await startServer((_request, response) => {
    response.writeHead(307)
    response.end()
  })
  t.after(fixture.close)

  await assert.rejects(
    fetchJson(`${fixture.baseUrl}/missing-location`),
    /HTTP 307 without Location/,
  )
})

test('redirect loops stop at the configured limit', async (t) => {
  const fixture = await startServer((_request, response) => {
    response.writeHead(307, { Location: '/loop' })
    response.end()
  })
  t.after(fixture.close)

  await assert.rejects(
    fetchJson(`${fixture.baseUrl}/loop`, { maxRedirects: 2 }),
    /Too many redirects/,
  )
})

test('requests fail after the inactivity timeout', async (t) => {
  const fixture = await startServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, { 'Content-Type': 'application/json' })
      response.end('{}')
    }, 100)
  })
  t.after(fixture.close)

  await assert.rejects(
    fetchJson(`${fixture.baseUrl}/slow`, { timeoutMs: 20 }),
    /Request timed out after 20ms/,
  )
})

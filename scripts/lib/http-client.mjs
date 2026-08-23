import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308])

function parseUrl(value) {
  const url = value instanceof URL ? value : new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${url.protocol}`)
  }
  return url
}

export function requestWithRedirects(url, options = {}) {
  const {
    headers = {},
    maxRedirects = 5,
    timeoutMs = 30_000,
  } = options

  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error('maxRedirects must be a non-negative integer')
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('timeoutMs must be greater than zero')
  }

  const request = (target, redirectCount) => new Promise((resolve, reject) => {
    const targetUrl = parseUrl(target)
    const client = targetUrl.protocol === 'https:' ? https : http
    const req = client.get(targetUrl, { headers }, (response) => {
      const statusCode = response.statusCode ?? 0
      if (!REDIRECT_STATUS_CODES.has(statusCode)) {
        resolve({ response, finalUrl: targetUrl.toString(), redirectCount })
        return
      }

      const location = response.headers.location
      response.resume()

      if (!location) {
        reject(new Error(`HTTP ${statusCode} without Location fetching ${targetUrl}`))
        return
      }
      if (redirectCount >= maxRedirects) {
        reject(new Error(`Too many redirects fetching ${targetUrl}`))
        return
      }

      let nextUrl
      try {
        nextUrl = parseUrl(new URL(location, targetUrl))
      } catch (error) {
        reject(new Error(`Invalid redirect URL from ${targetUrl}: ${location}`, { cause: error }))
        return
      }

      if (targetUrl.protocol === 'https:' && nextUrl.protocol !== 'https:') {
        reject(new Error(`Refusing HTTPS downgrade redirect from ${targetUrl} to ${nextUrl}`))
        return
      }

      resolve(request(nextUrl, redirectCount + 1))
    })

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${timeoutMs}ms fetching ${targetUrl}`))
    })
    req.once('error', reject)
  })

  return request(parseUrl(url), 0)
}

function requireSuccess(response, finalUrl) {
  if (response.statusCode === 200) return
  const statusCode = response.statusCode ?? 'unknown'
  response.resume()
  throw new Error(`HTTP ${statusCode} fetching ${finalUrl}`)
}

export async function fetchJson(url, options = {}) {
  const { response, finalUrl } = await requestWithRedirects(url, options)
  requireSuccess(response, finalUrl)

  response.setEncoding('utf8')
  let body = ''
  for await (const chunk of response) body += chunk

  try {
    return JSON.parse(body)
  } catch (error) {
    throw new Error(`Invalid JSON from ${finalUrl}`, { cause: error })
  }
}

export async function downloadToFile(url, destination, options = {}) {
  const { onProgress, ...requestOptions } = options
  const { response, finalUrl, redirectCount } = await requestWithRedirects(url, requestOptions)
  requireSuccess(response, finalUrl)

  let bytes = 0
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length
      onProgress?.(bytes)
      callback(null, chunk)
    },
  })

  try {
    await pipeline(response, progress, fs.createWriteStream(destination))
  } catch (error) {
    await fs.promises.rm(destination, { force: true }).catch(() => {})
    throw error
  }

  return { bytes, finalUrl, redirectCount }
}

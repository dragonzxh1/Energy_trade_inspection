import fs from 'node:fs'
import path from 'node:path'

const unsafe = 'const count = Array.isArray(data.data) ? data.data.length : Array.isArray(data.web) ? data.web.length : 0;'
const safe = 'const count = Array.isArray(data.web) ? data.web.length : Object.prototype.hasOwnProperty.call(data, "data") && Array.isArray(data.data) ? data.data.length : 0;'

const candidates = [
  path.resolve('node_modules/firecrawl-aisdk/dist/index.js'),
  path.resolve('vendor/firecrawl-web-agent/agent-core/node_modules/firecrawl-aisdk/dist/index.js'),
]
const files = candidates.filter((file) => fs.existsSync(file))
if (files.length === 0) throw new Error('firecrawl-aisdk runtime not found')

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  if (source.includes(safe)) continue
  if (!source.includes(unsafe)) throw new Error(`Unsupported firecrawl-aisdk search result implementation: ${file}`)
  fs.writeFileSync(file, source.replace(unsafe, safe))
}

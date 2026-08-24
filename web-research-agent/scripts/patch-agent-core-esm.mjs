import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.argv[2] || 'vendor/firecrawl-web-agent/agent-core/dist')

function runtimeSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.') || path.extname(specifier)) return specifier
  const resolved = path.resolve(path.dirname(fromFile), specifier)
  if (fs.existsSync(`${resolved}.js`)) return `${specifier}.js`
  if (fs.existsSync(path.join(resolved, 'index.js'))) return `${specifier.replace(/\/$/, '')}/index.js`
  return specifier
}

function patchFile(file) {
  const source = fs.readFileSync(file, 'utf8')
  const patched = source
    .replace(/(\bfrom\s+["'])(\.{1,2}\/[^"']+)(["'])/g, (_match, prefix, specifier, suffix) => (
      `${prefix}${runtimeSpecifier(file, specifier)}${suffix}`
    ))
    .replace(/(\bimport\s*\(\s*["'])(\.{1,2}\/[^"']+)(["']\s*\))/g, (_match, prefix, specifier, suffix) => (
      `${prefix}${runtimeSpecifier(file, specifier)}${suffix}`
    ))
  if (patched !== source) fs.writeFileSync(file, patched)
}

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (entry.isFile() && entry.name.endsWith('.js')) patchFile(file)
  }
}

if (!fs.existsSync(root)) throw new Error(`Agent Core dist directory not found: ${root}`)
walk(root)

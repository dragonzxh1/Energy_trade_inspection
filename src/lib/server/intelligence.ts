/**
 * Entity intelligence TypeScript wrapper for the Python intelligence package.
 *
 * Calls intelligence/cli.py via child_process.execFile() and parses JSON stdout.
 * The Python venv must be set up:
 *   py -3.11 -m venv .venv
 *   .venv/Scripts/pip install -r intelligence/requirements.txt
 *   .venv/Scripts/scrapling install
 *
 * Set TAVILY_API_KEY in .env.local for real results (mock used if absent).
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// Resolve paths relative to project root
const ROOT        = process.cwd()
const PYTHON      = process.platform === 'win32'
  ? path.join(ROOT, '.venv', 'Scripts', 'python.exe')
  : path.join(ROOT, '.venv', 'bin', 'python')
const CLI_SCRIPT  = path.join(ROOT, 'intelligence', 'cli.py')
const TIMEOUT_MS  = 30_000  // 30 s default; stealth/dynamic modes need more

// ─── Startup validation ───────────────────────────────────────────────────────

if (!existsSync(PYTHON)) {
  const fixCmd = process.platform === 'win32'
    ? 'py -3.11 -m venv .venv && .venv\\Scripts\\pip install -r intelligence/requirements.txt'
    : 'python3.11 -m venv .venv && .venv/bin/pip install -r intelligence/requirements.txt'
  console.error(
    `[intelligence] Python binary not found at ${PYTHON}. ` +
    `Run: ${fixCmd}`
  )
}

// 鈹€鈹€鈹€ Types 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export interface TavilyResult {
  title:          string
  url:            string
  domain:         string
  snippet:        string
  provider_score: number | null
}

export interface CompanyIntelligence {
  name:                string
  country:             string | null
  registration_number: string | null
  sanctions_hits:      TavilyResult[]
  corporate_info:      TavilyResult[]
  risk_signals:        TavilyResult[]
  scraped_content:     { url: string; html_length: number; html_preview: string }[]
}

export interface VesselIntelligence {
  imo:                 string
  vessel_name:         string | null
  flag:                string | null
  sanctions_hits:      TavilyResult[]
  port_state_control:  TavilyResult[]
  tracking_info:       TavilyResult[]
}

export interface TerminalIntelligence {
  name:            string
  location:        string | null
  operator:        string | null
  sanctions_hits:  TavilyResult[]
  existence_check: TavilyResult[]
  ownership_info:  TavilyResult[]
  risk_signals:    TavilyResult[]
}

export interface AuthenticitySignals {
  web_presence_score: number
  signals:            string[]
  top_results:        TavilyResult[]
}

// 鈹€鈹€鈹€ Core runner 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async function runCli<T>(
  args: string[],
  timeoutMs = TIMEOUT_MS,
): Promise<T | null> {
  try {
    const { stdout } = await execFileAsync(PYTHON, [CLI_SCRIPT, ...args], {
      timeout: timeoutMs,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      maxBuffer: 10 * 1024 * 1024,  // 10 MB stdout buffer
    })
    const parsed = JSON.parse(stdout)
    if (parsed?.error) {
      console.error('[intelligence] CLI error:', parsed.error)
      return null
    }
    return parsed as T
  } catch (err) {
// Log but never throw because intelligence is supplemental and non-blocking.
    console.error('[intelligence] CLI failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// 鈹€鈹€鈹€ Public API 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

/**
 * Research a company: sanctions news, corporate info, risk signals.
 * Returns null on error (does not throw).
 */
export async function researchCompany(
  name: string,
  options: {
    country?:            string
    registrationNumber?: string
    maxResults?:         number
    scrape?:             boolean
  } = {},
): Promise<CompanyIntelligence | null> {
  const args = ['company', '--name', name]
  if (options.country)            args.push('--country', options.country)
  if (options.registrationNumber) args.push('--reg', options.registrationNumber)
  if (options.maxResults)         args.push('--max-results', String(options.maxResults))
  if (options.scrape)             args.push('--scrape')
  return runCli<CompanyIntelligence>(args, 60_000)
}

/**
 * Research a vessel: sanctions news, port state control, AIS tracking.
 * Returns null on error (does not throw).
 */
export async function researchVessel(
  imo: string,
  options: {
    vesselName?: string
    flag?:       string
    maxResults?: number
  } = {},
): Promise<VesselIntelligence | null> {
  const args = ['vessel', '--imo', imo]
  if (options.vesselName) args.push('--name', options.vesselName)
  if (options.flag)       args.push('--flag', options.flag)
  if (options.maxResults) args.push('--max-results', String(options.maxResults))
  return runCli<VesselIntelligence>(args, 60_000)
}

/**
 * Research a storage terminal / tank farm.
 * Returns null on error (does not throw).
 */
export async function researchTerminal(
  name: string,
  options: {
    location?: string
    operator?: string
    maxResults?: number
  } = {},
): Promise<TerminalIntelligence | null> {
  const args = ['terminal', '--name', name]
  if (options.location)   args.push('--location', options.location)
  if (options.operator)   args.push('--operator', options.operator)
  if (options.maxResults) args.push('--max-results', String(options.maxResults))
  return runCli<TerminalIntelligence>(args, 60_000)
}

/**
 * Quick web-presence check for an entity.
 * Returns a 0-100 score plus a signal list. Returns null on error.
 */
export async function getAuthenticitySignals(
  name: string,
  type: 'company' | 'vessel' | 'person' = 'company',
): Promise<AuthenticitySignals | null> {
  return runCli<AuthenticitySignals>(['signals', '--name', name, '--type', type])
}

/**
 * Fetch HTML from a URL via Scrapling.
 * Returns null on error.
 */
export async function scrapeUrl(
  url: string,
  mode: 'basic' | 'stealth' | 'dynamic' = 'basic',
  timeoutSecs = 30,
): Promise<{ url: string; mode: string; html_length: number; html: string } | null> {
  return runCli(
    ['scrape', '--url', url, '--mode', mode, '--timeout', String(timeoutSecs)],
    (timeoutSecs + 10) * 1000,
  )
}


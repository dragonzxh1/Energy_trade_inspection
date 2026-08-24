import crypto from 'node:crypto'
import express from 'express'
import { createAgent } from '@firecrawl/agent-core'
import {
  ResearchEvidenceSchema,
  ResearchRequest,
  normalizeAgentEvidence,
  parseAgentJson,
  selectAgentOutput,
} from './contracts.js'
import { runQuickResearch } from './quick-research.js'

const port = Number(process.env.PORT || 4318)
const host = process.env.HOST || '127.0.0.1'
const firecrawlApiKey = process.env.FIRECRAWL_API_KEY || ''
const deepseekApiKey = process.env.DEEPSEEK_FLASH_AGENT_API_KEY || ''
const deepseekBaseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'
const deepseekModel = process.env.DEEPSEEK_FLASH_MODEL || 'deepseek-v4-flash'

if (!firecrawlApiKey || !deepseekApiKey) {
  throw new Error('FIRECRAWL_API_KEY and DEEPSEEK_FLASH_AGENT_API_KEY are required')
}

const researchRoles = [
  {
    id: 'official_sources', name: 'Official source verifier',
    description: 'Government, regulator, company, exchange, port and international-organization sources.',
    instructions: 'Prefer primary announcements. Extract exact evidence and dates. Do not infer missing facts.',
  },
  {
    id: 'industry_media', name: 'Industry media verifier',
    description: 'Professional price reporting and major established media.',
    instructions: 'Verify the supplied claims and preserve attribution and uncertainty language.',
  },
  {
    id: 'timeline', name: 'Event timeline verifier',
    description: 'Separate event date, publication date and later updates.',
    instructions: 'Build evidence-backed chronology only. Do not merge different market dates.',
  },
  {
    id: 'counterevidence', name: 'Counterevidence verifier',
    description: 'Find denials, corrections, conflicting figures and contrary accounts.',
    instructions: 'Actively search for evidence that refutes or limits the supplied claims.',
  },
]

function createResearchAgent(maxWorkers: number, maxSteps: number, quickMode: boolean) {
  return createAgent({
    firecrawlApiKey,
    model: { provider: 'openai', model: deepseekModel, baseURL: deepseekBaseUrl },
    subAgentModel: { provider: 'openai', model: deepseekModel, baseURL: deepseekBaseUrl },
    apiKeys: { openai: deepseekApiKey },
    firecrawlOptions: {
      search: {}, scrape: {}, interact: false, map: false, crawl: false,
      bash: false, maxResponseTokens: 6_000,
    },
    maxSteps,
    maxWorkers: quickMode ? 1 : maxWorkers,
    workerMaxSteps: Math.min(6, Math.max(3, maxSteps - 1)),
    appSections: [
      'Verify claims using only search and one targeted scrape. Do not delegate. Do not repeat a tool call. Return concise schema-valid evidence with exact URLs and verbatim passages.',
    ],
  })
}

async function withTimeout<T>(promise: Promise<T>, timeoutSeconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`RESEARCH_TIMEOUT:${timeoutSeconds}`)), timeoutSeconds * 1000)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const runs = new Map<string, Record<string, unknown>>()
const app = express()
app.use(express.json({ limit: '5mb' }))

app.get('/healthz', (_request, response) => response.json({ status: 'ok' }))

app.post('/v1/research/run', async (request, response) => {
  const parsed = ResearchRequest.safeParse(request.body)
  if (!parsed.success) {
    return response.status(400).json({ error: 'INVALID_RESEARCH_REQUEST', details: parsed.error.issues })
  }
  const input = parsed.data
  const runId = `WEBRUN-${crypto.randomUUID()}`
  const started = Date.now()
  const record: Record<string, unknown> = { run_id: runId, status: 'running', started_at: new Date().toISOString() }
  runs.set(runId, record)
  try {
    const quickMode = input.max_queries <= 4 && input.max_pages <= 8
    if (quickMode) {
      const quick = await withTimeout(runQuickResearch(input, {
        firecrawlApiKey,
        deepseekApiKey,
        deepseekBaseUrl,
        deepseekModel,
      }), input.timeout_seconds)
      const completed = {
        ...quick,
        run_id: runId,
        status: 'completed',
        duration_ms: Date.now() - started,
      }
      runs.set(runId, completed)
      return response.json(completed)
    }
    const maxSteps = quickMode ? 4 : Math.min(16, Math.max(6, input.max_queries + Math.ceil(input.max_pages / 4)))
    const agent = createResearchAgent(input.max_workers, maxSteps, quickMode)
    const result = await withTimeout(agent.run({
      prompt: [
        `Research energy-market claims for market date ${input.market_date}.`,
        'Your primary job is verification. Discovery of additional facts is secondary.',
        'Never treat a search-result snippet, aggregator, social post, or AI summary as evidence.',
        'Open and scrape the original page. evidence_text must be a verbatim contiguous passage from page_text.',
        'Use one search and at most one targeted scrape in quick mode. Never repeat an equivalent tool call.',
        'page_text must contain only the relevant surrounding passage, never the entire page, and must be at most 6000 characters.',
        'Keep event_date, published_at, retrieved_at, and market_date separate.',
        'A conclusion is not evidence. Return atomic fact candidates only when the page passage directly supports them.',
        `Use at most ${input.max_queries} searches and ${input.max_pages} scraped pages.`,
        `Source dossiers: ${JSON.stringify(input.source_dossiers)}`,
        `Claims to verify: ${JSON.stringify(input.claims_to_verify)}`,
        `Research questions: ${JSON.stringify(input.research_questions)}`,
      ].join('\n\n'),
      schema: ResearchEvidenceSchema,
      format: 'json',
      maxSteps,
      skills: [],
      subAgents: (quickMode ? [] : researchRoles.slice(0, input.max_workers)).map((role) => ({
        ...role,
        model: { provider: 'openai', model: deepseekModel, baseURL: deepseekBaseUrl },
        tools: ['search', 'scrapeBash'], skills: [], maxSteps: 8,
      })),
    }), input.timeout_seconds)
    const output = selectAgentOutput(result.data, result.text)
    const parsedOutput = parseAgentJson(output)
    const raw = typeof parsedOutput === 'string'
      ? { evidence: [], research_summary: '', query_count: 0, page_count: 0, warnings: ['INVALID_AGENT_JSON'] }
      : parsedOutput
    const normalized = normalizeAgentEvidence(raw)
    const completed = {
      ...normalized,
      run_id: runId,
      status: 'completed',
      duration_ms: Date.now() - started,
      token_count: result.usage.totalTokens,
    }
    runs.set(runId, completed)
    return response.json(completed)
  } catch (error) {
    const failed = {
      run_id: runId, status: 'failed', evidence: [],
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
    runs.set(runId, failed)
    return response.status(String(failed.error).startsWith('RESEARCH_TIMEOUT:') ? 504 : 502).json(failed)
  }
})

app.get('/v1/research/runs/:runId', (request, response) => {
  const run = runs.get(request.params.runId)
  if (!run) return response.status(404).json({ error: 'RESEARCH_RUN_NOT_FOUND' })
  return response.json(run)
})

app.listen(port, host, () => {
  process.stdout.write(`ETI web research agent listening on http://${host}:${port}\n`)
})

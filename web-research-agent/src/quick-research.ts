import Firecrawl from '@mendable/firecrawl-js'
import { ResearchRequestType, normalizeAgentEvidence, parseAgentJson, publicHost } from './contracts.js'

type SearchEntry = { url?: string; title?: string; description?: string }
type DeepSeekUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }

export type QuickResearchResult = Record<string, unknown> & {
  evidence: unknown[]
  research_summary: string
  query_count: number
  page_count: number
  warnings: string[]
  token_count: number
}

function normalizedText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function buildQuickQuery(input: ResearchRequestType): string {
  const question = input.research_questions[0]
    || String(input.claims_to_verify[0]?.claim_text || '')
    || String(input.source_dossiers[0]?.central_question || '')
  const official = input.allowed_source_tiers.length === 1 && input.allowed_source_tiers[0] === 1
    ? ' official source'
    : ''
  return `${question}${official}`.trim().slice(0, 500)
}

function safeSearchEntries(value: unknown): SearchEntry[] {
  if (!value || typeof value !== 'object') return []
  const web = (value as Record<string, unknown>).web
  if (!Array.isArray(web)) return []
  return web.filter((item): item is SearchEntry => {
    if (!item || typeof item !== 'object') return false
    const url = String((item as SearchEntry).url || '')
    try {
      const parsed = new URL(url)
      return ['http:', 'https:'].includes(parsed.protocol) && publicHost(parsed.hostname)
    } catch {
      return false
    }
  }).slice(0, 4)
}

function evidenceWindow(pageText: string, evidenceText: string): string | null {
  const page = normalizedText(pageText)
  const evidence = normalizedText(evidenceText)
  const index = page.indexOf(evidence)
  if (index < 0 || !evidence) return null
  const start = Math.max(0, index - 1_500)
  const end = Math.min(page.length, index + evidence.length + 1_500)
  return page.slice(start, end)
}

function compactPage(markdown: unknown, maxCharacters = 8_000): string {
  return normalizedText(markdown).slice(0, maxCharacters)
}

async function structureEvidence(
  input: ResearchRequestType,
  url: string,
  title: string,
  pageText: string,
  deepseekApiKey: string,
  deepseekBaseUrl: string,
  deepseekModel: string,
): Promise<{ raw: Record<string, unknown>; usage: DeepSeekUsage }> {
  const response = await fetch(`${deepseekBaseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${deepseekApiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: deepseekModel,
      temperature: 0.1,
      max_tokens: 3_000,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Extract only directly supported evidence from the supplied scraped page.',
            'Do not output reasoning or think tags. Return the JSON object immediately.',
            'Return one JSON object with keys evidence, research_summary, warnings. Return at most three evidence items.',
            'Each evidence item must contain canonical_url, source_title, source_publisher, source_tier (1-3), relationship (supports|refutes|updates|contextualizes), claim_text, evidence_text, published_at, event_date, supporting_internal_fact_ids, fact.',
            'evidence_text must be one short verbatim contiguous passage copied from PAGE_TEXT.',
            'Use null for unknown dates and fact. Never use search snippets or model memory.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            market_date: input.market_date,
            claims_to_verify: input.claims_to_verify,
            research_questions: input.research_questions,
            allowed_source_tiers: input.allowed_source_tiers,
            canonical_url: url,
            source_title: title,
            page_text: pageText,
          }),
        },
      ],
    }),
  })
  if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`)
  const payload = await response.json() as Record<string, unknown>
  const choices = Array.isArray(payload.choices) ? payload.choices : []
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as Record<string, unknown>).message
    : undefined
  const content = message && typeof message === 'object'
    ? (message as Record<string, unknown>).content
    : undefined
  const parsed = parseAgentJson(content)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const finishReason = choices[0] && typeof choices[0] === 'object'
      ? String((choices[0] as Record<string, unknown>).finish_reason || '')
      : ''
    throw new Error(`DEEPSEEK_INVALID_JSON:length=${String(content || '').length};finish=${finishReason || 'unknown'}`)
  }
  return { raw: parsed as Record<string, unknown>, usage: (payload.usage || {}) as DeepSeekUsage }
}

export async function runQuickResearch(
  input: ResearchRequestType,
  config: {
    firecrawlApiKey: string
    deepseekApiKey: string
    deepseekBaseUrl: string
    deepseekModel: string
  },
): Promise<QuickResearchResult> {
  const client = new Firecrawl({ apiKey: config.firecrawlApiKey })
  const query = buildQuickQuery(input)
  const search = await client.search(query, { sources: ['web'], limit: Math.min(4, input.max_pages) })
  const entries = safeSearchEntries(search)
  if (!entries.length) {
    return { evidence: [], research_summary: '', query_count: 1, page_count: 0, warnings: ['NO_PUBLIC_SEARCH_RESULT'], token_count: 0 }
  }
  const target = entries[0]
  const url = String(target.url)
  const document = await client.scrape(url, { formats: ['markdown'], onlyMainContent: true })
  const pageText = compactPage((document as Record<string, unknown>).markdown)
  if (!pageText) {
    return { evidence: [], research_summary: '', query_count: 1, page_count: 1, warnings: ['EMPTY_SCRAPED_PAGE'], token_count: 0 }
  }
  const structured = await structureEvidence(
    input, url, String(target.title || url), pageText,
    config.deepseekApiKey, config.deepseekBaseUrl, config.deepseekModel,
  )
  const candidates = Array.isArray(structured.raw.evidence) ? structured.raw.evidence : []
  const evidence = candidates.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const candidate = item as Record<string, unknown>
    const window = evidenceWindow(pageText, String(candidate.evidence_text || ''))
    if (!window || String(candidate.canonical_url || '') !== url) return []
    const sourceTier = Number(candidate.source_tier)
    if (!input.allowed_source_tiers.includes(sourceTier)) return []
    return [{
      ...candidate,
      canonical_url: url,
      source_title: String(candidate.source_title || target.title || url),
      page_text: window,
      retrieved_at: new Date().toISOString(),
      supporting_internal_fact_ids: Array.isArray(candidate.supporting_internal_fact_ids)
        ? candidate.supporting_internal_fact_ids
        : [],
      fact: candidate.fact && typeof candidate.fact === 'object' ? candidate.fact : null,
    }]
  })
  const normalized = normalizeAgentEvidence({
    evidence,
    research_summary: String(structured.raw.research_summary || ''),
    query_count: 1,
    page_count: 1,
    warnings: Array.isArray(structured.raw.warnings) ? structured.raw.warnings.map(String) : [],
  })
  return {
    ...(normalized as QuickResearchResult),
    evidence: Array.isArray(normalized.evidence) ? normalized.evidence : [],
    research_summary: String(normalized.research_summary || ''),
    query_count: 1,
    page_count: 1,
    warnings: Array.isArray(normalized.warnings) ? normalized.warnings.map(String) : [],
    token_count: Number(structured.usage.total_tokens || 0),
  }
}

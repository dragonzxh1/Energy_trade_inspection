import { z } from 'zod'

export const ResearchRequest = z.object({
  market_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_dossiers: z.array(z.record(z.string(), z.unknown())),
  claims_to_verify: z.array(z.record(z.string(), z.unknown())),
  research_questions: z.array(z.string()).max(8),
  allowed_source_tiers: z.array(z.number().int().min(1).max(3)).default([1, 2]),
  max_queries: z.number().int().min(1).max(12).default(12),
  max_pages: z.number().int().min(1).max(30).default(30),
  max_workers: z.number().int().min(1).max(4).default(4),
  timeout_seconds: z.number().int().min(30).max(480).default(480),
})

export type ResearchRequestType = z.infer<typeof ResearchRequest>

export const ResearchEvidenceSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          canonical_url: { type: 'string' },
          source_title: { type: 'string' },
          source_publisher: { type: 'string' },
          source_tier: { type: 'integer', minimum: 1, maximum: 3 },
          relationship: { type: 'string', enum: ['supports', 'refutes', 'updates', 'contextualizes'] },
          claim_text: { type: 'string' },
          evidence_text: { type: 'string', maxLength: 2000 },
          page_text: { type: 'string', maxLength: 6000 },
          published_at: { type: ['string', 'null'] },
          event_date: { type: ['string', 'null'] },
          retrieved_at: { type: 'string' },
          supporting_internal_fact_ids: { type: 'array', items: { type: 'string' } },
          fact: {
            type: ['object', 'null'],
            additionalProperties: true
          }
        },
        required: [
          'canonical_url', 'source_title', 'source_publisher', 'source_tier',
          'relationship', 'claim_text', 'evidence_text', 'retrieved_at',
          'page_text', 'supporting_internal_fact_ids', 'fact'
        ]
      }
    },
    research_summary: { type: 'string', maxLength: 2000 },
    query_count: { type: 'integer' },
    page_count: { type: 'integer' },
    warnings: { type: 'array', items: { type: 'string' } }
  },
  required: ['evidence', 'research_summary', 'query_count', 'page_count', 'warnings']
} as const

export function publicHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/\.$/, '')
  if (normalized === 'localhost' || normalized.endsWith('.local')) return false
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(normalized)) return false
  const match = normalized.match(/^172\.(\d+)\./)
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false
  return true
}

function normalizedText(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function normalizeAgentEvidence(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return { evidence: [], warnings: ['EMPTY_AGENT_OUTPUT'] }
  const source = value as Record<string, unknown>
  const evidence = Array.isArray(source.evidence) ? source.evidence.filter((item) => {
    if (!item || typeof item !== 'object') return false
    const candidate = item as Record<string, unknown>
    const url = String(candidate.canonical_url || '')
    try {
      const parsed = new URL(url)
      const evidenceText = normalizedText(candidate.evidence_text)
      const pageText = normalizedText(candidate.page_text)
      return ['http:', 'https:'].includes(parsed.protocol)
        && publicHost(parsed.hostname)
        && evidenceText.length > 0
        && pageText.includes(evidenceText)
    } catch {
      return false
    }
  }) : []
  return { ...source, evidence }
}

export function parseAgentJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const cleaned = value
    .replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  try { return JSON.parse(cleaned) } catch { /* try the outermost object below */ }
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { return value }
  }
  return value
}

export function isJsonSchemaEcho(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate.type === 'object'
    && candidate.properties !== null
    && typeof candidate.properties === 'object'
    && Array.isArray(candidate.required)
}

export function selectAgentOutput(data: unknown, text: unknown): unknown {
  const parsedData = parseAgentJson(data)
  return data !== undefined && !isJsonSchemaEcho(parsedData) ? parsedData : text
}

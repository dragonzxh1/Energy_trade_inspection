/**
 * Entity extractor — uses Qwen LLM via DashScope OpenAI-compatible API
 * to extract structured entities (companies, persons, vessels) from contract text.
 */

import OpenAI from 'openai'

/** Thrown when the Qwen API call fails (network error, timeout, auth, etc.).
 *  Distinct from the LLM returning an empty or unparseable response. */
export class EntityExtractionError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'EntityExtractionError'
  }
}

export interface ExtractedEntity {
  type: 'company' | 'person' | 'vessel'
  name: string
  passport?: string  // passport/ID number (persons only)
  imo?: string       // IMO number (vessels only)
  context?: string   // brief excerpt from the contract
}

/**
 * Trade parameters extracted from a contract document.
 * Used to feed the trade rules engine as part of the Screen → Trade loop.
 */
export interface ExtractedTradeParams {
  seller?: string       // Seller / exporter / supplier company name
  vessel?: string       // Vessel name as it appears in the contract
  imo?: string          // 7-digit IMO number if mentioned
  loadingPort?: string  // UN/LOCODE (e.g. SGSIN) or port name (e.g. Fujairah)
  commodity?: string    // e.g. "Fuel Oil 380 cst", "Crude Oil", "LNG"
  tradeDate?: string    // ISO date (YYYY-MM-DD) or as extracted from contract
  confidence: 'high' | 'medium' | 'low'
}

const qwen = new OpenAI({
  apiKey: process.env.QWEN_API_KEY!,
  baseURL: process.env.QWEN_BASE_URL!,
})

const SYSTEM_PROMPT = `You are a trade contract entity extractor for energy trade compliance.
Extract all counterparty companies, individuals (directors/officers), and vessels from the provided contract text.

Return ONLY a JSON object with this exact structure:
{
  "entities": [
    {
      "type": "company",
      "name": "entity name as it appears in the contract",
      "context": "brief excerpt (under 100 chars) showing where this entity appears"
    },
    {
      "type": "person",
      "name": "full name as it appears",
      "passport": "passport or ID number if mentioned, otherwise omit",
      "context": "brief excerpt"
    },
    {
      "type": "vessel",
      "name": "vessel name as it appears",
      "imo": "IMO number (7 digits only) if mentioned, otherwise omit",
      "context": "brief excerpt"
    }
  ]
}

Focus on:
- Companies: buyers, sellers, charterers, owners, operators, guarantors, brokers
- Persons: directors, officers, authorized signatories, beneficial owners
- Vessels: named ships with or without IMO numbers

Rules:
- Include each unique entity once (deduplicate by name)
- Only include entities explicitly named in the text — do not infer or guess
- For IMO numbers, extract only the 7-digit number
- Keep context excerpts under 100 characters`

const TRADE_PARAMS_PROMPT = `You are a trade contract parameter extractor for energy trade compliance.
Extract the key trade parameters from the provided contract text.

Return ONLY a JSON object with this exact structure:
{
  "seller": "full legal name of the seller/exporter/supplier (company, not person)",
  "vessel": "vessel name as it appears in the contract",
  "imo": "7-digit IMO number if explicitly mentioned, otherwise omit",
  "loadingPort": "UN/LOCODE (5-char, e.g. SGSIN) or port name if LOCODE not available",
  "commodity": "commodity description e.g. Fuel Oil 380 cst, Crude Oil, LNG",
  "tradeDate": "trade/shipment date in YYYY-MM-DD format if mentioned, otherwise omit",
  "confidence": "high if all main fields found, medium if partial, low if very little found"
}

Rules:
- seller must be a company name, not a person name
- Only include fields explicitly stated in the contract — do not infer or guess
- If a field is not found, omit it from the response
- confidence: high = seller + vessel + port all found; medium = at least seller + vessel; low = only one or none`

/**
 * Extract trade parameters (seller, vessel, port, commodity, date) from contract text.
 * Returns null if the LLM cannot extract meaningful trade parameters.
 * Best-effort: partial results are returned even if not all fields are present.
 */
export async function extractTradeParams(text: string): Promise<ExtractedTradeParams | null> {
  const truncated =
    text.length > 8000 ? text.slice(0, 8000) + '\n[... document truncated]' : text

  let response: Awaited<ReturnType<typeof qwen.chat.completions.create>>
  try {
    response = await qwen.chat.completions.create(
      {
        model: 'qwen3.5-plus',
        messages: [
          { role: 'system', content: TRADE_PARAMS_PROMPT },
          {
            role: 'user',
            content: `Extract trade parameters from this contract:\n\n${truncated}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 500,
      },
      { signal: AbortSignal.timeout(20_000) },
    )
  } catch (err) {
    console.error('[entity-extractor] Trade params API call failed:', err)
    return null  // best-effort: don't fail the whole screening
  }

  try {
    const content = response.choices[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content) as Partial<ExtractedTradeParams>

    // Need at least one meaningful field
    if (!parsed.seller && !parsed.vessel) return null

    return {
      seller:      typeof parsed.seller      === 'string' ? parsed.seller.trim()      : undefined,
      vessel:      typeof parsed.vessel      === 'string' ? parsed.vessel.trim()      : undefined,
      imo:         typeof parsed.imo         === 'string'
        ? parsed.imo.replace(/\D/g, '').slice(0, 7) || undefined
        : undefined,
      loadingPort: typeof parsed.loadingPort === 'string' ? parsed.loadingPort.trim() : undefined,
      commodity:   typeof parsed.commodity   === 'string' ? parsed.commodity.trim()   : undefined,
      tradeDate:   typeof parsed.tradeDate   === 'string' ? parsed.tradeDate.trim()   : undefined,
      confidence:  ['high', 'medium', 'low'].includes(parsed.confidence as string)
        ? (parsed.confidence as ExtractedTradeParams['confidence'])
        : 'low',
    }
  } catch {
    console.error('[entity-extractor] Failed to parse trade params response')
    return null
  }
}

/**
 * Extract structured entities from contract text using Qwen LLM.
 * Returns up to 30 entities sorted by type.
 */
export async function extractEntities(text: string): Promise<ExtractedEntity[]> {
  // Truncate to avoid token limits — keep first 8000 chars of meaningful content
  const truncated =
    text.length > 8000 ? text.slice(0, 8000) + '\n[... document truncated]' : text

  // ── API call (throws EntityExtractionError on failure/timeout) ────────────
  let response: Awaited<ReturnType<typeof qwen.chat.completions.create>>
  try {
    response = await qwen.chat.completions.create(
      {
        model: 'qwen3.5-plus',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Extract all entities from this trade contract:\n\n${truncated}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 2000,
      },
      { signal: AbortSignal.timeout(25_000) },
    )
  } catch (err) {
    console.error('[entity-extractor] API call failed:', err)
    throw new EntityExtractionError('Qwen API call failed or timed out', err)
  }

  // ── Parse response (returns [] if LLM output is malformed) ────────────────
  try {
    const content = response.choices[0]?.message?.content
    if (!content) return []

    const parsed = JSON.parse(content) as { entities?: unknown[] }
    if (!Array.isArray(parsed.entities)) return []

    return parsed.entities
      .filter((e): e is ExtractedEntity => {
        if (typeof e !== 'object' || e === null) return false
        const entity = e as Record<string, unknown>
        return (
          typeof entity.name === 'string' &&
          entity.name.trim().length > 0 &&
          ['company', 'person', 'vessel'].includes(entity.type as string)
        )
      })
      .map((e) => ({
        ...e,
        name: (e.name ?? '').trim(),
        imo: e.imo ? String(e.imo).replace(/\D/g, '').slice(0, 7) || undefined : undefined,
      }))
      .slice(0, 30)
  } catch {
    console.error('[entity-extractor] Failed to parse LLM response')
    return []
  }
}

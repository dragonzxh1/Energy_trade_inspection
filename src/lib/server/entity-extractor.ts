/**
 * Entity extractor — uses Qwen LLM via DashScope OpenAI-compatible API
 * to extract structured entities (companies, persons, vessels) from contract text.
 */

import OpenAI from 'openai'

export interface ExtractedEntity {
  type: 'company' | 'person' | 'vessel'
  name: string
  passport?: string  // passport/ID number (persons only)
  imo?: string       // IMO number (vessels only)
  context?: string   // brief excerpt from the contract
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

/**
 * Extract structured entities from contract text using Qwen LLM.
 * Returns up to 30 entities sorted by type.
 */
export async function extractEntities(text: string): Promise<ExtractedEntity[]> {
  // Truncate to avoid token limits — keep first 8000 chars of meaningful content
  const truncated =
    text.length > 8000 ? text.slice(0, 8000) + '\n[... document truncated]' : text

  try {
    const response = await qwen.chat.completions.create({
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
    })

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
  } catch (err) {
    console.error('[entity-extractor] Failed to extract entities:', err)
    return []
  }
}

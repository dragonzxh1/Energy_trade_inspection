import { qwen } from './entity-extractor'

export interface CaseSeedData {
  slug: string
  title: string
  year: number
  entities: string[]
  industry_focus: string
  amount_usd: number | null
  source_kind: 'official' | 'OFAC SDN designation' | 'DOJ press release'
  source_urls: string[]
  verified_facts: string[]
  risk_types: string[]
  legal_disclaimer: string
}

export interface GeneratedCaseContent {
  narrative: string
  meta_description: string
  meta_keywords: string[]
  faq: { question: string; answer: string }[]
  structured_data: Record<string, unknown>
}

function formatCurrency(amount: number | null): string {
  if (amount === null) return 'Not disclosed'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount)
}

export async function generateCaseContent(data: CaseSeedData): Promise<GeneratedCaseContent> {
  const tier = getContentTier(data)

  const [narrative, faq, meta_description] = await Promise.all([
    generateNarrative(data, tier),
    generateFaq(data, tier),
    generateMetaDescription(data, tier),
  ])

  const structured_data = buildStructuredData(data, narrative, faq)

  return {
    narrative,
    meta_description,
    meta_keywords: data.risk_types,
    faq,
    structured_data,
  }
}

type ContentTier = 'detailed' | 'moderate' | 'sparse'

function getContentTier(data: CaseSeedData): ContentTier {
  if (data.source_kind === 'DOJ press release') return 'detailed'
  if (data.source_kind === 'official' && data.amount_usd !== null) return 'moderate'
  return 'sparse'
}

async function generateNarrative(data: CaseSeedData, tier: ContentTier): Promise<string> {
  const entityName = data.entities[0] ?? 'Unknown Entity'
  const year = data.year
  const amountStr = formatCurrency(data.amount_usd)
  const riskTypes = data.risk_types.join(', ')
  const industry = data.industry_focus ?? 'trade'

  if (tier === 'detailed') {
    return generateDetailedNarrative(data)
  }

  if (tier === 'moderate') {
    return generateModerateNarrative(data)
  }

  // sparse — template-based, no fabrication
  const parts: string[] = []

  parts.push(`In ${year}, ${entityName} was listed by OFAC in connection with a sanctions enforcement action.`)

  if (data.amount_usd !== null) {
    parts.push(`The case involved a civil penalty of ${amountStr}.`)
  } else {
    parts.push(`This case was designated under OFAC's sanctions programs. Specific penalty details have not been publicly disclosed.`)
  }

  parts.push(`The matter is categorized under: ${riskTypes}.`)
  parts.push(`ETI classifies this as a ${industry} sanctions enforcement case.`)

  // Add generic industry context without fabricating specific violations
  if (data.risk_types.some(r => r.includes('energy') || r.includes('petroleum') || r.includes('oil'))) {
    parts.push(`Sanctions targeting energy sector entities typically involve restrictions on the production, transportation, or trade of petroleum and petroleum products, often linked to jurisdictions subject to comprehensive sanctions programs.`)
  } else if (data.risk_types.some(r => r.includes('shipping') || r.includes('tanker'))) {
    parts.push(`Maritime sanctions compliance requires careful screening of vessel ownership, flag states, and cargo origins to ensure transactions do not involve blocked persons or prohibited jurisdictions.`)
  }

  return parts.join(' ')
}

async function generateDetailedNarrative(data: CaseSeedData): Promise<string> {
  const facts = data.verified_facts.join('\n')
  const entityName = data.entities[0]

  const prompt = `You are a sanctions compliance analyst writing a factual case summary for ETI Verify, a B2B energy trade risk intelligence platform.

Write a 2-3 paragraph narrative about ${entityName}. Use ONLY the verified facts below. Do NOT add any information not present in the facts. Do NOT fabricate details.

VERIFIED FACTS:
${facts}

ENTITY: ${entityName}
YEAR: ${data.year}
INDUSTRY: ${data.industry_focus}
RISK TYPES: ${data.risk_types.join(', ')}

Requirements:
- Objective, academic tone
- 150-250 words
- Connect the case to energy trade compliance where relevant
- End with a sentence about why this matters for sanctions compliance officers
- Do not add a headline or title

Narrative:`

  try {
    const response = await qwen.chat.completions.create(
      {
        model: 'qwen3.6-plus',
        messages: [
          { role: 'system', content: 'You are a factual sanctions compliance analyst. Only use provided facts.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 800,
        enable_thinking: false,
      } as any,
      { signal: AbortSignal.timeout(30_000) }
    )

    const content = response.choices[0]?.message?.content?.trim()
    return content ?? fallbackNarrative(data)
  } catch {
    return fallbackNarrative(data)
  }
}

async function generateModerateNarrative(data: CaseSeedData): Promise<string> {
  const entityName = data.entities[0]
  const amountStr = formatCurrency(data.amount_usd)
  const facts = data.verified_facts.join(' ')

  const prompt = `Write a concise 1-2 paragraph case summary for ${entityName}.

FACTS: ${facts}
YEAR: ${data.year}
PENALTY: ${amountStr}
INDUSTRY: ${data.industry_focus}
RISK TYPES: ${data.risk_types.join(', ')}

Requirements:
- Use ONLY the provided facts
- 80-150 words
- Objective tone
- Mention the penalty amount and year
- Briefly note compliance relevance

Summary:`

  try {
    const response = await qwen.chat.completions.create(
      {
        model: 'qwen3.6-plus',
        messages: [
          { role: 'system', content: 'You are a factual sanctions compliance analyst.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 500,
        enable_thinking: false,
      } as any,
      { signal: AbortSignal.timeout(30_000) }
    )

    const content = response.choices[0]?.message?.content?.trim()
    return content ?? fallbackNarrative(data)
  } catch {
    return fallbackNarrative(data)
  }
}

function fallbackNarrative(data: CaseSeedData): string {
  const entityName = data.entities[0] ?? 'Unknown Entity'
  const amountStr = formatCurrency(data.amount_usd)
  return `In ${data.year}, ${entityName} was subject to a sanctions enforcement action. The case involved a civil penalty of ${amountStr}. Public details about the specific violation are limited. ETI classifies this matter under ${data.risk_types.join(', ')}.`
}

async function generateFaq(data: CaseSeedData, tier: ContentTier): Promise<{ question: string; answer: string }[]> {
  const entityName = data.entities[0] ?? 'Unknown Entity'
  const amountStr = formatCurrency(data.amount_usd)
  const riskTypes = data.risk_types.join(', ')
  const industry = data.industry_focus ?? 'trade'

  const faqs: { question: string; answer: string }[] = []

  // Q1 — always present
  faqs.push({
    question: `What is the ${entityName} case about?`,
    answer: tier === 'sparse'
      ? `In ${data.year}, ${entityName} was listed by OFAC in a sanctions enforcement action. ${data.amount_usd !== null ? `The case involved a civil penalty of ${amountStr}.` : 'Specific penalty details have not been publicly disclosed.'} Public details about the specific violation are limited.`
      : `${entityName} was subject to OFAC sanctions enforcement in ${data.year}. ${data.amount_usd !== null ? `The case involved a civil penalty of ${amountStr}.` : ''} The matter is categorized under ${riskTypes}.`,
  })

  // Q2 — ETI classification
  faqs.push({
    question: 'How does ETI classify this risk?',
    answer: `ETI categorizes this case under ${riskTypes} in the ${industry} sector.`,
  })

  // Q3 — compliance lessons (generic, no fabrication)
  if (tier === 'detailed') {
    const prompt = `Based on these facts about ${entityName}, provide ONE concise compliance lesson (2-3 sentences) for sanctions compliance officers. Do not add any facts not present.

FACTS: ${data.verified_facts.join(' ')}
RISK TYPES: ${riskTypes}

Lesson:`

    try {
      const response = await qwen.chat.completions.create(
        {
          model: 'qwen3.6-plus',
          messages: [
            { role: 'system', content: 'You are a sanctions compliance advisor. Only use provided facts.' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 200,
          enable_thinking: false,
        } as any,
        { signal: AbortSignal.timeout(30_000) }
      )
      const lesson = response.choices[0]?.message?.content?.trim()
      if (lesson) {
        faqs.push({
          question: 'What can compliance officers learn from this case?',
          answer: lesson,
        })
      }
    } catch {
      // skip if generation fails
    }
  } else {
    // Generic compliance advice based on risk type
    let advice = ''
    if (data.risk_types.some(r => r.includes('energy') || r.includes('petroleum'))) {
      advice = 'Compliance officers should implement enhanced due diligence on counterparties involved in energy commodity trading, particularly when dealing with jurisdictions subject to comprehensive sanctions.'
    } else if (data.risk_types.some(r => r.includes('shipping') || r.includes('tanker'))) {
      advice = 'Maritime trade compliance requires thorough vessel screening, including checks against SDN lists, verification of flag states, and review of AIS data for suspicious routing patterns.'
    } else if (data.risk_types.some(r => r.includes('financial') || r.includes('payment'))) {
      advice = 'Financial institutions should maintain robust sanctions screening programs covering both direct customers and indirect transaction parties, with particular attention to correspondent banking relationships.'
    } else {
      advice = 'Organizations should regularly review and update their sanctions compliance programs, conduct risk-based screening of business partners, and ensure staff training covers applicable sanctions programs.'
    }

    faqs.push({
      question: 'What can compliance officers learn from this case?',
      answer: advice,
    })
  }

  return faqs
}

function generateMetaDescription(data: CaseSeedData, tier: ContentTier): string {
  const entityName = data.entities[0] ?? 'Unknown Entity'
  const amountStr = formatCurrency(data.amount_usd)
  const primaryRisk = data.risk_types[0] ?? 'sanctions'
  const industry = data.industry_focus?.split('/')[0] ?? 'trade'

  let desc: string
  if (tier === 'detailed') {
    desc = `${entityName} — OFAC ${industry} sanctions case (${data.year}). Penalty: ${amountStr}. ${primaryRisk} risk analysis by ETI Verify.`
  } else {
    desc = `${entityName} — OFAC ${industry} enforcement (${data.year}). ${amountStr !== 'Not disclosed' ? `Amount: ${amountStr}. ` : ''}${primaryRisk} risk. ETI Verify.`
  }

  return desc.length > 160 ? desc.substring(0, 157) + '...' : desc
}

function buildStructuredData(
  data: CaseSeedData,
  narrative: string,
  faq: { question: string; answer: string }[]
): Record<string, unknown> {
  const entityName = data.entities[0] ?? 'Unknown Entity'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://energytradeinspection.com'

  const article: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: data.title,
    description: narrative.substring(0, 200),
    author: {
      '@type': 'Organization',
      name: 'ETI Verify',
      url: appUrl,
    },
    datePublished: `${data.year}-01-01`,
    dateModified: new Date().toISOString(),
    about: data.entities.map(e => ({
      '@type': 'Organization',
      name: e,
    })),
    url: `${appUrl}/case/${data.slug}`,
    ...(data.amount_usd !== null && {
      additionalProperty: [
        {
          '@type': 'PropertyValue',
          name: 'Civil Penalty Amount',
          value: data.amount_usd,
          unitCode: 'USD',
        },
      ],
    }),
  }

  // Add FAQ schema if we have FAQ items
  const faqSchema = faq.length > 0
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faq.map(f => ({
          '@type': 'Question',
          name: f.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: f.answer,
          },
        })),
      }
    : null

  return {
    article,
    ...(faqSchema && { faq: faqSchema }),
  }
}

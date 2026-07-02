export const INTELLIGENCE_COMMODITIES = [
  { slug: 'crude-oil', label: 'Crude Oil', shortLabel: 'CR', accent: '#38bdf8' },
  { slug: 'diesel-gasoil', label: 'Diesel / Gasoil', shortLabel: 'DG', accent: '#f59e0b' },
  { slug: 'gasoline', label: 'Gasoline', shortLabel: 'GA', accent: '#ef4444' },
  { slug: 'fuel-oil', label: 'Fuel Oil', shortLabel: 'FO', accent: '#f97316' },
  { slug: 'lng', label: 'LNG', shortLabel: 'LNG', accent: '#22c55e' },
  { slug: 'lpg', label: 'LPG', shortLabel: 'LPG', accent: '#a855f7' },
  { slug: 'naphtha', label: 'Naphtha', shortLabel: 'NA', accent: '#06b6d4' },
  { slug: 'petrochemicals', label: 'Petrochemicals', shortLabel: 'PC', accent: '#14b8a6' },
  { slug: 'shipping-freight', label: 'Shipping / Freight', shortLabel: 'SF', accent: '#8b5cf6' },
  { slug: 'sanctions-compliance', label: 'Sanctions / Compliance', shortLabel: 'SC', accent: '#e11d48' },
] as const

export type IntelligenceCommoditySlug = (typeof INTELLIGENCE_COMMODITIES)[number]['slug']

export const INTELLIGENCE_CONTENT_TYPES = ['market_brief', 'commodity_update', 'intelligence_article'] as const
export type IntelligenceContentType = (typeof INTELLIGENCE_CONTENT_TYPES)[number]

export const REVIEW_STATUS = ['draft', 'reviewed', 'published', 'rejected'] as const
export type ReviewStatus = (typeof REVIEW_STATUS)[number]

export const DISTRIBUTION_STATUS = ['draft', 'queued', 'distributed', 'manual_only'] as const
export type DistributionStatus = (typeof DISTRIBUTION_STATUS)[number]

export function getCommodityMeta(commodity?: string | null) {
  if (!commodity) return null
  return INTELLIGENCE_COMMODITIES.find((item) => item.slug === commodity) ?? null
}

export function slugifyContentValue(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function ensureCommoditySlug(value?: string | null): IntelligenceCommoditySlug | null {
  if (!value) return null
  const normalized = slugifyContentValue(value)
  const exact = INTELLIGENCE_COMMODITIES.find((item) => item.slug === normalized)
  if (exact) return exact.slug

  const aliasMap: Record<string, IntelligenceCommoditySlug> = {
    crude: 'crude-oil',
    'crude-oil': 'crude-oil',
    diesel: 'diesel-gasoil',
    gasoil: 'diesel-gasoil',
    'diesel-gasoil': 'diesel-gasoil',
    gasoline: 'gasoline',
    'fuel-oil': 'fuel-oil',
    fueloil: 'fuel-oil',
    lng: 'lng',
    lpg: 'lpg',
    naphtha: 'naphtha',
    petrochemicals: 'petrochemicals',
    shipping: 'shipping-freight',
    freight: 'shipping-freight',
    'shipping-freight': 'shipping-freight',
    sanctions: 'sanctions-compliance',
    compliance: 'sanctions-compliance',
    'sanctions-compliance': 'sanctions-compliance',
  }

  return aliasMap[normalized] ?? null
}

export function isIntelligenceContentType(contentType: string): contentType is IntelligenceContentType {
  return (INTELLIGENCE_CONTENT_TYPES as readonly string[]).includes(contentType)
}

export function formatContentTypeLabel(contentType: string): string {
  if (contentType === 'market_brief') return 'Market Brief'
  if (contentType === 'commodity_update') return 'Commodity Update'
  if (contentType === 'intelligence_article') return 'Intelligence Article'
  if (contentType === 'case_study') return 'Case Study'
  return contentType.replace(/_/g, ' ')
}

export function formatContentSubtypeLabel(contentSubtype?: string | null): string | null {
  if (!contentSubtype) return null
  return contentSubtype
    .split('_')
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

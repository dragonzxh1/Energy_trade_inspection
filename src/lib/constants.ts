import type { RiskLevel, ScoreTier } from './types'

// Score dimension config — max points per dimension
export const SCORE_DIMENSIONS = {
  entityExistence: {
    label: 'Entity Existence',
    labelZh: '实体存在性',
    max: 25,
    phase2Pending: false,
  },
  assetReality: {
    label: 'Asset Reality',
    labelZh: '资产真实性',
    max: 30,
    phase2Pending: false,
  },
  tradingTrackRecord: {
    label: 'Trading Track Record',
    labelZh: '交易记录',
    max: 25,
    phase2Pending: true, // Phase 2 feature
  },
  documentConsistency: {
    label: 'Document Consistency',
    labelZh: '文件一致性',
    max: 10,
    phase2Pending: false,
  },
  communityReputation: {
    label: 'Community Reputation',
    labelZh: '社区口碑',
    max: 10,
    phase2Pending: false,
  },
} as const

// Phase 1 max possible score (tradingTrackRecord is pending)
export const PHASE1_MAX_SCORE = 75

// Total max score when all phases complete
export const TOTAL_MAX_SCORE = 100

// SVG gauge geometry — r=52, circumference = 2π × 52
export const GAUGE_RADIUS = 52
export const GAUGE_CIRCUMFERENCE = 326.73

// Risk level thresholds (score → risk level)
export const RISK_THRESHOLDS: { threshold: number; level: RiskLevel }[] = [
  { threshold: 85, level: 'low' },
  { threshold: 60, level: 'medium' },
  { threshold: 35, level: 'high' },
  { threshold: 0,  level: 'critical' },
]

// Score tier thresholds (score → tier label)
export const SCORE_TIERS: { threshold: number; tier: ScoreTier }[] = [
  { threshold: 85, tier: 'Verified' },
  { threshold: 70, tier: 'Mostly Verified' },
  { threshold: 45, tier: 'Partially Verified' },
  { threshold: 20, tier: 'Insufficient' },
  { threshold: 0,  tier: 'Suspicious' },
]

// App config
export const APP_CONFIG = {
  // ISR revalidation for entity pages — 24 hours for GEO crawlability
  entityPageRevalidate: 86400,
  // Search results page revalidation — 5 minutes
  searchRevalidate: 300,
  // Max disambiguation results before "Load more"
  maxDisambiguationResults: 10,
  // Data table row height
  tableRowHeight: 40,
} as const

// Sanction list sources checked in Phase 1
export const SANCTION_SOURCES = [
  'UN Security Council',
  'EU Consolidated List',
  'OFAC SDN',
  'UK OFSI',
  'OpenSanctions',
] as const

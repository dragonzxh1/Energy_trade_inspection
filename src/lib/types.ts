// Core domain types for the Energy Trade Inspection Platform

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

export type SanctionStatus = 'not_listed' | 'listed' | 'unknown'

export type EntityType = 'company' | 'vessel' | 'terminal'

// Score tier labels matching DESIGN.md
export type ScoreTier =
  | 'Verified'           // 85-100
  | 'Mostly Verified'    // 70-84
  | 'Partially Verified' // 45-69
  | 'Insufficient'       // 20-44
  | 'Suspicious'         // 0-19

export interface ScoreDimension {
  score: number
  maxScore: number
  phase2Pending?: boolean // Trading Track Record is Phase 2
  evidence?: string[]     // Human-readable reasons explaining this dimension's score
}

// Score breakdown: 5 dimensions, Phase 1 max = 75 (trading track record pending)
export interface ScoreBreakdown {
  entityExistence: ScoreDimension      // max 25
  assetReality: ScoreDimension         // max 30
  tradingTrackRecord: ScoreDimension   // max 25 — Phase 2 pending
  documentConsistency: ScoreDimension  // max 10
  communityReputation: ScoreDimension  // max 10
}

export interface RiskFlag {
  id: string
  category: string
  severity: RiskLevel
  submittedAt: string // ISO 8601
  status: 'pending' | 'verified'
  // Submitter identity never exposed in UI layer (DESIGN.md requirement)
}

export interface BaseEntity {
  id: string
  name: string
  type: EntityType
  country: string
  jurisdictionFlag: string // emoji flag or ISO code
  sanctionStatus: SanctionStatus
  authenticityScore: number // 0-100
  scoreBreakdown: ScoreBreakdown
  riskLevel: RiskLevel
  riskFlags: RiskFlag[]
  lastVerified: string // ISO 8601
  dataSource: string[]
}

export interface Company extends BaseEntity {
  type: 'company'
  slug: string
  registrationNumber: string
  incorporationDate?: string
  registeredAddress?: string
  directors?: Director[]
  vessels?: VesselRef[]
}

export interface Director {
  id: string
  name: string
  role: string
  nationality?: string
  appointedDate?: string
}

export interface VesselRef {
  imo: string
  name: string
  flag: string
}

export interface Vessel extends BaseEntity {
  type: 'vessel'
  imo: string   // IMO number — unique vessel identifier
  mmsi?: string
  flag: string
  vesselType: string
  grossTonnage?: number
  yearBuilt?: number
  currentOperator?: string
  ownerCompanySlug?: string
}

export interface Terminal extends BaseEntity {
  type: 'terminal'
  slug?: string
  location?: string        // specific location within country (city / port area)
  operator?: string        // operating company name
  terminalType?: string    // e.g. LNG, crude oil, petroleum products
  capacity?: number        // storage capacity (m³ or MT)
  ownerCompanySlug?: string
}

export interface SearchResult {
  id: string
  name: string
  type: EntityType
  country: string
  jurisdictionFlag: string
  sanctionStatus: SanctionStatus
  authenticityScore: number
  riskLevel: RiskLevel
  // For companies
  registrationNumber?: string
  slug?: string
  // For vessels
  imo?: string
  vesselType?: string
}

export interface SearchResponse {
  results: SearchResult[]
  total: number
  query: string
  entityType?: EntityType
}

// F1/F2/F3 content hierarchy (DESIGN.md)
// F1: entity name, score, sanction badge — always free
// F2: summary, basic info — always free
// F3: registration details, directors, vessels, documents — paid lock
export type ContentTier = 'F1' | 'F2' | 'F3'

export interface ApiResponse<T> {
  data: T | null
  error?: string
  statusCode: number
}

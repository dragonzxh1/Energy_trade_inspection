/**
 * POST /api/screen
 *
 * Document risk screening — upload a trade contract (PDF/DOCX/XLSX),
 * extract entities via Qwen LLM, and screen each against sanctions and ICIJ data.
 *
 * Access: Starter+ users only.
 * Body: multipart/form-data with field "file" (max 10 MB).
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { auth } from '@/auth'
import { applyMigrations } from '@/lib/server/migrations'
import { db } from '@/lib/server/db'
import { parseDocument } from '@/lib/server/document-parser'
import {
  extractEntities,
  extractTradeParams,
  EntityExtractionError,
  type ExtractedTradeParams,
} from '@/lib/server/entity-extractor'
import {
  searchEntities,
  getEntityByKey,
  getPscSummary,
  getIcijOfficerNetwork,
  searchIcijByPersonName,
  getIcijPersonEntities,
  type IcijOfficerLink,
} from '@/lib/server/repository'
import { checkSanctions } from '@/lib/server/sync/sanctions'
import {
  runTradeRules,
  overallRiskFromFlags,
  generateSummary,
  type TradeFlag,
} from '@/lib/server/trade-rules'
import type { SanctionStatus, RiskLevel, SearchResult } from '@/lib/types'
import type { ExtractedEntity } from '@/lib/server/entity-extractor'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EntityScreeningResult {
  extracted: ExtractedEntity
  sanctionStatus: SanctionStatus
  dbEntity?: SearchResult
  icijConnections?: IcijOfficerLink[]
  pscDeficiencyRate?: number
  riskLevel: RiskLevel
  /** True when ICIJ offshore connections found — entity needs analyst review
   *  before escalating. ICIJ appearance alone does not confirm current risk. */
  needsManualReview?: boolean
}

export interface TradeAssessmentResult {
  /** Trade parameters extracted from the document by the LLM. */
  params: ExtractedTradeParams
  /** Deterministic flags from the trade rules engine. */
  flags: TradeFlag[]
  /** Worst severity across all flags, or 'low' if none. */
  overallRisk: RiskLevel
  /** Human-readable analyst summary. */
  summary: string
}

export interface ScreeningReport {
  id: string
  filename: string
  screenedAt: string
  overallRisk: RiskLevel
  entities: EntityScreeningResult[]
  /** Present when the document contained identifiable trade parameters
   *  (at minimum: seller + vessel). Null when parameters could not be extracted. */
  tradeAssessment: TradeAssessmentResult | null
}

// ── Passport masking ──────────────────────────────────────────────────────────

/**
 * Partially redact a passport / ID number for storage and display.
 * Keeps the first 2 and last 4 characters; replaces the middle with asterisks.
 * Examples: "A12345678" → "A1*****78",  "PASS001" → "PA***01"
 */
function maskPassport(raw: string): string {
  const s = raw.trim()
  if (s.length <= 6) return '*'.repeat(s.length)
  const prefix = s.slice(0, 2)
  const suffix = s.slice(-4)
  const stars  = '*'.repeat(s.length - 6)
  return `${prefix}${stars}${suffix}`
}

// ── Risk helpers ──────────────────────────────────────────────────────────────

function entityRiskLevel(
  sanctionStatus: SanctionStatus,
  icijConnections: IcijOfficerLink[] | undefined,
  dbRiskLevel: RiskLevel | undefined,
  pscDeficiencyRate: number | undefined
): RiskLevel {
  if (sanctionStatus === 'listed') return 'critical'
  if (dbRiskLevel === 'critical' || dbRiskLevel === 'high') return 'high'
  // ICIJ appearance indicates offshore exposure, not confirmed active risk.
  // Panama/Pandora Papers cover millions of entities — flag for review, not high.
  if ((icijConnections?.length ?? 0) > 0) return 'medium'
  if (dbRiskLevel === 'medium' || (pscDeficiencyRate ?? 0) > 0.2) return 'medium'
  return 'low'
}

function overallRisk(entities: EntityScreeningResult[]): RiskLevel {
  if (entities.some((e) => e.sanctionStatus === 'listed')) return 'critical'
  // ICIJ hits now surface as medium per entity — they do not auto-escalate overall
  if (entities.some((e) => e.riskLevel === 'high')) return 'high'
  if (entities.some((e) => e.riskLevel === 'medium')) return 'medium'
  return 'low'
}

const RISK_ORDER: Record<RiskLevel, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

// ── Entity screener ───────────────────────────────────────────────────────────

async function screenEntity(entity: ExtractedEntity): Promise<EntityScreeningResult> {
  const sanctionResult = await checkSanctions(entity.name).catch(() => ({
    listed: false,
    sources: [],
  }))
  const sanctionStatus: SanctionStatus = sanctionResult.listed ? 'listed' : 'not_listed'

  let dbEntity: SearchResult | undefined
  let icijConnections: IcijOfficerLink[] | undefined
  let pscDeficiencyRate: number | undefined

  if (entity.type === 'company') {
    const results = await searchEntities(entity.name, 'company').catch(() => [])
    dbEntity = results[0]

    if (dbEntity?.id) {
      icijConnections = await getIcijOfficerNetwork(dbEntity.id).catch(() => [])
      if (!icijConnections?.length) icijConnections = undefined
    }
  } else if (entity.type === 'person') {
    const icijPersons = await searchIcijByPersonName(entity.name).catch(() => [])
    if (icijPersons.length > 0) {
      const links = await getIcijPersonEntities(icijPersons[0].nodeId).catch(() => [])
      icijConnections = links.length > 0 ? links : undefined
    }
  } else if (entity.type === 'vessel') {
    // Try IMO first, then name search
    const byImo = entity.imo
      ? await getEntityByKey(entity.imo).catch(() => null)
      : null

    if (byImo && byImo.type === 'vessel') {
      dbEntity = {
        id: byImo.id,
        name: byImo.name,
        type: byImo.type,
        country: byImo.country,
        jurisdictionFlag: byImo.jurisdictionFlag,
        sanctionStatus: byImo.sanctionStatus,
        authenticityScore: byImo.authenticityScore,
        riskLevel: byImo.riskLevel,
        imo: byImo.imo,
      }
      const psc = await getPscSummary(byImo.imo).catch(() => null)
      pscDeficiencyRate = psc?.deficiencyRate
    } else {
      const results = await searchEntities(entity.name, 'vessel').catch(() => [])
      dbEntity = results[0]
      if (dbEntity?.imo) {
        const psc = await getPscSummary(dbEntity.imo).catch(() => null)
        pscDeficiencyRate = psc?.deficiencyRate
      }
    }
  }

  const riskLevel = entityRiskLevel(
    sanctionStatus,
    icijConnections,
    dbEntity?.riskLevel,
    pscDeficiencyRate
  )

  return {
    // Mask passport before storage — partial redaction only (first 2 + last 4 chars)
    extracted: entity.passport
      ? { ...entity, passport: maskPassport(entity.passport) }
      : entity,
    sanctionStatus,
    dbEntity,
    icijConnections,
    pscDeficiencyRate,
    riskLevel,
    needsManualReview: (icijConnections?.length ?? 0) > 0,
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'Document screening requires a Starter or higher plan.' },
      { status: 403 }
    )
  }

  await applyMigrations()

  // Parse multipart body
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request. Expected multipart/form-data.' },
      { status: 400 }
    )
  }

  const file = formData.get('file') as File | null
  if (!file) {
    return NextResponse.json(
      { error: 'No file provided. Use field name "file".' },
      { status: 400 }
    )
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'File too large. Maximum size is 10 MB.' },
      { status: 413 }
    )
  }

  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a PDF, DOCX, or XLSX file.' },
      { status: 415 }
    )
  }

  // Parse document to text
  const buffer = Buffer.from(await file.arrayBuffer())
  let text: string
  try {
    text = await parseDocument(buffer, file.type)
  } catch (err) {
    console.error('[screen] Document parse failed:', err)
    return NextResponse.json({ error: 'Failed to parse document.' }, { status: 422 })
  }

  if (!text || text.trim().length < 50) {
    return NextResponse.json(
      { error: 'Document appears to be empty or unreadable.' },
      { status: 422 }
    )
  }

  // Extract entities via LLM
  let entities: Awaited<ReturnType<typeof extractEntities>>
  try {
    entities = await extractEntities(text)
  } catch (err) {
    if (err instanceof EntityExtractionError) {
      console.error('[screen] Entity extraction failed:', err.cause)
      return NextResponse.json(
        { error: 'Entity extraction failed. Please try again.', partial: true },
        { status: 503 }
      )
    }
    throw err
  }

  if (entities.length === 0) {
    return NextResponse.json(
      {
        error:
          'No entities found. Ensure the document contains company names, persons, or vessel names.',
      },
      { status: 422 }
    )
  }

  // Screen entities in batches (concurrency = 4)
  const results: EntityScreeningResult[] = []
  const BATCH = 4
  for (let i = 0; i < entities.length; i += BATCH) {
    const batch = entities.slice(i, i + BATCH)
    const batchResults = await Promise.all(batch.map(screenEntity))
    results.push(...batchResults)
  }

  // Sort by risk level descending
  results.sort((a, b) => RISK_ORDER[a.riskLevel] - RISK_ORDER[b.riskLevel])

  // ── Trade assessment loop ──────────────────────────────────────────────────
  // Run in parallel with the sort above — extract trade params from document text
  // and pipe them through the trade rules engine.
  let tradeAssessment: TradeAssessmentResult | null = null
  try {
    const params = await extractTradeParams(text)

    if (params && params.seller && params.vessel) {
      // Find the best matching entity results from the screening to reuse their data
      const sellerMatch = results.find(
        (r) =>
          r.extracted.type === 'company' &&
          r.extracted.name.toLowerCase().includes(params.seller!.toLowerCase().slice(0, 8))
      )
      const vesselMatch = results.find(
        (r) =>
          r.extracted.type === 'vessel' &&
          (
            r.extracted.name.toLowerCase().includes(params.vessel!.toLowerCase().slice(0, 6)) ||
            (params.imo && r.extracted.imo === params.imo)
          )
      )

      // Derive loading port country from LOCODE prefix (first 2 chars = ISO country code)
      const loadingPortCC =
        params.loadingPort && /^[A-Z]{2}[A-Z0-9]{3}$/i.test(params.loadingPort)
          ? params.loadingPort.slice(0, 2).toLowerCase()
          : null

      const flags = runTradeRules({
        sellerName:            params.seller,
        sellerDbMatch:         sellerMatch?.dbEntity ?? null,
        sellerSanctioned:      sellerMatch?.sanctionStatus === 'listed',
        sellerSanctionSources: [],

        vesselName:            params.vessel,
        vesselImo:             params.imo ?? vesselMatch?.extracted.imo ?? null,
        vesselDbMatch:         vesselMatch?.dbEntity ?? null,
        vesselSanctioned:      vesselMatch?.sanctionStatus === 'listed',
        vesselSanctionSources: [],
        vesselAis:             null,

        loadingPortLocode:  params.loadingPort ?? null,
        loadingPortCountry: loadingPortCC,
        loadingPortName:    params.loadingPort ?? null,
        draftRisk:          null,

        tradeDate:    params.tradeDate ?? null,
        commodity:    params.commodity ?? null,
        skipAisRules: true,
      })

      const risk = overallRiskFromFlags(flags)
      const summary = generateSummary(flags, risk, params.seller, params.vessel)

      tradeAssessment = { params, flags, overallRisk: risk, summary }
    }
  } catch (err) {
    // Best-effort — a trade assessment failure must not break the screening response
    console.error('[screen] Trade assessment failed (non-fatal):', err)
  }

  const sessionId = randomUUID()
  const screenedAt = new Date().toISOString()

  const report: ScreeningReport = {
    id: sessionId,
    filename: file.name,
    screenedAt,
    overallRisk: overallRisk(results),
    entities: results,
    tradeAssessment,
  }

  // Persist for PDF download
  await db.query(
    `INSERT INTO screening_sessions (id, user_id, filename, result_json)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, session.user.id, file.name, JSON.stringify(report)]
  )

  // Piggyback TTL cleanup (fire-and-forget, 90-day retention)
  db.query(`DELETE FROM screening_sessions WHERE created_at < NOW() - INTERVAL '90 days'`)
    .catch((err) => console.error('[screen] TTL cleanup error:', err))

  return NextResponse.json(report)
}

/**
 * GET /api/report/[id]
 *
 * Generates and streams a PDF compliance report for a company, vessel, or terminal.
 * [id] = company slug, vessel IMO number, or terminal entity ID / slug.
 *
 * Enriches the report with:
 *  - AIS cache data (vessels only)
 *  - Intelligence cache data (all entity types)
 *
 * Access: Starter+ users only (plan !== 'free' && session exists).
 */

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { auth } from '@/auth'
import { getEntityByKey } from '@/lib/server/repository'
import { db } from '@/lib/server/db'
import {
  CompanyReportDocument,
  VesselReportDocument,
  TerminalReportDocument,
} from '@/lib/pdf/report'
import type { Company, Terminal, Vessel } from '@/lib/types'
import type { VesselAisData } from '@/lib/ais-types'

// 鈹€鈹€ Cache helpers 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

async function fetchAisCache(imo: string): Promise<VesselAisData | null> {
  try {
    const { rows } = await db.query<{ data_json: unknown }>(
      `SELECT data_json FROM ais_cache WHERE imo = $1 LIMIT 1`,
      [imo],
    )
    return (rows[0]?.data_json as VesselAisData) ?? null
  } catch {
    return null
  }
}

async function fetchIntelCache(
  entityType: string,
  entityKey: string,
): Promise<Record<string, unknown> | null> {
  try {
    const { rows } = await db.query<{ data_json: unknown }>(
      `SELECT data_json FROM intelligence_cache
       WHERE entity_type = $1 AND entity_key = $2 LIMIT 1`,
      [entityType, entityKey],
    )
    return (rows[0]?.data_json as Record<string, unknown>) ?? null
  } catch {
    return null
  }
}

// 鈹€鈹€ Filename sanitizer 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

function safeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

// 鈹€鈹€ Route 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const [{ id }, session] = await Promise.all([params, auth()])

  // Auth guard: the user must be signed in and on a paid plan.
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    )
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'PDF export requires a Starter or higher plan.' },
      { status: 403 },
    )
  }
  const entity = await getEntityByKey(id)

  if (!entity) {
    return NextResponse.json({ error: 'Entity not found.' }, { status: 404 })
  }

  const generatedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  let buffer: Buffer
  let filename: string

  // 鈹€鈹€ Intelligence key (mirrors rescore.ts logic) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const intelKey = entity.type === 'vessel'
    ? (entity as Vessel).imo
    : (entity as Company | Terminal).slug ?? entity.id

  if (entity.type === 'company') {
    const [intel] = await Promise.all([
      fetchIntelCache('company', intelKey),
    ])

    buffer = await renderToBuffer(
      <CompanyReportDocument
        company={entity as Company}
        generatedAt={generatedAt}
        intel={intel ?? undefined}
      />,
    )
    filename = `eti-company-${safeFilename(entity.name)}.pdf`

  } else if (entity.type === 'vessel') {
    const vessel = entity as Vessel
    const [ais, intel] = await Promise.all([
      fetchAisCache(vessel.imo),
      fetchIntelCache('vessel', intelKey),
    ])

    buffer = await renderToBuffer(
      <VesselReportDocument
        vessel={vessel}
        generatedAt={generatedAt}
        ais={ais ?? undefined}
        intel={intel ?? undefined}
      />,
    )
    filename = `eti-vessel-${vessel.imo}-${safeFilename(vessel.name)}.pdf`

  } else if (entity.type === 'terminal') {
    const terminal = entity as Terminal
    const intel = await fetchIntelCache('terminal', intelKey)

    buffer = await renderToBuffer(
      <TerminalReportDocument
        terminal={terminal}
        generatedAt={generatedAt}
        intel={intel ?? undefined}
      />,
    )
    filename = `eti-terminal-${safeFilename(terminal.name)}.pdf`

  } else {
    return NextResponse.json(
      { error: 'Unsupported entity type for PDF export.' },
      { status: 400 },
    )
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'private, no-store',
    },
  })
}




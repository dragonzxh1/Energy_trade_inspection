/**
 * GET /api/report/[id]
 *
 * Generates and streams a PDF compliance report for a company or vessel.
 * [id] = company slug or vessel IMO number.
 *
 * Access: Starter+ users only (plan !== 'free' && session exists).
 */

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { auth } from '@/auth'
import { applyMigrations } from '@/lib/server/migrations'
import { getEntityByKey } from '@/lib/server/repository'
import { CompanyReportDocument, VesselReportDocument } from '@/lib/pdf/report'
import type { Company, Vessel } from '@/lib/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const [{ id }, session] = await Promise.all([params, auth()])

  // Auth guard — must be signed in with a paid plan
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 }
    )
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'PDF export requires a Starter or higher plan.' },
      { status: 403 }
    )
  }

  // Fetch entity
  await applyMigrations()
  const entity = await getEntityByKey(id)

  if (!entity) {
    return NextResponse.json({ error: 'Entity not found.' }, { status: 404 })
  }

  const generatedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  let buffer: Buffer

  if (entity.type === 'company') {
    buffer = await renderToBuffer(
      <CompanyReportDocument company={entity as Company} generatedAt={generatedAt} />
    )
  } else if (entity.type === 'vessel') {
    buffer = await renderToBuffer(
      <VesselReportDocument vessel={entity as Vessel} generatedAt={generatedAt} />
    )
  } else {
    return NextResponse.json(
      { error: 'PDF reports are available for companies and vessels only.' },
      { status: 400 }
    )
  }

  const filename = entity.type === 'vessel'
    ? `eti-vessel-${id}.pdf`
    : `eti-company-${id}.pdf`

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

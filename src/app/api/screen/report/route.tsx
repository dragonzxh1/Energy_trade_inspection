/**
 * GET /api/screen/report?sessionId=xxx
 *
 * Downloads a PDF screening report for a previously-screened document.
 * Access: Starter+ users only, session must belong to the requesting user.
 */

import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { auth } from '@/auth'
import { db } from '@/lib/server/db'
import { ScreeningReportDocument } from '@/lib/pdf/screening-report'
import type { ScreeningReport } from '@/app/api/screen/route'

export async function GET(req: NextRequest) {
  const session = await auth()

  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'PDF export requires a Starter or higher plan.' },
      { status: 403 }
    )
  }

  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const { rows } = await db.query<{
    result_json: unknown
    filename: string
    user_id: string
  }>(
    `SELECT result_json, filename, user_id
     FROM screening_sessions
     WHERE id = $1
     LIMIT 1`,
    [sessionId]
  )

  const row = rows[0]
  if (!row) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  if (row.user_id !== session.user.id) {
    return NextResponse.json({ error: 'Access denied.' }, { status: 403 })
  }

  const report = row.result_json as ScreeningReport

  const generatedAt = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const buffer = await renderToBuffer(
    <ScreeningReportDocument report={report} generatedAt={generatedAt} />
  )

  const safeFilename = report.filename
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="eti-screening-${safeFilename}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

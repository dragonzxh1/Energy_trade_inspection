import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import {
  ALLOWED_SCREENING_TYPES,
  runDocumentScreening,
} from '@/lib/server/screening-service'
import { EntityExtractionError } from '@/lib/server/entity-extractor'
import { db } from '@/lib/server/db'

export type {
  EntityScreeningResult,
  ScreeningReport,
  TradeAssessmentResult,
} from '@/lib/server/screening-service'

// Magic byte signatures for allowed file types.
// PDF: %PDF-   DOCX/XLSX: PK\x03\x04 (both are ZIP-based Office formats)
const MAGIC_BYTES: Record<string, number[]> = {
  'application/pdf': [0x25, 0x50, 0x44, 0x46],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [0x50, 0x4b, 0x03, 0x04],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [0x50, 0x4b, 0x03, 0x04],
}

function hasValidMagicBytes(buf: Buffer, mimeType: string): boolean {
  const expected = MAGIC_BYTES[mimeType]
  if (!expected) return true
  return expected.every((byte, i) => buf[i] === byte)
}

/** GET /api/screen?sessionId=xxx — restore a previously saved screening session. */
export async function GET(req: NextRequest) {
  const session = (await auth())!

  const sessionId = req.nextUrl.searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required.' }, { status: 400 })
  }

  const { rows } = await db.query<{ result_json: unknown }>(
    `SELECT result_json FROM screening_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, session.user.id]
  )

  if (!rows[0]) {
    return NextResponse.json({ error: 'Session not found.' }, { status: 404 })
  }

  return NextResponse.json(rows[0].result_json)
}

export async function POST(req: NextRequest) {
  const session = (await auth())!

  const plan = session!.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'Document screening requires a Starter or higher plan.' },
      { status: 403 }
    )
  }

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
      { error: 'No file provided. Use field name \"file\".' },
      { status: 400 }
    )
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json(
      { error: 'File too large. Maximum size is 10 MB.' },
      { status: 413 }
    )
  }

  if (!ALLOWED_SCREENING_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Upload a PDF, DOCX, or XLSX file.' },
      { status: 415 }
    )
  }

  // Validate actual file content against declared MIME type using magic bytes.
  // This prevents spoofed Content-Type headers (e.g. renaming a .exe to .pdf).
  const fileBuffer = Buffer.from(await file.arrayBuffer())
  if (!hasValidMagicBytes(fileBuffer, file.type)) {
    return NextResponse.json(
      { error: 'File content does not match declared type.' },
      { status: 415 }
    )
  }

  try {
    const report = await runDocumentScreening(session.user.id, file)
    return NextResponse.json(report)
  } catch (error) {
    if (error instanceof EntityExtractionError) {
      console.error('[screen] Entity extraction failed:', error.cause)
      return NextResponse.json(
        { error: 'Entity extraction failed. Please try again.', partial: true },
        { status: 503 }
      )
    }

    if (error instanceof Error && error.message === 'DOCUMENT_EMPTY') {
      return NextResponse.json(
        { error: 'Document appears to be empty or unreadable.' },
        { status: 422 }
      )
    }

    if (error instanceof Error && error.message === 'NO_ENTITIES_FOUND') {
      return NextResponse.json(
        {
          error: 'No entities found. Ensure the document contains company names, persons, or vessel names.',
        },
        { status: 422 }
      )
    }

    console.error('[screen]', error)
    return NextResponse.json({ error: 'Failed to parse document.' }, { status: 422 })
  }
}



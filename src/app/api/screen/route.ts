import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import {
  ALLOWED_SCREENING_TYPES,
  runDocumentScreening,
} from '@/lib/server/screening-service'
import { EntityExtractionError } from '@/lib/server/entity-extractor'

export type {
  EntityScreeningResult,
  ScreeningReport,
  TradeAssessmentResult,
} from '@/lib/server/screening-service'

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



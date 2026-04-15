import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getReportPage, deleteReport } from '@/lib/server/report-history'

export const runtime = 'nodejs'

const MAX_LIMIT = 50

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const type   = searchParams.get('type')
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)
  const limit  = Math.min(parseInt(searchParams.get('limit') ?? '10', 10), MAX_LIMIT)

  if (type !== 'trade' && type !== 'screening') {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 })
  }

  const rows = await getReportPage(session.user.id, type, offset, limit)
  return NextResponse.json({ rows })
}

export async function DELETE(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const { searchParams } = req.nextUrl
  const type = searchParams.get('type')
  const id   = searchParams.get('id')

  if (type !== 'trade' && type !== 'screening') {
    return NextResponse.json({ error: 'Invalid type.' }, { status: 400 })
  }
  if (!id) {
    return NextResponse.json({ error: 'Missing id.' }, { status: 400 })
  }

  const deleted = await deleteReport(session.user.id, type, id)
  if (!deleted) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}

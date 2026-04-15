import { NextRequest, NextResponse } from 'next/server'
import type { RiskLevel } from '@/lib/types'
import { auth } from '@/auth'
import { createRiskFlag, entityExists } from '@/lib/server/repository'

export const runtime = 'nodejs'

const ALLOWED_SEVERITIES: RiskLevel[] = ['low', 'medium', 'high', 'critical']

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const entityId = String(body.entityId ?? '').trim()
  const flagType = String(body.flagType ?? '').trim()
  const severity = String(body.severity ?? '').trim() as RiskLevel
  const description = body.description ? String(body.description).trim() : undefined

  if (!entityId) {
    return NextResponse.json({ error: 'entityId is required.' }, { status: 400 })
  }
  if (!flagType) {
    return NextResponse.json({ error: 'flagType is required.' }, { status: 400 })
  }
  if (!ALLOWED_SEVERITIES.includes(severity)) {
    return NextResponse.json({ error: 'severity must be low, medium, high, or critical.' }, { status: 400 })
  }

  try {

    const exists = await entityExists(entityId)
    if (!exists) {
      return NextResponse.json({ error: 'Entity not found.' }, { status: 404 })
    }

    const result = await createRiskFlag({
      entityId,
      flagType,
      severity,
      description,
      submitterUserId: session.user.id,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    console.error('[flags]', error)
    return NextResponse.json({ error: 'Failed to submit risk flag.' }, { status: 500 })
  }
}



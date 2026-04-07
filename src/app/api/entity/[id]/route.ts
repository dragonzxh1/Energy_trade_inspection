import { NextRequest, NextResponse } from 'next/server'
import type { ApiResponse, Company, Terminal, Vessel } from '@/lib/types'
import { applyMigrations } from '@/lib/server/migrations'
import { getEntityByKey } from '@/lib/server/repository'

export const runtime = 'nodejs'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params

  try {
    await applyMigrations()
    const entity = await getEntityByKey(id)

    if (!entity) {
      return NextResponse.json<ApiResponse<null>>(
        { data: null, statusCode: 404, error: 'Entity not found' },
        { status: 404 }
      )
    }

    return NextResponse.json<ApiResponse<Company | Vessel | Terminal>>(
      { data: entity, statusCode: 200 },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=3600',
        },
      }
    )
  } catch (err) {
    console.error('[entity]', err)
    return NextResponse.json<ApiResponse<null>>(
      { data: null, statusCode: 500, error: 'Internal server error' },
      { status: 500 }
    )
  }
}

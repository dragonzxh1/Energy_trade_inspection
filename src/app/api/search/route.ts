import { NextRequest, NextResponse } from 'next/server'
import type { SearchResponse } from '@/lib/types'
import { applyMigrations } from '@/lib/server/migrations'
import { searchEntities } from '@/lib/server/repository'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')?.trim() ?? ''
  const entityType = searchParams.get('type') ?? undefined

  if (!query || query.length < 2) {
    return NextResponse.json<SearchResponse>(
      { results: [], query, total: 0 },
      { status: 200 }
    )
  }

  try {
    await applyMigrations()
    const results = await searchEntities(query, entityType)

    return NextResponse.json<SearchResponse>(
      { results, query, total: results.length },
      {
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    )
  } catch (err) {
    console.error('[search]', err)
    return NextResponse.json<SearchResponse>(
      { results: [], query, total: 0, error: 'Search unavailable' } as SearchResponse & { error: string },
      { status: 200 }
    )
  }
}

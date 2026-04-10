import { NextRequest, NextResponse } from 'next/server'
import { pinyin } from 'pinyin-pro'
import type { SearchResponse } from '@/lib/types'
import { searchEntities } from '@/lib/server/repository'

export const runtime = 'nodejs'

/**
 * If the user's query contains CJK characters, auto-convert to pinyin.
 * 张伟 → "zhang wei", 青岛迪昊能源 → "qing dao di hao neng yuan"
 *
 * Coverage: person names work reliably. Company names work only when the
 * stored English name is pinyin-romanized (not translated). No false positives —
 * if the pinyin doesn't match anything, zero results is the correct behavior.
 */
function normalizeQueryForSearch(raw: string): string {
  const trimmed = raw.trim()
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(trimmed)) {
    return pinyin(trimmed, { toneType: 'none', separator: ' ' })
  }
  return trimmed
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const rawQuery = searchParams.get('q') ?? ''
  const query = normalizeQueryForSearch(rawQuery)
  const entityType = searchParams.get('type') ?? undefined

  if (!query || query.length < 3) {
    return NextResponse.json<SearchResponse>(
      { results: [], query: rawQuery, total: 0 },
      { status: 200 }
    )
  }

  try {
    const results = await searchEntities(query, entityType)

    return NextResponse.json<SearchResponse>(
      { results, query: rawQuery, total: results.length },
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
      { results: [], query: rawQuery, total: 0, error: 'Search unavailable' } as SearchResponse & { error: string },
      { status: 200 }
    )
  }
}

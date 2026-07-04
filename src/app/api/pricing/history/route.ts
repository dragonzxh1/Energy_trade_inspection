import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PricingRow {
  recorded_at: string
  commodity: string
  product: string
  location: string
  code: string
  price: number
  change: number | null
  unit: string
  currency: string
  source_file_name: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const commodity = searchParams.get('commodity') || undefined
  const days = Math.min(parseInt(searchParams.get('days') || '30', 10), 90)

  try {
    const result = await db.query<{ source_document_json: any; source_file_name: string; source_published_at: string }>(
      `SELECT source_document_json, source_file_name, source_published_at
       FROM seo_content
       WHERE content_subtype = 'pricing_signal'
         AND source_document_json IS NOT NULL
         AND source_published_at >= NOW() - INTERVAL '${days} days'
       ORDER BY source_published_at DESC
       LIMIT 60`
    )

    const rows: PricingRow[] = []
    for (const r of result.rows) {
      const doc = r.source_document_json || {}
      const report = doc.quotes_report
      if (!report?.commodities) continue

      const recordedAt = r.source_published_at

      for (const group of report.commodities) {
        const comm = group.commodity || 'unknown'
        const prod = group.product || comm
        const unit = group.unit || 'mt'

        if (commodity && comm !== commodity) continue

        for (const detail of (group.details || [])) {
          rows.push({
                        recorded_at: typeof recordedAt === 'string' ? recordedAt : new Date(recordedAt).toISOString(),
            commodity: comm,
            product: prod,
            location: detail.location || '',
            code: detail.code || '',
            price: detail.price ?? 0,
            change: detail.change ?? null,
            unit,
            currency: detail.currency || 'USD',
            source_file_name: r.source_file_name || '',
          })
        }
      }
    }

    // Deduplicate: keep latest per date+commodity+location
    const seen = new Set<string>()
    const deduped: PricingRow[] = []
    for (const row of rows) {
      const key = `${row.recorded_at?.substring(0, 10)}|${row.commodity}|${row.location}|${row.unit}`
      if (seen.has(key)) continue
      seen.add(key)
      deduped.push(row)
    }

    // Group by commodity → location → unit → [{date, price, change}]
    const grouped: Record<string, Record<string, Record<string, Array<{ date: string; price: number; change: number | null }>>>> = {}
    for (const row of deduped) {
      if (!grouped[row.commodity]) grouped[row.commodity] = {}
      const locKey = row.location || 'Unknown'
      if (!grouped[row.commodity][locKey]) grouped[row.commodity][locKey] = {}
      if (!grouped[row.commodity][locKey][row.unit]) grouped[row.commodity][locKey][row.unit] = []

      grouped[row.commodity][locKey][row.unit].push({
        date: row.recorded_at?.substring(0, 10) || '',
        price: row.price,
        change: row.change,
      })
    }

    // Sort each series by date
    for (const comm of Object.values(grouped)) {
      for (const loc of Object.values(comm)) {
        for (const unit of Object.values(loc)) {
          unit.sort((a, b) => a.date.localeCompare(b.date))
        }
      }
    }

    // Also return flat list for table view
    return NextResponse.json({
      grouped,
      flat: deduped,
      total_quotes: deduped.length,
      date_range: {
        earliest: deduped.length > 0 ? deduped[deduped.length - 1]?.recorded_at?.substring(0, 10) : null,
        latest: deduped.length > 0 ? deduped[0]?.recorded_at?.substring(0, 10) : null,
      },
    })
  } catch (error) {
    console.error('Pricing API error:', error)
    return NextResponse.json({ error: 'Failed to fetch pricing data' }, { status: 500 })
  }
}

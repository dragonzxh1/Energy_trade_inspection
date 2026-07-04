import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { isAdminAuthorized } from '@/lib/server/admin-auth'
import { db } from '@/lib/server/db'
import { extractPricingFromImage } from '@/lib/server/vl-extraction'
import { applyCodeTable, toQuotesReport } from '@/lib/server/code-table'

export const runtime = 'nodejs'

const DIFY_BASE = process.env.DIFY_BASE_URL ?? 'http://212.64.20.114'
const DIFY_KEY_A = process.env.DIFY_WORKFLOW_API_KEY ?? 'app-of1Cd6t1rGtpSqgaLt7SboTp'
const DIFY_KEY_B = process.env.DIFY_WORKFLOW_API_KEY_QUOTES ?? 'app-WGmbwOdLYuWL72VeNv0Qm4Ev'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!isAdminAuthorized(req, session?.user?.email ?? null).authorized) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const fd = await req.formData()
    const file = fd.get('file') as File | null
    const wf = fd.get('workflow') as string | null
    if (!file || !wf) return NextResponse.json({ error: 'Missing' }, { status: 400 })
    if (wf === 'B' && file.type.startsWith('image/')) return handlePricingImage(file)
    const key = wf === 'B' ? DIFY_KEY_B : DIFY_KEY_A
    const uf = new FormData(); uf.append('file', file); uf.append('user', session?.user?.email ?? 'admin')
    const ur = await fetch(DIFY_BASE + '/v1/files/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: uf })
    if (!ur.ok) return NextResponse.json({ error: 'Upload failed' }, { status: 502 })
    const { id } = await ur.json()
    const wr = await fetch(DIFY_BASE + '/v1/workflows/run', {
      method: 'POST', headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: { source_file: { transfer_method: 'local_file', upload_file_id: id, type: 'image' }, source_channel: 'admin_manual_upload', source_message_id: 'upload_' + Date.now(), file_name: file.name, message_timestamp: new Date().toISOString(), caption: 'Manual: ' + file.name, content_type: 'image' }, response_mode: 'blocking', user: session?.user?.email ?? 'admin' }),
    })
    const wd = await wr.json()
    if (!wr.ok) return NextResponse.json({ error: 'WF failed' }, { status: 502 })
    return NextResponse.json({ success: true, file_id: id })
  } catch (e: unknown) { return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 }) }
}

async function handlePricingImage(file: File) {
  const t0 = Date.now()
  const buf = await file.arrayBuffer(); const b64 = Buffer.from(buf).toString('base64')
  console.log('[VL] Starting for ' + file.name)
  const vl = await extractPricingFromImage(b64)
  if (!vl) return NextResponse.json({ error: 'VL failed' }, { status: 502 })
  const rpt = toQuotesReport(applyCodeTable(vl, file.name))
  const n = rpt.quotes_report.commodities.reduce((s: number, c: any) => s + c.details.length, 0)
  console.log('[VL] ' + n + ' quotes, date=' + vl.image_date)
  const msgId = 'upload_' + Date.now()
  const pubAt = vl.image_date ? new Date(vl.image_date + 'T07:00:00Z').toISOString() : new Date().toISOString()
  const d = vl.image_date || 'today'
  const doc = JSON.stringify(rpt)
  try {
    await db.query(
      `INSERT INTO seo_content (
        content_type, slug, title, content_subtype,
        source_channel, source_message_id, source_file_name, source_published_at,
        parser_confidence, review_status, distribution_status,
        verified_facts, source_urls, source_level, source_kind, risk_types, entities,
        legal_disclaimer, published, page_views,
        narrative, meta_description, source_document_json,
        commodity, key_facts, why_it_matters, internal_only
      ) VALUES (
        'commodity_update', $1, $2, 'pricing_signal',
        'admin_manual_upload', $3, $4, $5,
        '0.9500', 'draft', 'draft',
        '[]'::jsonb, '{}'::text[], 'official', 'official', '{pricing risk}'::text[], '{}'::text[],
        'ETI provides structured market intelligence derived from external source documents.', false, 0,
        $6, $7, $8,
        'crude-oil', '[]'::jsonb, $9, false
      )`,
      [
        'daily-energy-quotes-' + msgId,
        'Daily Energy Quotes - ' + d,
        msgId, file.name, pubAt,
        'Daily energy commodity quotes for ' + d + '.',
        'Daily energy commodity quotes - ' + d,
        doc,
        'Daily price intelligence for energy traders.',
      ]
    )
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    console.log('[VL] Saved in ' + dt + 's')
    return NextResponse.json({ success: true, elapsed: parseFloat(dt), quotes: n, date: vl.image_date })
  } catch (e) { console.error('[VL] DB error:', e); return NextResponse.json({ error: 'DB save failed' }, { status: 500 }) }
}

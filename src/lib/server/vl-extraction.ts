const DASHSCOPE_BASE = 'https://ws-nmuz2kokx9aawrme.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'
const DASHSCOPE_KEY = process.env.DASHSCOPE_API_KEY ?? 'sk-ws-H.RXRIILL.cOcK.MEUCIEnE9waj_mr3fszYzi1yldchRJaQYHwOHWSlim4LO5-1AiEAifJBqyq-zxEFmRECoQ4MhKxLh8XmNI8N6hCPhgaNZzs'
const VL_MODEL = 'qwen-vl-max'

const VL_PROMPT = `Extract ALL pricing data from this Platts table as JSON.

6 PANELS: ULSD 10ppm | JET-A1 | Gasoline Prem.10ppm | Naphtha | Gasoil 0.1% | Fuel Oil 1.0%

EUROPEAN ROWS (unit=USD/mt): FOB Med | CIF Med | FOB NWE | CIF NWE | FOB Rott

ASIA ROWS (spot USD/bbl + conv.MT USD/mt): FOB Sing (MOPS) | FOB AG (MOPAG) | MOPJ
Output TWO entries per Asia row: one spot(bbl) + one conv.MT(mt) with conv.MT suffix on location.

FUEL OIL EXTRA: HSFO 180/380 CST(USD/mt) | US D6(USD/bbl) | US 100(USD/mt)
SPREADS: compact arrays [product,name,value,unit]

Return ONLY JSON. No markdown. No comments. Real codes. Numbers must be numbers, never N/A.
Format: {"quotes":[{"product":"ULSD 10ppm","location":"FOB Med","code":"AAWY00","price":937.5,"change":24.75,"unit":"USD/mt"}],"spreads":[],"mt_bbl_factors":{},"image_date":"2026-06-30"}`

export interface VlQuote { product: string; location: string; code: string; price: number | null; change: number | null; unit: string }
export interface VlExtractionResult { quotes: VlQuote[]; spreads: Array<any>; mt_bbl_factors: Record<string, number>; image_date: string }

export async function extractPricingFromImage(imageBase64: string): Promise<VlExtractionResult | null> {
  const resp = await fetch(DASHSCOPE_BASE + '/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + DASHSCOPE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: VL_MODEL, messages: [{ role: 'user', content: [
      { type: 'text', text: VL_PROMPT }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 } }
    ]}], max_tokens: 20000, temperature: 0.1 }),
    signal: AbortSignal.timeout(300_000),
  })
  if (!resp.ok) { console.error('VL API error:', resp.status); return null }
  const data = await resp.json()
  const raw: string = data?.choices?.[0]?.message?.content ?? ''
  console.log('VL done: ' + raw.length + ' chars')
  if (!raw) return null
  let c = raw.trim()
  c = c.replace(/^\x60\x60\x60(?:json)?\s*\n?/i, '').replace(/\n?\x60\x60\x60\s*$/, '')
  c = c.replace(/\s*\/\/.*$/gm, '')
  c = c.replace(/,(\s*[}\]])/g, '$1')
  c = c.replace(/([:,])\s*N\/A\s*(?=[,\]\}])/gi, '$1null')
  try { return JSON.parse(c) as VlExtractionResult } catch (e) {
    console.error('VL parse error:', String(e).substring(0, 100))
    const m = c.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]) as VlExtractionResult } catch { return null } }
    return null
  }
}

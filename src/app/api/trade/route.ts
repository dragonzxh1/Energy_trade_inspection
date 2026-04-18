import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { runTradeCheck } from '@/lib/server/trade-service'

export const runtime = 'nodejs'

export type {
  TradeCheckInput,
  TradeCheckResult,
  TradePartyResult,
  TradePortResult,
  TradeVesselResult,
} from '@/lib/server/trade-service'

// CR-01 fix: allowlist-style domain validator for sellerDomain (CR-02 fix)
const DOMAIN_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

function parseSellerDomain(raw: unknown): string | undefined {
  if (!raw) return undefined
  const cleaned = String(raw).trim().toLowerCase()
    .replace(/^https?:\/\//i, '')  // strip scheme if user pasted URL
    .split('/')[0]                  // drop path component
  return DOMAIN_RE.test(cleaned) && cleaned.length <= 253 ? cleaned : undefined
}

export async function POST(req: NextRequest) {
  // CR-01 fix: null session returns 401 instead of crashing with TypeError
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }

  const plan = session.user.plan ?? 'free'
  if (plan === 'free') {
    return NextResponse.json(
      { error: 'Trade checks require a Starter or higher plan.' },
      { status: 403 }
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const seller = String(body.seller ?? '').trim()
  const vessel = String(body.vessel ?? '').trim()
  const date = body.date ? String(body.date).trim() : null
  const loadingPort = body.loadingPort ? String(body.loadingPort).trim().toUpperCase() : null
  const commodity = body.commodity ? String(body.commodity).trim() : null
  const imoField = body.imo ? String(body.imo).trim() : undefined
  // CR-02 fix: validate domain format before passing to RDAP/WHOIS (blocks SSRF)
  const sellerDomain = parseSellerDomain(body.sellerDomain)

  if (!seller || seller.length < 2) {
    return NextResponse.json({ error: 'Field \"seller\" is required (min 2 chars).' }, { status: 400 })
  }

  try {
    const result = await runTradeCheck(session.user.id, {
      seller,
      vessel,
      date,
      loadingPort,
      commodity,
      imoField,
      sellerDomain,   // NEW (D-02) — undefined when blank/absent
    })
    return NextResponse.json(result)
  } catch (error) {
    console.error('[trade]', error)
    return NextResponse.json({ error: 'Trade check failed.' }, { status: 500 })
  }
}



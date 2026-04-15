import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { checkDomain, checkEmailDomain } from '@/lib/server/domain-check'

/**
 * GET /api/intelligence/domain/[domain]
 *
 * Returns combined WHOIS + email DNS intelligence for a domain.
 * Protected: paid plan required (free users receive 403).
 * Cached on client side for 1 hour (WHOIS is cached 48h server-side via domain_whois_cache;
 * email DNS is cached 48h server-side via domain_email_cache).
 *
 * Auth: middleware.ts covers this route. Session check here enforces plan-level gating.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ domain: string }> },
) {
  const session = await auth()
  const plan = session?.user?.plan ?? 'free'

  if (plan === 'free') {
    return NextResponse.json({ error: 'Upgrade required' }, { status: 403 })
  }

  const { domain } = await params

  // Validate domain format before making any DNS/RDAP calls.
  // Accepts: plain domains (example.com), www-prefixed (www.example.com).
  // Rejects: URLs with paths, IP addresses, single labels.
  const domainParam = decodeURIComponent(domain).toLowerCase().replace(/^www\./, '').trim()
  const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/
  if (!DOMAIN_RE.test(domainParam) || domainParam.length > 253) {
    return NextResponse.json({ error: 'Invalid domain format' }, { status: 400 })
  }

  // Run WHOIS and email DNS checks in parallel.
  // Both are non-throwing — they return null/error fields on failure.
  const [whoisResult, emailResult] = await Promise.allSettled([
    checkDomain(domainParam),
    checkEmailDomain(domainParam),
  ])

  const whoisData = whoisResult.status === 'fulfilled' ? whoisResult.value : null
  const emailData = emailResult.status === 'fulfilled' ? emailResult.value : null

  return NextResponse.json(
    {
      domain: domainParam,
      whois:            whoisData?.whois ?? null,
      spoofingMatches:  whoisData?.spoofingMatches ?? [],
      email:            emailData,
    },
    {
      headers: {
        // Private: only for the authenticated user. 1-hour browser cache.
        'Cache-Control': 'private, max-age=3600',
      },
    }
  )
}

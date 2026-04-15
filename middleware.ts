/**
 * Node.js middleware — centralized auth guard + IP-based sliding window rate limiting
 * for all API routes.
 *
 * Auth enforcement (before rate limiting):
 *   Protected routes require a valid NextAuth session — 401 returned if no session.
 *   Public routes bypass the auth check but still go through rate limiting.
 *
 * Rate limits (per IP, per minute):
 *   /api/auth/*            10 req  — brute-force protection
 *   /api/screen, /api/trade, /api/intelligence/*   20 req  — expensive AI calls
 *   /api/search            60 req
 *   /api/**  (everything else)     120 req
 *
 * Works for single-process PM2 deployments (global Map persists in-process).
 */

export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { auth } from './src/auth'

const store = new Map<string, number[]>()
const CLEANUP_WINDOW_MS = 2 * 60_000

type RateLimit = { requests: number; windowMs: number }

/**
 * Routes that require an authenticated session.
 * Requests to these paths without a valid session receive 401.
 *
 * Excluded (public or special-auth):
 *   /api/search       — public entity search
 *   /api/entity/**    — public entity detail
 *   /api/flags        — anonymous risk flag submission
 *   /api/stripe/**    — Stripe webhook (signature-verified)
 *   /api/auth/**      — NextAuth callbacks (must remain public)
 *   /api/cron/**      — cron cleanup (Bearer token auth)
 */
function isProtectedRoute(pathname: string): boolean {
  return (
    pathname.startsWith('/api/screen') ||
    pathname.startsWith('/api/trade') ||
    pathname.startsWith('/api/intelligence/') ||
    pathname.startsWith('/api/ais/') ||
    pathname.startsWith('/api/watchlist') ||
    pathname === '/api/quota' ||
    pathname.startsWith('/api/report/') ||
    pathname.startsWith('/api/admin/')
  )
}

function getRateLimit(pathname: string): RateLimit | null {
  if (pathname.startsWith('/api/auth/'))
    return { requests: 10, windowMs: 60_000 }
  if (
    pathname.startsWith('/api/screen') ||
    pathname.startsWith('/api/trade') ||
    pathname.startsWith('/api/intelligence/')
  )
    return { requests: 20, windowMs: 60_000 }
  if (pathname.startsWith('/api/search'))
    return { requests: 60, windowMs: 60_000 }
  if (pathname.startsWith('/api/'))
    return { requests: 120, windowMs: 60_000 }
  return null
}

function getIP(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}

function checkRateLimit(
  key: string,
  limit: RateLimit
): { limited: boolean; remaining: number } {
  const now = Date.now()
  const windowStart = now - limit.windowMs
  const timestamps = (store.get(key) ?? []).filter((t) => t > windowStart)
  const limited = timestamps.length >= limit.requests

  if (!limited) timestamps.push(now)
  store.set(key, timestamps)

  // Periodic cleanup — prevent unbounded Map growth
  if (Math.random() < 0.01) {
    const cutoff = now - CLEANUP_WINDOW_MS
    for (const [k, v] of store.entries()) {
      const fresh = v.filter((t) => t > cutoff)
      if (fresh.length === 0) store.delete(k)
      else store.set(k, fresh)
    }
  }

  return { limited, remaining: Math.max(0, limit.requests - timestamps.length) }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Auth guard: check session before rate limiting for protected routes.
  // Unauthenticated requests are rejected immediately (no rate limit consumed).
  if (isProtectedRoute(pathname)) {
    const session = await auth()
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 }
      )
    }
  }

  const limit = getRateLimit(pathname)
  if (!limit) return NextResponse.next()

  const ip = getIP(req)
  // Group by top-level route (e.g. /api/screen, /api/auth) to prevent key explosion
  const routeGroup = pathname.split('/').slice(0, 3).join('/')
  const key = `${ip}:${routeGroup}`

  const { limited, remaining } = checkRateLimit(key, limit)

  if (limited) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil(limit.windowMs / 1000)),
          'X-RateLimit-Limit': String(limit.requests),
          'X-RateLimit-Remaining': '0',
        },
      }
    )
  }

  const res = NextResponse.next()
  res.headers.set('X-RateLimit-Limit', String(limit.requests))
  res.headers.set('X-RateLimit-Remaining', String(remaining))
  return res
}

export const config = {
  matcher: '/api/:path*',
}

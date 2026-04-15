import { NextRequest } from 'next/server'

export interface AuthResult {
  authorized: boolean
  reason: 'no_session' | 'bearer_valid' | 'admin_email' | 'not_admin'
}

export function isAdminAuthorized(req: NextRequest, userEmail?: string | null): AuthResult {
  const adminSecret = process.env.ADMIN_SECRET ?? process.env.SYNC_SECRET
  if (adminSecret) {
    const authHeader = req.headers.get('authorization') ?? ''
    if (authHeader === `Bearer ${adminSecret}`) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }

  // No ADMIN_SECRET set — localhost bypass (dev only)
  if (!adminSecret) {
    const host = req.headers.get('host') ?? ''
    if (host.startsWith('localhost') || host.startsWith('127.')) {
      return { authorized: true, reason: 'bearer_valid' }
    }
  }

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)

  if (!userEmail) {
    return { authorized: false, reason: 'no_session' }
  }

  if (adminEmails.includes(userEmail)) {
    return { authorized: true, reason: 'admin_email' }
  }

  return { authorized: false, reason: 'not_admin' }
}

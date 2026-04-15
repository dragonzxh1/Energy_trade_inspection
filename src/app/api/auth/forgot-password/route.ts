import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/server/db'
import { checkRateLimit } from '@/lib/server/auth-rate-limit'
import { sendPasswordResetEmail } from '@/lib/server/email'

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
    }

    const rawEmail = email.trim().toLowerCase()

    // ── Rate limit ──────────────────────────────────────────────────────────────
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      '127.0.0.1'

    const allowed = await checkRateLimit(ip, 'forgot-password')
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again in an hour.' },
        { status: 429 }
      )
    }

    // ── Check user exists and is a credentials user ─────────────────────────────
    const { rows } = await db.query<{ id: string; password_hash: string | null }>(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [rawEmail]
    )
    const user = rows[0]

    // Always return success to avoid user enumeration
    if (!user || !user.password_hash) {
      return NextResponse.json({ message: 'If that email is registered, a reset link has been sent.' })
    }

    // ── Generate reset token (1 hour expiry) ────────────────────────────────────
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 60 * 60 * 1000)
    const identifier = `reset:${rawEmail}`

    // Remove any existing reset tokens for this user
    await db.query(
      `DELETE FROM verification_token WHERE identifier = $1`,
      [identifier]
    )

    await db.query(
      `INSERT INTO verification_token (identifier, token, expires) VALUES ($1, $2, $3)`,
      [identifier, token, expires]
    )

    await sendPasswordResetEmail(rawEmail, token)

    return NextResponse.json({ message: 'If that email is registered, a reset link has been sent.' })
  } catch (err) {
    console.error('[forgot-password]', err)
    return NextResponse.json({ error: 'Request failed. Please try again.' }, { status: 500 })
  }
}

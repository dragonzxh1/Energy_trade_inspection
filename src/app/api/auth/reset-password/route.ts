import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'
import { hashPassword } from '@/lib/server/password'

function isStrongPassword(pw: string): boolean {
  return pw.length >= 8 && /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)
}

export async function POST(req: NextRequest) {
  try {
    const { email, token, password } = (await req.json()) as {
      email?:    string
      token?:    string
      password?: string
    }

    if (!email || !token || !password) {
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 })
    }
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters and include a number or symbol' },
        { status: 400 }
      )
    }

    const rawEmail = email.trim().toLowerCase()
    const identifier = `reset:${rawEmail}`

    // ── Validate token ──────────────────────────────────────────────────────────
    const { rows } = await db.query<{ expires: Date }>(
      `SELECT expires FROM verification_token
       WHERE identifier = $1 AND token = $2`,
      [identifier, token]
    )
    const row = rows[0]

    if (!row) {
      return NextResponse.json({ error: 'Reset link is invalid' }, { status: 400 })
    }
    if (new Date() > row.expires) {
      await db.query(
        `DELETE FROM verification_token WHERE identifier = $1 AND token = $2`,
        [identifier, token]
      )
      return NextResponse.json({ error: 'Reset link has expired. Please request a new one.' }, { status: 400 })
    }

    // ── Update password ─────────────────────────────────────────────────────────
    const passwordHash = await hashPassword(password)

    await db.query(
      `UPDATE users SET password_hash = $1 WHERE email = $2`,
      [passwordHash, rawEmail]
    )

    // Consume the token (single use)
    await db.query(
      `DELETE FROM verification_token WHERE identifier = $1`,
      [identifier]
    )

    return NextResponse.json({ message: 'Password updated successfully. You can now sign in.' })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json({ error: 'Reset failed. Please try again.' }, { status: 500 })
  }
}

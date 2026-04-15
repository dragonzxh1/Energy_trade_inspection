import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  const email = searchParams.get('email')

  if (!token || !email) {
    return NextResponse.redirect(new URL('/sign-in?error=invalid_link', req.url))
  }

  const rawEmail = decodeURIComponent(email).toLowerCase().trim()

  const { rows } = await db.query(
    `SELECT token, expires FROM verification_token
     WHERE identifier = $1 AND token = $2`,
    [rawEmail, token]
  )

  const row = rows[0] as { token: string; expires: Date } | undefined

  if (!row) {
    return NextResponse.redirect(new URL('/sign-in?error=invalid_token', req.url))
  }

  if (new Date() > row.expires) {
    // Delete expired token
    await db.query(
      `DELETE FROM verification_token WHERE identifier = $1 AND token = $2`,
      [rawEmail, token]
    )
    return NextResponse.redirect(new URL('/sign-in?error=token_expired', req.url))
  }

  // Mark email as verified and delete the token
  await db.query(
    `UPDATE users SET "emailVerified" = NOW() WHERE email = $1`,
    [rawEmail]
  )
  await db.query(
    `DELETE FROM verification_token WHERE identifier = $1 AND token = $2`,
    [rawEmail, token]
  )

  return NextResponse.redirect(new URL('/sign-in?verified=1', req.url))
}

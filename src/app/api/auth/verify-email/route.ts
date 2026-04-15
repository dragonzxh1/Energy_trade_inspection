import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/server/db'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'

function redirect(path: string) {
  return NextResponse.redirect(`${APP_URL}${path}`)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  const email = searchParams.get('email')

  if (!token || !email) {
    return redirect('/sign-in?error=invalid_link')
  }

  const rawEmail = decodeURIComponent(email).toLowerCase().trim()

  const { rows } = await db.query(
    `SELECT token, expires FROM verification_token
     WHERE identifier = $1 AND token = $2`,
    [rawEmail, token]
  )

  const row = rows[0] as { token: string; expires: Date } | undefined

  if (!row) {
    return redirect('/sign-in?error=invalid_token')
  }

  if (new Date() > row.expires) {
    await db.query(
      `DELETE FROM verification_token WHERE identifier = $1 AND token = $2`,
      [rawEmail, token]
    )
    return redirect('/sign-in?error=token_expired')
  }

  await db.query(
    `UPDATE users SET "emailVerified" = NOW() WHERE email = $1`,
    [rawEmail]
  )
  await db.query(
    `DELETE FROM verification_token WHERE identifier = $1 AND token = $2`,
    [rawEmail, token]
  )

  return redirect('/sign-in?verified=1')
}

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
      return NextResponse.json({ error: '参数缺失' }, { status: 400 })
    }
    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { error: '密码至少8位，且包含数字或特殊字符' },
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
      return NextResponse.json({ error: '重置链接无效' }, { status: 400 })
    }
    if (new Date() > row.expires) {
      await db.query(
        `DELETE FROM verification_token WHERE identifier = $1 AND token = $2`,
        [identifier, token]
      )
      return NextResponse.json({ error: '重置链接已过期，请重新申请' }, { status: 400 })
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

    return NextResponse.json({ message: '密码已重置，请登录' })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json({ error: '重置失败，请稍后重试' }, { status: 500 })
  }
}

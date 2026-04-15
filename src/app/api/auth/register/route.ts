import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/server/db'
import { hashPassword } from '@/lib/server/password'
import { normalizeEmail } from '@/lib/server/email-normalize'
import { isDisposableEmail } from '@/lib/server/disposable-emails'
import { checkRateLimit } from '@/lib/server/auth-rate-limit'
import { sendVerificationEmail } from '@/lib/server/email'

// Simple password strength: min 8 chars, at least 1 number or symbol
function isStrongPassword(pw: string): boolean {
  return pw.length >= 8 && /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(pw)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, name } = body as {
      email:    string
      password: string
      name?:    string
    }

    // ── Input validation ────────────────────────────────────────────────────────
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 })
    }
    if (!password || typeof password !== 'string' || !isStrongPassword(password)) {
      return NextResponse.json(
        { error: '密码至少8位，且包含数字或特殊字符' },
        { status: 400 }
      )
    }

    const rawEmail = email.trim().toLowerCase()

    // ── Disposable email check ──────────────────────────────────────────────────
    if (isDisposableEmail(rawEmail)) {
      return NextResponse.json({ error: '不支持一次性邮箱注册' }, { status: 400 })
    }

    // ── IP rate limit ───────────────────────────────────────────────────────────
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      req.headers.get('x-real-ip') ??
      '127.0.0.1'

    const allowed = await checkRateLimit(ip, 'register')
    if (!allowed) {
      return NextResponse.json(
        { error: '注册尝试过于频繁，请1小时后再试' },
        { status: 429 }
      )
    }

    // ── Normalized email uniqueness ─────────────────────────────────────────────
    const normalizedEmail = normalizeEmail(rawEmail)

    const { rows: existing } = await db.query(
      `SELECT id, password_hash FROM users
       WHERE email = $1 OR normalized_email = $2
       LIMIT 1`,
      [rawEmail, normalizedEmail]
    )

    if (existing.length > 0) {
      const existingUser = existing[0] as { id: string; password_hash: string | null }
      if (!existingUser.password_hash) {
        // User exists via Google OAuth
        return NextResponse.json(
          { error: '该邮箱已通过 Google 账号注册，请使用 Google 登录' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: '该邮箱已注册，请直接登录' }, { status: 409 })
    }

    // ── Create user ─────────────────────────────────────────────────────────────
    const passwordHash = await hashPassword(password)
    const displayName = name?.trim() || rawEmail.split('@')[0]

    const { rows: inserted } = await db.query<{ id: string }>(
      `INSERT INTO users (name, email, normalized_email, password_hash, plan)
       VALUES ($1, $2, $3, $4, 'free')
       RETURNING id`,
      [displayName, rawEmail, normalizedEmail, passwordHash]
    )
    const userId = inserted[0].id

    // ── Send verification email ─────────────────────────────────────────────────
    const token = randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000)

    await db.query(
      `INSERT INTO verification_token (identifier, token, expires)
       VALUES ($1, $2, $3)
       ON CONFLICT (identifier, token) DO NOTHING`,
      [rawEmail, token, expires]
    )

    await sendVerificationEmail(rawEmail, token)

    return NextResponse.json({ userId, message: '注册成功，请查收验证邮件' }, { status: 201 })
  } catch (err) {
    console.error('[register]', err)
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 })
  }
}

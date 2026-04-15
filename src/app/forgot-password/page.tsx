'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [done,    setDone]    = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      })
      const data = await res.json() as { error?: string }

      if (res.status === 429) {
        setError(data.error ?? '请求过于频繁，请稍后重试')
      } else {
        // Always show success to avoid email enumeration
        setDone(true)
      }
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight:       '100vh',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'var(--bg-primary)',
        padding:         'var(--space-4)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <Link
            href="/"
            style={{
              color:          'var(--text-primary)',
              textDecoration: 'none',
              fontSize:       '20px',
              fontWeight:     700,
              letterSpacing:  '-0.02em',
            }}
          >
            ETI
          </Link>
        </div>

        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border:          '1px solid var(--border-subtle)',
            borderRadius:    '12px',
            padding:         'var(--space-8)',
          }}
        >
          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: 'var(--space-4)' }}>✉️</div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                请查收邮件
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px', marginBottom: 'var(--space-6)' }}>
                如果 <strong>{email}</strong> 已注册，您将收到一封密码重置邮件。链接1小时内有效。
              </p>
              <Link
                href="/sign-in"
                style={{
                  display:         'inline-block',
                  backgroundColor: 'var(--accent-primary)',
                  color:           '#fff',
                  textDecoration:  'none',
                  padding:         '8px 20px',
                  borderRadius:    '6px',
                  fontSize:        '13px',
                  fontWeight:      500,
                }}
              >
                返回登录
              </Link>
            </div>
          ) : (
            <>
              <h1
                style={{
                  fontSize:     '20px',
                  fontWeight:   600,
                  marginBottom: 'var(--space-2)',
                  textAlign:    'center',
                }}
              >
                忘记密码
              </h1>
              <p
                style={{
                  color:        'var(--text-muted)',
                  fontSize:     '13px',
                  textAlign:    'center',
                  marginBottom: 'var(--space-6)',
                  lineHeight:   '20px',
                }}
              >
                输入您注册时使用的邮箱，我们将发送重置链接
              </p>

              {error && (
                <div
                  style={{
                    backgroundColor: 'var(--error-bg, #fef2f2)',
                    border:          '1px solid var(--error-border, #fecaca)',
                    borderRadius:    '6px',
                    padding:         '10px 12px',
                    marginBottom:    'var(--space-4)',
                    fontSize:        '13px',
                    color:           'var(--error-text, #991b1b)',
                  }}
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 'var(--space-5)' }}>
                  <label
                    htmlFor="email"
                    style={{
                      display:      'block',
                      fontSize:     '13px',
                      fontWeight:   500,
                      color:        'var(--text-secondary)',
                      marginBottom: 'var(--space-1)',
                    }}
                  >
                    邮箱
                  </label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{
                      width:           '100%',
                      padding:         '9px 12px',
                      border:          '1px solid var(--border-subtle)',
                      borderRadius:    '6px',
                      fontSize:        '14px',
                      fontFamily:      'inherit',
                      backgroundColor: 'var(--bg-primary)',
                      color:           'var(--text-primary)',
                      boxSizing:       'border-box',
                    }}
                    placeholder="you@example.com"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width:           '100%',
                    padding:         '10px',
                    backgroundColor: 'var(--accent-primary)',
                    color:           '#fff',
                    border:          'none',
                    borderRadius:    '8px',
                    fontSize:        '14px',
                    fontWeight:      500,
                    fontFamily:      'inherit',
                    cursor:          loading ? 'not-allowed' : 'pointer',
                    opacity:         loading ? 0.7 : 1,
                  }}
                >
                  {loading ? '发送中...' : '发送重置邮件'}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
          <Link href="/sign-in" style={{ color: 'var(--accent-primary)' }}>← 返回登录</Link>
        </p>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function SignUpPage() {
  const router = useRouter()
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [done,     setDone]     = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name, email, password }),
      })
      const data = await res.json() as { error?: string; message?: string }

      if (!res.ok) {
        setError(data.error ?? '注册失败，请稍后重试')
      } else {
        setDone(true)
      }
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width:           '100%',
    padding:         '9px 12px',
    border:          '1px solid var(--border-subtle)',
    borderRadius:    '6px',
    fontSize:        '14px',
    fontFamily:      'inherit',
    backgroundColor: 'var(--bg-primary)',
    color:           'var(--text-primary)',
    boxSizing:       'border-box',
  }

  const labelStyle: React.CSSProperties = {
    display:      'block',
    fontSize:     '13px',
    fontWeight:   500,
    color:        'var(--text-secondary)',
    marginBottom: 'var(--space-1)',
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
        {/* Logo */}
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
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: 'var(--space-2)' }}>
            Energy Trade Inspection
          </p>
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
            /* Success state */
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: 'var(--space-4)' }}>✉️</div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
                请验证您的邮箱
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px', marginBottom: 'var(--space-6)' }}>
                我们已向 <strong>{email}</strong> 发送了验证邮件。
                请点击邮件中的链接完成注册，验证后即可使用所有功能。
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                没收到邮件？请检查垃圾邮件文件夹，或{' '}
                <Link href="/sign-up" style={{ color: 'var(--accent-primary)' }}>重新注册</Link>
              </p>
            </div>
          ) : (
            /* Registration form */
            <>
              <h1
                style={{
                  fontSize:     '20px',
                  lineHeight:   '28px',
                  fontWeight:   600,
                  marginBottom: 'var(--space-2)',
                  textAlign:    'center',
                }}
              >
                创建账号
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
                免费使用制裁筛查和风险情报
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
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label style={labelStyle} htmlFor="name">姓名（可选）</label>
                  <input
                    id="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    style={inputStyle}
                    placeholder="您的姓名"
                  />
                </div>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label style={labelStyle} htmlFor="email">邮箱</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={inputStyle}
                    placeholder="you@example.com"
                  />
                </div>
                <div style={{ marginBottom: 'var(--space-6)' }}>
                  <label style={labelStyle} htmlFor="password">密码</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    style={inputStyle}
                    placeholder="至少8位，含数字或符号"
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
                  {loading ? '注册中...' : '创建账号'}
                </button>
              </form>

              <p
                style={{
                  marginTop:  'var(--space-5)',
                  color:      'var(--text-muted)',
                  fontSize:   '11px',
                  textAlign:  'center',
                  lineHeight: '17px',
                }}
              >
                注册即表示您同意我们的服务条款和隐私政策。免费版：每月5次查询。
              </p>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
          已有账号？{' '}
          <Link href="/sign-in" style={{ color: 'var(--accent-primary)' }}>
            立即登录
          </Link>
          {' · '}
          <Link href="/" style={{ color: 'var(--accent-primary)' }}>
            返回搜索
          </Link>
        </p>
      </div>
    </div>
  )
}

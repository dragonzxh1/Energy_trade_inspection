'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'

interface Props {
  callbackUrl: string
  verified:    boolean
  errorCode:   string | null
}

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin:          '登录失败，请重试',
  OAuthCallback:        '登录失败，请重试',
  OAuthCreateAccount:   '账号创建失败，请重试',
  EmailCreateAccount:   '账号创建失败，请重试',
  Callback:             '登录回调失败，请重试',
  OAuthAccountNotLinked:'该邮箱已用其他方式注册，请使用原登录方式',
  CredentialsSignin:    '邮箱或密码错误',
  invalid_token:        '验证链接无效，请重新注册',
  token_expired:        '验证链接已过期，请重新注册',
  invalid_link:         '验证链接格式错误',
}

export default function SignInClient({ callbackUrl, verified, errorCode }: Props) {
  const [tab,      setTab]      = useState<'google' | 'email'>('google')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const errorMsg = formError ?? (errorCode ? (ERROR_MESSAGES[errorCode] ?? '登录失败，请重试') : null)

  async function handleGoogleSignIn() {
    setLoading(true)
    await signIn('google', { callbackUrl })
  }

  async function handleCredentialsSignIn(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    setLoading(true)
    const result = await signIn('credentials', {
      email,
      password,
      callbackUrl,
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setFormError(ERROR_MESSAGES[result.error] ?? '邮箱或密码错误')
    } else if (result?.url) {
      window.location.href = result.url
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

        {/* Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border:          '1px solid var(--border-subtle)',
            borderRadius:    '12px',
            padding:         'var(--space-8)',
          }}
        >
          <h1
            style={{
              fontSize:     '20px',
              lineHeight:   '28px',
              fontWeight:   600,
              marginBottom: 'var(--space-2)',
              textAlign:    'center',
            }}
          >
            登录
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
            访问制裁筛查、真实性评分和风险情报
          </p>

          {/* Verified success banner */}
          {verified && (
            <div
              style={{
                backgroundColor: 'var(--success-bg, #f0fdf4)',
                border:          '1px solid var(--success-border, #bbf7d0)',
                borderRadius:    '6px',
                padding:         '10px 12px',
                marginBottom:    'var(--space-4)',
                fontSize:        '13px',
                color:           'var(--success-text, #166534)',
              }}
            >
              邮箱验证成功，请登录
            </div>
          )}

          {/* Error banner */}
          {errorMsg && (
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
              {errorMsg}
            </div>
          )}

          {/* Tab switcher */}
          <div
            style={{
              display:      'flex',
              border:       '1px solid var(--border-subtle)',
              borderRadius: '8px',
              overflow:     'hidden',
              marginBottom: 'var(--space-5)',
            }}
          >
            {(['google', 'email'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setFormError(null) }}
                style={{
                  flex:            1,
                  padding:         '8px',
                  fontSize:        '13px',
                  fontWeight:      tab === t ? 600 : 400,
                  fontFamily:      'inherit',
                  cursor:          'pointer',
                  border:          'none',
                  backgroundColor: tab === t ? 'var(--accent-primary)' : 'transparent',
                  color:           tab === t ? '#fff' : 'var(--text-secondary)',
                  transition:      'background-color 0.15s',
                }}
              >
                {t === 'google' ? 'Google' : '邮箱登录'}
              </button>
            ))}
          </div>

          {/* Google tab */}
          {tab === 'google' && (
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              style={{
                width:           '100%',
                display:         'flex',
                alignItems:      'center',
                justifyContent:  'center',
                gap:             'var(--space-3)',
                padding:         'var(--space-3) var(--space-4)',
                backgroundColor: '#fff',
                color:           '#1f2937',
                border:          'none',
                borderRadius:    '8px',
                fontSize:        '14px',
                fontWeight:      500,
                fontFamily:      'inherit',
                cursor:          loading ? 'not-allowed' : 'pointer',
                opacity:         loading ? 0.7 : 1,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
                <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
              使用 Google 继续
            </button>
          )}

          {/* Email/password tab */}
          {tab === 'email' && (
            <form onSubmit={handleCredentialsSignIn}>
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
              <div style={{ marginBottom: 'var(--space-2)' }}>
                <label style={labelStyle} htmlFor="password">密码</label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={inputStyle}
                  placeholder="••••••••"
                />
              </div>
              <div style={{ textAlign: 'right', marginBottom: 'var(--space-4)' }}>
                <Link
                  href="/forgot-password"
                  style={{ fontSize: '12px', color: 'var(--accent-primary)' }}
                >
                  忘记密码？
                </Link>
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
                {loading ? '登录中...' : '登录'}
              </button>
            </form>
          )}

          <p
            style={{
              marginTop:  'var(--space-5)',
              color:      'var(--text-muted)',
              fontSize:   '11px',
              textAlign:  'center',
              lineHeight: '17px',
            }}
          >
            登录即表示您同意我们的服务条款和隐私政策。免费版：每月5次查询。
          </p>
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
          还没有账号？{' '}
          <Link href="/sign-up" style={{ color: 'var(--accent-primary)' }}>
            立即注册
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

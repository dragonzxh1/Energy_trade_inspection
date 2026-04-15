'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function SignUpPage() {
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
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Registration failed. Please try again.')
      } else {
        setDone(true)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid var(--border-subtle)',
    borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit',
    backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box',
  }
  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '13px', fontWeight: 500,
    color: 'var(--text-secondary)', marginBottom: 'var(--space-1)',
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <Link href="/" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>ETI</Link>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: 'var(--space-2)' }}>Energy Trade Inspection</p>
        </div>

        <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: 'var(--space-8)' }}>
          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: 'var(--space-4)' }}>✉️</div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Check your email</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px', marginBottom: 'var(--space-6)' }}>
                We sent a verification link to <strong>{email}</strong>. Click the link to activate your account.
              </p>
              <p style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
                Didn&apos;t receive it? Check your spam folder or{' '}
                <Link href="/sign-up" style={{ color: 'var(--accent-primary)' }}>register again</Link>.
              </p>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: '20px', lineHeight: '28px', fontWeight: 600, marginBottom: 'var(--space-2)', textAlign: 'center' }}>Create an account</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginBottom: 'var(--space-6)', lineHeight: '20px' }}>
                Free access to sanction screening and risk intelligence.
              </p>

              {error && (
                <div style={{ backgroundColor: 'var(--error-bg, #fef2f2)', border: '1px solid var(--error-border, #fecaca)', borderRadius: '6px', padding: '10px 12px', marginBottom: 'var(--space-4)', fontSize: '13px', color: 'var(--error-text, #991b1b)' }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label style={labelStyle} htmlFor="name">Name (optional)</label>
                  <input id="name" type="text" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} placeholder="Your name" />
                </div>
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <label style={labelStyle} htmlFor="email">Email</label>
                  <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} placeholder="you@example.com" />
                </div>
                <div style={{ marginBottom: 'var(--space-6)' }}>
                  <label style={labelStyle} htmlFor="password">Password</label>
                  <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder="Min. 8 chars with a number or symbol" />
                </div>
                <button type="submit" disabled={loading} style={{ width: '100%', padding: '10px', backgroundColor: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Creating account...' : 'Create account'}
                </button>
              </form>

              <p style={{ marginTop: 'var(--space-5)', color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', lineHeight: '17px' }}>
                By signing up, you agree to our Terms of Service and Privacy Policy. Free plan: 5 queries/month.
              </p>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
          Already have an account?{' '}
          <Link href="/sign-in" style={{ color: 'var(--accent-primary)' }}>Sign in</Link>
          {' · '}
          <Link href="/" style={{ color: 'var(--accent-primary)' }}>← Back to search</Link>
        </p>
      </div>
    </div>
  )
}

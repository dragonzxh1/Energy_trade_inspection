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
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json() as { error?: string }
      if (res.status === 429) {
        setError(data.error ?? 'Too many requests. Please try again in an hour.')
      } else {
        setDone(true)
      }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'var(--bg-primary)', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <Link href="/" style={{ color: 'var(--text-primary)', textDecoration: 'none', fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>ETI</Link>
        </div>

        <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: 'var(--space-8)' }}>
          {done ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '32px', marginBottom: 'var(--space-4)' }}>✉️</div>
              <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Check your email</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', lineHeight: '20px', marginBottom: 'var(--space-6)' }}>
                If <strong>{email}</strong> is registered, you will receive a password reset link. It expires in 1 hour.
              </p>
              <Link href="/sign-in" style={{ display: 'inline-block', backgroundColor: 'var(--accent-primary)', color: 'var(--text-on-accent)', textDecoration: 'none', padding: '8px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: 'var(--space-2)', textAlign: 'center' }}>Forgot password</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginBottom: 'var(--space-6)', lineHeight: '20px' }}>
                Enter your email and we&apos;ll send you a reset link.
              </p>

              {error && (
                <div style={{ backgroundColor: 'var(--error-bg, #fef2f2)', border: '1px solid var(--error-border, #fecaca)', borderRadius: '6px', padding: '10px 12px', marginBottom: 'var(--space-4)', fontSize: '13px', color: 'var(--error-text, #991b1b)' }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: 'var(--space-5)' }}>
                  <label htmlFor="email" style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>Email</label>
                  <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1px solid var(--border-subtle)', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    placeholder="you@example.com" />
                </div>
                <button type="submit" disabled={loading} style={{ width: '100%', padding: '10px', backgroundColor: 'var(--accent-primary)', color: 'var(--text-on-accent)', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
                  {loading ? 'Sending...' : 'Send reset link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
          <Link href="/sign-in" style={{ color: 'var(--accent-primary)' }}>← Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}

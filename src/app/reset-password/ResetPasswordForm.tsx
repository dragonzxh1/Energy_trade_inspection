'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'

export default function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') ?? ''
  const email = searchParams.get('email') ?? ''

  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [done,      setDone]      = useState(false)

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '9px 12px', border: '1px solid var(--border-subtle)',
    borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit',
    backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', boxSizing: 'border-box',
  }

  if (!token || !email) {
    return (
      <>
        <p style={{ color: 'var(--text-muted)', fontSize: '14px', textAlign: 'center' }}>
          This reset link is invalid or has expired.
        </p>
        <div style={{ textAlign: 'center', marginTop: 'var(--space-4)' }}>
          <Link href="/forgot-password" style={{ color: 'var(--accent-primary)', fontSize: '13px' }}>
            Request a new reset link
          </Link>
        </div>
      </>
    )
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: '18px', fontWeight: 600, marginBottom: 'var(--space-3)' }}>Password updated</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: 'var(--space-6)' }}>
          Your new password has been set. You can now sign in.
        </p>
        <Link href="/sign-in" style={{ display: 'inline-block', backgroundColor: 'var(--accent-primary)', color: '#fff', textDecoration: 'none', padding: '8px 20px', borderRadius: '6px', fontSize: '13px', fontWeight: 500 }}>
          Sign in
        </Link>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== password2) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, token, password }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) { setError(data.error ?? 'Reset failed. Please request a new link.') }
      else { setDone(true) }
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <h1 style={{ fontSize: '20px', fontWeight: 600, marginBottom: 'var(--space-2)', textAlign: 'center' }}>Set new password</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginBottom: 'var(--space-6)' }}>
        Setting password for {email}
      </p>

      {error && (
        <div style={{ backgroundColor: 'var(--error-bg, #fef2f2)', border: '1px solid var(--error-border, #fecaca)', borderRadius: '6px', padding: '10px 12px', marginBottom: 'var(--space-4)', fontSize: '13px', color: 'var(--error-text, #991b1b)' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label htmlFor="password" style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>New password</label>
          <input id="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} placeholder="Min. 8 chars with a number or symbol" />
        </div>
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <label htmlFor="password2" style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 'var(--space-1)' }}>Confirm password</label>
          <input id="password2" type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} style={inputStyle} placeholder="Re-enter password" />
        </div>
        <button type="submit" disabled={loading} style={{ width: '100%', padding: '10px', backgroundColor: 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, fontFamily: 'inherit', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}>
          {loading ? 'Saving...' : 'Save new password'}
        </button>
      </form>
    </>
  )
}

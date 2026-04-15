'use client'

import { useState } from 'react'

interface CheckoutButtonProps {
  plan: 'starter' | 'professional'
  highlighted?: boolean
  children: React.ReactNode
}

export default function CheckoutButton({ plan, highlighted, children }: CheckoutButtonProps) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await res.json()

      if (res.status === 401) {
        window.location.href = '/sign-in'
        return
      }
      if (res.status === 503) {
        alert('Payment is not yet configured. Please check back soon.')
        return
      }
      if (!res.ok) {
        alert(data.error ?? 'Something went wrong.')
        return
      }
      if (data.url) {
        window.location.href = data.url
      }
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'center',
        padding: 'var(--space-3) var(--space-4)',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: 500,
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
        backgroundColor: highlighted ? 'var(--accent-primary)' : 'transparent',
        color: highlighted ? '#fff' : 'var(--accent-primary)',
        border: highlighted ? 'none' : '1px solid var(--accent-primary)',
        fontFamily: 'inherit',
        transition: 'opacity 0.15s ease',
      }}
    >
      {loading ? 'Redirecting...' : children}
    </button>
  )
}

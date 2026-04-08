'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

function inputStyle(hasError?: boolean): React.CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'var(--bg-elevated)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: hasError ? 'rgba(239,68,68,0.6)' : 'var(--border-subtle)',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    fontSize: '14px',
    fontFamily: 'inherit',
    padding: '11px 14px',
    outline: 'none',
  }
}

export default function HeroTradeForm() {
  const router = useRouter()
  const [seller, setSeller] = useState('')
  const [vessel, setVessel] = useState('')
  const [touched, setTouched] = useState({ seller: false, vessel: false })

  const sellerErr = touched.seller && seller.trim().length < 2
  const vesselErr = touched.vessel && vessel.trim().length < 2

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setTouched({ seller: true, vessel: true })
    if (seller.trim().length < 2 || vessel.trim().length < 2) return
    const params = new URLSearchParams({
      seller: seller.trim(),
      vessel: vessel.trim(),
    })
    router.push(`/trade?${params.toString()}`)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          <div>
            <input
              type="text"
              value={seller}
              onChange={(e) => setSeller(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, seller: true }))}
              placeholder="Seller / counterparty"
              aria-label="Seller or counterparty name"
              style={inputStyle(sellerErr)}
            />
            {sellerErr && (
              <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>Required</p>
            )}
          </div>
          <div>
            <input
              type="text"
              value={vessel}
              onChange={(e) => setVessel(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, vessel: true }))}
              placeholder="Vessel name or IMO"
              aria-label="Vessel name or IMO number"
              style={inputStyle(vesselErr)}
            />
            {vesselErr && (
              <p style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>Required</p>
            )}
          </div>
        </div>
        <button
          type="submit"
          style={{
            width: '100%',
            fontSize: '14px',
            fontWeight: 600,
            color: '#fff',
            backgroundColor: 'var(--accent-primary)',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 0',
            cursor: 'pointer',
            letterSpacing: '0.01em',
            fontFamily: 'inherit',
          }}
        >
          Check Trade →
        </button>
      </div>
    </form>
  )
}

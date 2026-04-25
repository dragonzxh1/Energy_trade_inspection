'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function SearchBox() {
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setLoading(false)
  }, [searchParams])

  function handleSubmit(e: React.FormEvent, type?: string, requireInput = true) {
    e.preventDefault()
    const trimmed = query.trim()
    if (requireInput && !trimmed) return
    setLoading(true)
    const params = new URLSearchParams()
    if (trimmed) params.set('q', trimmed)
    if (type) params.set('type', type)
    router.push(`/search?${params.toString()}`)
  }

  return (
    <form
      onSubmit={(e) => handleSubmit(e)}
      role="search"
      aria-label="Search for companies, vessels, domains, or emails"
    >
      <div
        className="glass-panel"
        style={{
          borderRadius: '16px',
          padding: '8px',
          transition: 'box-shadow 0.2s ease',
          boxShadow: focused
            ? '0 0 30px rgba(14, 165, 233, 0.25), 0 0 0 1px rgba(14, 165, 233, 0.3)'
            : '0 0 20px rgba(14, 165, 233, 0.15)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-2)' }}>
            {/* Search icon + input */}
            <div
              style={{
                flex: 1,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <svg
                style={{
                  position: 'absolute',
                  left: '16px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '20px',
                  height: '20px',
                  color: 'var(--text-muted)',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <label htmlFor="search-input" className="sr-only">
                Search by company name, registration number, IMO number, domain, or email
              </label>
              <input
                id="search-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by company name, IMO number, email domain, or vessel name..."
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                disabled={loading}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                style={{
                  width: '100%',
                  padding: '14px 16px 14px 48px',
                  backgroundColor: 'rgba(2, 6, 23, 0.5)',
                  border: '1px solid var(--border-solid)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '15px',
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  if (!focused) {
                    e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.2)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!focused) {
                    e.currentTarget.style.borderColor = 'var(--border-solid)'
                  }
                }}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !query.trim()}
              aria-label="Search"
              className="btn-primary btn-ripple"
              style={{
                padding: '14px 28px',
                borderRadius: '12px',
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: 'inherit',
                cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
                opacity: loading || !query.trim() ? 0.6 : 1,
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                border: 'none',
              }}
            >
              <svg
                width="18"
                height="18"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {loading ? 'Searching…' : 'Screen Now'}
            </button>
          </div>

          {/* Type filters */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'var(--space-2)',
              padding: '0 4px 4px',
            }}
          >
            {[
              { label: 'Company', type: 'company' as const },
              { label: 'Vessel / Terminal', type: 'vessel' as const },
              { label: 'Domain Risk', type: undefined, requiresInput: false },
              { label: 'Email Verify', type: undefined, requiresInput: false },
            ].map((f) => (
              <button
                key={f.label}
                type="button"
                onClick={(e) =>
                  handleSubmit(
                    e as unknown as React.FormEvent,
                    f.type,
                    f.requiresInput !== false,
                  )
                }
                disabled={loading}
                className="hover-border-brand"
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  minHeight: '32px',
                  borderRadius: '8px',
                  textDecoration: 'none',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.6 : 1,
                  backgroundColor: 'var(--bg-surface)',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border-solid)',
                  fontFamily: 'inherit',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </form>
  )
}

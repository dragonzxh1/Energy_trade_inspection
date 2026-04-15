'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function SearchBox() {
  const searchParams = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') ?? '')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  // Reset loading when navigation completes (e.g. back button)
  useEffect(() => {
    setLoading(false)
  }, [searchParams])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setLoading(true)
    router.push(`/search?q=${encodeURIComponent(trimmed)}`)
  }

  return (
    <form
      onSubmit={handleSubmit}
      role="search"
      aria-label="Search for companies, vessels, domains, or emails"
    >
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <label htmlFor="search-input" className="sr-only">
          Search by company name, registration number, IMO number, domain, or email
        </label>
        <input
          id="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Company name, IMO number, domain, or email…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={loading}
          style={{
            flexGrow: 1,
            backgroundColor: 'var(--bg-elevated)',
            borderWidth: '1px',
            borderStyle: 'solid',
            borderColor: 'var(--border-subtle)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            fontSize: '15px',
            fontFamily: 'inherit',
            paddingTop: 'var(--space-3)',
            paddingBottom: 'var(--space-3)',
            paddingLeft: 'var(--space-4)',
            paddingRight: 'var(--space-4)',
            outlineStyle: 'none',
            transitionProperty: 'border-color, box-shadow',
            transitionDuration: '0.2s',
            transitionTimingFunction: 'ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-primary)'
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.15)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)'
            e.currentTarget.style.boxShadow = 'none'
          }}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          aria-label="Search"
          className="btn-ripple"
          style={{
            backgroundColor: 'var(--accent-primary)',
            borderWidth: 0,
            borderStyle: 'none',
            borderRadius: '8px',
            color: '#fff',
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontFamily: 'inherit',
            fontWeight: 500,
            opacity: loading || !query.trim() ? 0.6 : 1,
            paddingTop: 'var(--space-3)',
            paddingBottom: 'var(--space-3)',
            paddingLeft: 'var(--space-5)',
            paddingRight: 'var(--space-5)',
            transitionProperty: 'opacity',
            transitionDuration: '0.15s',
            transitionTimingFunction: 'ease',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
    </form>
  )
}

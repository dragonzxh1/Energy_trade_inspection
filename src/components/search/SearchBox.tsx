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
      aria-label="Search for companies or vessels"
    >
      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <label htmlFor="search-input" className="sr-only">
          Search by company name, registration number, or IMO number
        </label>
        <input
          id="search-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Company name, registration number, or IMO…"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={loading}
          style={{
            flex: 1,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            fontSize: '15px',
            fontFamily: 'inherit',
            padding: 'var(--space-3) var(--space-4)',
            outline: 'none',
            transition: 'border-color 0.15s ease',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent-primary)'
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-subtle)'
          }}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          aria-label="Search"
          style={{
            backgroundColor: 'var(--accent-primary)',
            border: 'none',
            borderRadius: '8px',
            color: '#fff',
            cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            fontSize: '14px',
            fontFamily: 'inherit',
            fontWeight: 500,
            opacity: loading || !query.trim() ? 0.6 : 1,
            padding: 'var(--space-3) var(--space-5)',
            transition: 'opacity 0.15s ease',
            whiteSpace: 'nowrap',
          }}
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </div>
    </form>
  )
}

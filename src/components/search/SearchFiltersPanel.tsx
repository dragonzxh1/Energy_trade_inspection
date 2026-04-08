'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { SearchResult, RiskLevel } from '@/lib/types'
import { getScoreTier, countryCodeToFlag } from '@/lib/utils'
import SanctionBadge from '@/components/entity/SanctionBadge'

// ── Types ─────────────────────────────────────────────────────────────────────

type SanctionFilter = 'all' | 'listed' | 'not_listed'
type SortKey = 'risk' | 'score_asc' | 'score_desc' | 'name'

// ── Constants ─────────────────────────────────────────────────────────────────

const RISK_COLOR: Record<RiskLevel, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
}

const RISK_LEVELS: RiskLevel[] = ['critical', 'high', 'medium', 'low']

const RISK_LABEL: Record<RiskLevel, string> = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
}

const MIN_SCORE_OPTIONS: { label: string; value: number }[] = [
  { label: 'Score ≥ 40', value: 40 },
  { label: 'Score ≥ 60', value: 60 },
  { label: 'Score ≥ 80', value: 80 },
]

const SORT_OPTIONS: { label: string; value: SortKey }[] = [
  { label: 'Risk',        value: 'risk'       },
  { label: 'Score ↓',    value: 'score_desc'  },
  { label: 'Score ↑',    value: 'score_asc'   },
  { label: 'Name A–Z',   value: 'name'        },
]

const RISK_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

// ── EntityCard (client-safe copy) ─────────────────────────────────────────────

function EntityCard({ result }: { result: SearchResult }) {
  const href = result.type === 'vessel'
    ? `/vessel/${result.imo}`
    : `/company/${result.slug}`
  const tier = getScoreTier(result.authenticityScore)

  return (
    <li>
      <Link
        href={href}
        className={`search-result-card search-result-card--${result.sanctionStatus}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: '8px',
          borderWidth: '1px',
          borderStyle: 'solid',
          textDecoration: 'none',
          gap: 'var(--space-4)',
        }}
      >
        {/* Left: name + meta */}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
            <span
              style={{
                width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0,
                backgroundColor: RISK_COLOR[result.riskLevel] ?? 'var(--text-muted)',
              }}
              title={`Risk: ${result.riskLevel}`}
            />
            <span style={{
              color: 'var(--text-primary)', fontSize: '14px', fontWeight: 500,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {result.name}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase',
              color: 'var(--text-muted)', backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-subtle)', borderRadius: '4px', padding: '1px 6px',
            }}>
              {result.type === 'vessel' ? 'Vessel' : result.type === 'terminal' ? 'Terminal' : 'Company'}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>
              {countryCodeToFlag(result.jurisdictionFlag)} {result.country}
            </span>
            {result.type === 'vessel' && result.vesselType && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>{result.vesselType}</span>
              </>
            )}
            {result.type === 'vessel' && result.imo && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }} className="mono">IMO {result.imo}</span>
              </>
            )}
            {result.type === 'company' && result.registrationNumber && (
              <>
                <span style={{ color: 'var(--border-subtle)', fontSize: '12px' }}>·</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px' }} className="mono">{result.registrationNumber}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: score + badge */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
          <SanctionBadge status={result.sanctionStatus} size="sm" />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Score{' '}
            <strong style={{
              color: result.authenticityScore >= 70 ? '#22c55e' : result.authenticityScore >= 40 ? '#eab308' : '#ef4444',
              fontWeight: 600,
            }}>
              {result.authenticityScore}
            </strong>
            {' '}
            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{tier}</span>
          </span>
        </div>
      </Link>
    </li>
  )
}

// ── Filter chip ────────────────────────────────────────────────────────────────

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean
  color?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: '11px',
        fontWeight: active ? 600 : 400,
        padding: '4px 10px',
        borderRadius: '20px',
        border: `1px solid ${active && color ? color : 'var(--border-subtle)'}`,
        backgroundColor: active && color ? `${color}20` : 'var(--bg-elevated)',
        color: active && color ? color : 'var(--text-muted)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.12s ease',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props {
  results: SearchResult[]
  query: string
  entityType: string
}

export default function SearchFiltersPanel({ results, query, entityType }: Props) {
  const [riskFilter, setRiskFilter]         = useState<Set<RiskLevel>>(new Set())
  const [sanctionFilter, setSanctionFilter] = useState<SanctionFilter>('all')
  const [countryFilter, setCountryFilter]   = useState<string>('all')
  const [minScore, setMinScore]             = useState<number>(0)
  const [sortKey, setSortKey]               = useState<SortKey>('risk')

  // Derive unique countries from the result set
  const countries = useMemo(() => {
    const seen = new Map<string, string>() // country → "flag country"
    for (const r of results) {
      if (r.country && !seen.has(r.country)) {
        seen.set(r.country, `${countryCodeToFlag(r.jurisdictionFlag)} ${r.country}`)
      }
    }
    return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [results])

  const isFiltered =
    riskFilter.size > 0 ||
    sanctionFilter !== 'all' ||
    countryFilter !== 'all' ||
    minScore > 0 ||
    sortKey !== 'risk'

  const filtered = useMemo(() => {
    const base = results.filter((r) => {
      if (riskFilter.size > 0 && !riskFilter.has(r.riskLevel)) return false
      if (sanctionFilter === 'listed'     && r.sanctionStatus !== 'listed')     return false
      if (sanctionFilter === 'not_listed' && r.sanctionStatus !== 'not_listed') return false
      if (countryFilter !== 'all' && r.country !== countryFilter) return false
      if (minScore > 0 && r.authenticityScore < minScore) return false
      return true
    })

    return [...base].sort((a, b) => {
      if (sortKey === 'risk') {
        const rd = (RISK_ORDER[a.riskLevel] ?? 9) - (RISK_ORDER[b.riskLevel] ?? 9)
        return rd !== 0 ? rd : b.authenticityScore - a.authenticityScore
      }
      if (sortKey === 'score_desc') return b.authenticityScore - a.authenticityScore
      if (sortKey === 'score_asc')  return a.authenticityScore - b.authenticityScore
      if (sortKey === 'name')       return a.name.localeCompare(b.name)
      return 0
    })
  }, [results, riskFilter, sanctionFilter, countryFilter, minScore, sortKey])

  function toggleRisk(level: RiskLevel) {
    setRiskFilter((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  function clearAll() {
    setRiskFilter(new Set())
    setSanctionFilter('all')
    setCountryFilter('all')
    setMinScore(0)
    setSortKey('risk')
  }

  return (
    <>
      {/* Filter bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 'var(--space-2)',
        alignItems: 'center',
        marginBottom: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        backgroundColor: 'var(--bg-surface)',
        borderRadius: '8px',
        border: '1px solid var(--border-subtle)',
      }}>
        {/* Risk level */}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px', flexShrink: 0 }}>
          Risk:
        </span>
        {RISK_LEVELS.map((level) => (
          <Chip
            key={level}
            active={riskFilter.has(level)}
            color={RISK_COLOR[level]}
            onClick={() => toggleRisk(level)}
          >
            {RISK_LABEL[level]}
          </Chip>
        ))}

        {/* Divider */}
        <span style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />

        {/* Sanction status */}
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px', flexShrink: 0 }}>
          Sanctions:
        </span>
        <Chip
          active={sanctionFilter === 'listed'}
          color="#ef4444"
          onClick={() => setSanctionFilter(sanctionFilter === 'listed' ? 'all' : 'listed')}
        >
          Listed only
        </Chip>
        <Chip
          active={sanctionFilter === 'not_listed'}
          color="#22c55e"
          onClick={() => setSanctionFilter(sanctionFilter === 'not_listed' ? 'all' : 'not_listed')}
        >
          Clear only
        </Chip>

        {/* Country filter — only show if >1 country in results */}
        {countries.length > 1 && (
          <>
            <span style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px', flexShrink: 0 }}>
              Country:
            </span>
            <select
              value={countryFilter}
              onChange={(e) => setCountryFilter(e.target.value)}
              style={{
                fontSize: '11px',
                color: countryFilter !== 'all' ? 'var(--text-primary)' : 'var(--text-muted)',
                backgroundColor: 'var(--bg-elevated)',
                border: `1px solid ${countryFilter !== 'all' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
                borderRadius: '20px',
                padding: '4px 8px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            >
              <option value="all">All countries</option>
              {countries.map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </>
        )}

        {/* Min score filter */}
        <span style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px', flexShrink: 0 }}>
          Score:
        </span>
        {MIN_SCORE_OPTIONS.map((opt) => (
          <Chip
            key={opt.value}
            active={minScore === opt.value}
            color="var(--accent-primary)"
            onClick={() => setMinScore(minScore === opt.value ? 0 : opt.value)}
          >
            {opt.label}
          </Chip>
        ))}

        {/* Sort */}
        <span style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginRight: '2px', flexShrink: 0 }}>
          Sort:
        </span>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          style={{
            fontSize: '11px',
            color: sortKey !== 'risk' ? 'var(--text-primary)' : 'var(--text-muted)',
            backgroundColor: 'var(--bg-elevated)',
            border: `1px solid ${sortKey !== 'risk' ? 'var(--accent-primary)' : 'var(--border-subtle)'}`,
            borderRadius: '20px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {/* Clear all */}
        {isFiltered && (
          <>
            <span style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-subtle)', margin: '0 4px', flexShrink: 0 }} />
            <button
              onClick={clearAll}
              style={{
                fontSize: '11px',
                color: 'var(--accent-primary)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 6px',
                fontFamily: 'inherit',
              }}
            >
              Clear filters
            </button>
          </>
        )}
      </div>

      {/* Result count */}
      <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: 'var(--space-5)' }}>
        {isFiltered
          ? <>{filtered.length} of {results.length} result{results.length !== 1 ? 's' : ''}</>
          : <>{results.length} result{results.length !== 1 ? 's' : ''}</>
        }
        {query && (
          <> for <strong style={{ color: 'var(--text-secondary)' }}>&ldquo;{query}&rdquo;</strong></>
        )}
        {entityType && entityType !== 'all' && (
          <span> · {entityType === 'company' ? 'Companies' : 'Vessels'}</span>
        )}
      </p>

      {/* Results list */}
      {filtered.length === 0 ? (
        <div style={{
          padding: 'var(--space-10)', textAlign: 'center',
          backgroundColor: 'var(--bg-surface)', borderRadius: '10px',
          border: '1px solid var(--border-subtle)',
        }}>
          <p style={{ fontSize: '15px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: 'var(--space-3)' }}>
            No results match current filters
          </p>
          <button
            onClick={clearAll}
            style={{
              fontSize: '13px', color: 'var(--accent-primary)', background: 'none',
              border: 'none', cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Clear filters →
          </button>
        </div>
      ) : (
        <ul role="list" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {filtered.map((r) => <EntityCard key={r.id} result={r} />)}
        </ul>
      )}
    </>
  )
}

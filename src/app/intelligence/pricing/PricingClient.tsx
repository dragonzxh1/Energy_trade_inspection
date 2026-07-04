'use client'

import { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

const COMMODITIES = [
  { key: 'diesel-gasoil', label: 'ULSD 10ppm / Gasoil', color: '#38bdf8' },
  { key: 'jet-fuel', label: 'JET-A1', color: '#f59e0b' },
  { key: 'gasoline', label: 'Gasoline Prem. 10ppm', color: '#ef4444' },
  { key: 'naphtha', label: 'Naphtha', color: '#22c55e' },
  { key: 'fuel-oil', label: 'Fuel Oil', color: '#a855f7' },
]

const REGION_COLORS = ['#38bdf8','#f59e0b','#ef4444','#22c55e','#a855f7','#06b6d4','#f97316','#e11d48','#84cc16','#ec4899','#8b5cf6','#14b8a6']
function getColor(i: number) { return REGION_COLORS[i % REGION_COLORS.length] }

interface PricePoint { date: string; price: number; change: number | null }
interface FlatRow {
  recorded_at: string; commodity: string; product: string; location: string
  code: string; price: number; change: number | null; unit: string; source_file_name: string
}

type ViewMode = 'panel' | 'region' | 'table'

function formatChange(c: number | null): string {
  if (c == null) return '-'
  const sign = c >= 0 ? '+' : ''
  return `${sign}${c.toFixed(2)}`
}

export default function PricingClient() {
  const [data, setData] = useState<{ flat: FlatRow[]; dates: string[]; date_range: { earliest: string | null; latest: string | null } } | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('panel')
  const [chartMetric, setChartMetric] = useState<'price' | 'change'>('price')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedRegion, setSelectedRegion] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/pricing/history?days=90')
      .then(r => r.json())
      .then(d => {
        const dateSet = new Set<string>()
        for (const row of (d.flat || [])) {
          const dt = row.recorded_at?.substring(0, 10)
          if (dt) dateSet.add(dt)
        }
        const dates = Array.from(dateSet).sort().reverse()
        setData({ ...d, dates, date_range: d.date_range })
        if (dates.length > 0) setSelectedDate(dates[0])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Filter flat rows by selected date
  const filteredRows = useMemo(() => {
    if (!data) return []
    if (!selectedDate) return data.flat
    return data.flat.filter(r => r.recorded_at?.substring(0, 10) === selectedDate)
  }, [data, selectedDate])

  // Merge BBL + MT rows: key=date|commodity|product|location
  // Chart lines only use MT. Table shows MT as main + BBL as extra column.
  const mergedRows = useMemo(() => {
    if (!data) return []
    const map = new Map<string, { mt: FlatRow | null; bbl: FlatRow | null }>()
    for (const row of data.flat) {
      const key = `${row.recorded_at?.substring(0,10)}|${row.commodity}|${row.product}|${row.location}`
      if (!map.has(key)) map.set(key, { mt: null, bbl: null })
      const entry = map.get(key)!
      if (row.unit === 'bbl') entry.bbl = row
      else entry.mt = row  // mt or any non-bbl unit
    }
    return Array.from(map.entries()).map(([key, { mt, bbl }]) => ({
      key,
      mt,
      bbl,
      bblPrice: bbl?.price ?? null,
      bblChange: bbl?.change ?? null,
      // display row = mt if exists, otherwise bbl
      display: mt ?? bbl!,
    })).filter(r => r.display)
  }, [data])

  // Merged rows filtered by date (for table)
  const mergedFiltered = useMemo(() => {
    if (!selectedDate) return mergedRows
    const d = selectedDate
    return mergedRows.filter(r => r.display.recorded_at?.substring(0, 10) === d)
  }, [mergedRows, selectedDate])

  // Group MT-only for charts: commodity -> location -> [PricePoint]
  const groupedMt = useMemo(() => {
    if (!data) return {}
    const g: Record<string, Record<string, PricePoint[]>> = {}
    for (const row of data.flat) {
      if (row.unit === 'bbl') continue  // chart only MT
      const locKey = row.location || 'Unknown'
      if (!g[row.commodity]) g[row.commodity] = {}
      if (!g[row.commodity][locKey]) g[row.commodity][locKey] = []
      g[row.commodity][locKey].push({
        date: row.recorded_at?.substring(0, 10) || '',
        price: row.price,
        change: row.change,
      })
    }
    for (const comm of Object.values(g)) {
      for (const loc of Object.values(comm)) {
        loc.sort((a, b) => a.date.localeCompare(b.date))
      }
    }
    return g
  }, [data])

  // Region view: region -> commodity -> [PricePoint] (MT only)
  const regionDataMt = useMemo(() => {
    const result: Record<string, Record<string, PricePoint[]>> = {}
    for (const [comm, locations] of Object.entries(groupedMt)) {
      for (const [loc, points] of Object.entries(locations)) {
        if (!result[loc]) result[loc] = {}
        result[loc][comm] = points
      }
    }
    return result
  }, [groupedMt])

  const allRegions = useMemo(() => {
    return Object.keys(regionDataMt).filter(r => r && r !== 'Unknown').sort()
  }, [regionDataMt])

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400, color: '#64748b' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>&#9776;</div>
        Loading pricing data...
      </div>
    </div>
  )

  if (!data || data.flat.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400, color: '#64748b' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>&#128200;</div>
          <p style={{ fontSize: '1.1rem' }}>No pricing data available yet.</p>
          <p style={{ fontSize: '0.85rem' }}>Upload Platts screenshots to populate the dashboard.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1500, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ color: '#f1f5f9', fontSize: '1.6rem', margin: 0, fontWeight: 600 }}>Energy Pricing Dashboard</h1>
          <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            {data.date_range.earliest ?? '...'} &rarr; {data.date_range.latest ?? '...'} &middot; {data.flat.length} data points &middot; {data.dates.length} dates &middot; All charts in MT
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Date:</span>
          <select
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{
              background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155',
              borderRadius: 8, padding: '0.5rem 2rem 0.5rem 1rem', fontSize: '0.9rem',
              cursor: 'pointer', appearance: 'auto' as any,
            }}
          >
            <option value="">All dates (trends)</option>
            {data.dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Controls bar */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', background: '#1e293b', borderRadius: 8, overflow: 'hidden' }}>
          {(['panel','region','table'] as ViewMode[]).map(m => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              style={{
                padding: '0.5rem 1.2rem', border: 'none', cursor: 'pointer',
                background: viewMode === m ? '#3b82f6' : 'transparent',
                color: viewMode === m ? '#fff' : '#94a3b8',
                fontSize: '0.9rem', fontWeight: 500, transition: 'all 0.2s',
              }}
            >
              {m === 'panel' ? 'By Product' : m === 'region' ? 'By Region' : 'Data Table'}
            </button>
          ))}
        </div>
        {viewMode !== 'table' && (
          <select value={chartMetric} onChange={e => setChartMetric(e.target.value as any)}
            style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '0.5rem 1rem', fontSize: '0.85rem' }}>
            <option value="price">Absolute Price</option>
            <option value="change">Daily Change</option>
          </select>
        )}
        <span style={{ color: '#475569', fontSize: '0.8rem', marginLeft: 'auto' }}>
          {selectedDate ? `Showing: ${selectedDate}` : 'Showing: All trends'}
        </span>
      </div>

      {/* PANEL VIEW - By Product (MT only) */}
      {viewMode === 'panel' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {COMMODITIES.filter(c => groupedMt[c.key]).map(comm => {
            const locations = groupedMt[comm.key]
            const locEntries = Object.entries(locations).filter(([, points]) => points.length > 0)
            if (locEntries.length === 0) return null

            const dateMap: Record<string, Record<string, number>> = {}
            for (const [loc, points] of locEntries) {
              for (const p of points) {
                if (!dateMap[p.date]) dateMap[p.date] = {}
                dateMap[p.date][loc] = chartMetric === 'change' ? (p.change ?? 0) : p.price
              }
            }
            const chartData = Object.entries(dateMap)
              .map(([date, vals]) => ({ date: date.substring(5), ...vals }))
              .sort((a, b) => a.date.localeCompare(b.date))

            // Today snapshot from merged rows (shows MT + optional BBL)
            const todayMerged = mergedFiltered.filter(r => r.display.commodity === comm.key)

            return (
              <div key={comm.key} style={{ background: '#0f172a', borderRadius: 12, padding: '1.5rem', border: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: comm.color, flexShrink: 0 }} />
                  <h3 style={{ color: '#f1f5f9', margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>{comm.label}</h3>
                  <span style={{ color: '#64748b', fontSize: '0.8rem' }}>{locEntries.length} locations (MT)</span>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} width={75}
                      label={{ value: chartMetric === 'change' ? 'Change (USD/MT)' : 'Price (USD/MT)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11, style: { textAnchor: 'middle' } }} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: '0.85rem' }} />
                    <Legend wrapperStyle={{ fontSize: '0.8rem' }} />
                    {locEntries.map(([loc], i) => (
                      <Line key={loc} type="monotone" dataKey={loc} name={loc} stroke={getColor(i)} strokeWidth={2} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
                {selectedDate && todayMerged.length > 0 && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <table style={{ width: '100%', fontSize: '0.78rem', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ color: '#64748b', borderBottom: '1px solid #1e293b' }}>
                          <th style={{ padding: '4px 8px', textAlign: 'left' }}>Location</th>
                          <th style={{ padding: '4px 8px', textAlign: 'left' }}>Product</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>MT Price</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>MT Chg</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>BBL Price</th>
                          <th style={{ padding: '4px 8px', textAlign: 'right' }}>BBL Chg</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayMerged.map((r, i) => (
                          <tr key={i} style={{ borderTop: '1px solid #1e293b', color: '#cbd5e1' }}>
                            <td style={{ padding: '3px 8px', color: '#94a3b8' }}>{r.display.location}</td>
                            <td style={{ padding: '3px 8px' }}>{r.display.product}</td>
                            <td style={{ padding: '3px 8px', textAlign: 'right', fontWeight: 500, fontFamily: 'monospace' }}>{r.display.price?.toFixed(2)}</td>
                            <td style={{ padding: '3px 8px', textAlign: 'right', color: (r.display.change ?? 0) >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace' }}>
                              {formatChange(r.display.change)}
                            </td>
                            <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>
                              {r.bblPrice != null ? r.bblPrice.toFixed(2) : '-'}
                            </td>
                            <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'monospace', color: r.bblChange != null ? ((r.bblChange >= 0 ? '#22c55e' : '#ef4444')) : '#64748b' }}>
                              {formatChange(r.bblChange)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* REGION VIEW - MT only */}
      {viewMode === 'region' && (
        <div>
          <div style={{ marginBottom: '1rem' }}>
            <select value={selectedRegion || allRegions[0] || ''} onChange={e => setSelectedRegion(e.target.value)}
              style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
              {allRegions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {(() => {
            const region = selectedRegion || allRegions[0]
            if (!region || !regionDataMt[region]) return <div style={{ color: '#64748b' }}>Select a region.</div>

            const commodities = regionDataMt[region]
            const commEntries = Object.entries(commodities).filter(([, points]) => points.length > 0)
            if (commEntries.length === 0) return <div style={{ color: '#64748b' }}>No MT data for this region.</div>

            const dateMap: Record<string, Record<string, number>> = {}
            for (const [comm, points] of commEntries) {
              for (const p of points) {
                if (!dateMap[p.date]) dateMap[p.date] = {}
                dateMap[p.date][comm] = chartMetric === 'change' ? (p.change ?? 0) : p.price
              }
            }
            const chartData = Object.entries(dateMap)
              .map(([date, vals]) => ({ date: date.substring(5), ...vals }))
              .sort((a, b) => a.date.localeCompare(b.date))

            return (
              <div style={{ background: '#0f172a', borderRadius: 12, padding: '1.5rem', border: '1px solid #1e293b' }}>
                <h3 style={{ color: '#38bdf8', margin: '0 0 1rem', fontSize: '1.1rem' }}>{region} &mdash; MT</h3>
                <ResponsiveContainer width="100%" height={400}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#64748b', fontSize: 11 }} width={70}
                      label={{ value: chartMetric === 'change' ? 'Change (USD/MT)' : 'Price (USD/MT)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 11, style: { textAnchor: 'middle' } }} />
                    <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0' }} />
                    <Legend />
                    {commEntries.map(([comm], i) => (
                      <Bar key={comm} dataKey={comm} name={comm} fill={getColor(i)} radius={[3, 3, 0, 0]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )
          })()}
        </div>
      )}

      {/* TABLE VIEW - MT rows with BBL as extra columns */}
      {viewMode === 'table' && (
        <div style={{ background: '#0f172a', borderRadius: 12, padding: '1rem', border: '1px solid #1e293b', overflow: 'auto' }}>
          {selectedDate && (
            <div style={{ marginBottom: '0.75rem', color: '#94a3b8', fontSize: '0.85rem' }}>
              Showing data for: <strong style={{ color: '#e2e8f0' }}>{selectedDate}</strong>
              &middot; {mergedFiltered.length} rows
            </div>
          )}
          <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left', borderBottom: '2px solid #1e293b', position: 'sticky', top: 0, background: '#0f172a' }}>
                <th style={{ padding: '8px' }}>Commodity</th>
                <th style={{ padding: '8px' }}>Product</th>
                <th style={{ padding: '8px' }}>Location</th>
                <th style={{ padding: '8px' }}>Code</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>MT Price</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>MT Chg</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>BBL Price</th>
                <th style={{ padding: '8px', textAlign: 'right' }}>BBL Chg</th>
                <th style={{ padding: '8px' }}>Unit</th>
              </tr>
            </thead>
            <tbody>
              {mergedFiltered.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>Select a date to view data</td></tr>
              ) : (
                mergedFiltered.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #1e293b', color: '#cbd5e1' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                        background: COMMODITIES.find(c => c.key === r.display.commodity)?.color + '22',
                        color: COMMODITIES.find(c => c.key === r.display.commodity)?.color || '#94a3b8',
                        fontSize: '0.75rem', fontWeight: 500,
                      }}>
                        {COMMODITIES.find(c => c.key === r.display.commodity)?.label || r.display.commodity}
                      </span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>{r.display.product}</td>
                    <td style={{ padding: '6px 8px' }}>{r.display.location}</td>
                    <td style={{ padding: '6px 8px', color: '#64748b', fontFamily: 'monospace', fontSize: '0.78rem' }}>{r.display.code}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 500, fontFamily: 'monospace' }}>{r.display.price?.toFixed(2)}</td>
                    <td style={{
                      padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace',
                      color: (r.display.change ?? 0) >= 0 ? '#22c55e' : '#ef4444',
                      fontWeight: (r.display.change ?? 0) !== 0 ? 500 : 400,
                    }}>
                      {formatChange(r.display.change)}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>
                      {r.bblPrice != null ? r.bblPrice.toFixed(2) : '-'}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: r.bblChange != null ? ((r.bblChange >= 0 ? '#22c55e' : '#ef4444')) : '#64748b' }}>
                      {formatChange(r.bblChange)}
                    </td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.display.unit}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
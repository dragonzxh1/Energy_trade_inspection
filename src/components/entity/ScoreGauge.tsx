'use client'

import { useEffect, useRef, useState } from 'react'
import { GAUGE_RADIUS, GAUGE_CIRCUMFERENCE, SCORE_DIMENSIONS } from '@/lib/constants'
import { getGaugeOffset, getRiskColor, getRiskLevel } from '@/lib/utils'
import type { ScoreBreakdown, ScoreTier } from '@/lib/types'

interface ScoreGaugeProps {
  score: number
  tier: ScoreTier
  breakdown: ScoreBreakdown
}

const TIER_LABELS: Record<ScoreTier, string> = {
  'Verified': 'Verified',
  'Mostly Verified': 'Mostly Verified',
  'Partially Verified': 'Partially Verified',
  'Insufficient': 'Insufficient Data',
  'Suspicious': 'Suspicious',
}

export default function ScoreGauge({ score, tier, breakdown }: ScoreGaugeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [animated, setAnimated] = useState(false)
  const [displayScore, setDisplayScore] = useState(0)

  // Animate gauge on first visibility (skip if reduced motion is preferred)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setAnimated(true)
      setDisplayScore(score)
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setAnimated(true)
          observer.disconnect()
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [score])

  // Count-up animation when gauge becomes visible
  useEffect(() => {
    if (!animated) return
    const duration = 1200
    const start = performance.now()
    let raf = 0
    function tick(now: number) {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayScore(Math.round(eased * score))
      if (progress < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animated, score])

  const offset = animated ? getGaugeOffset(score) : GAUGE_CIRCUMFERENCE
  const strokeColor = getRiskColor(getRiskLevel(score))
  const cx = GAUGE_RADIUS + 8  // 8px padding
  const cy = GAUGE_RADIUS + 8
  const svgSize = (GAUGE_RADIUS + 8) * 2

  return (
    <div ref={containerRef} aria-label={`Authenticity score: ${score} out of 100`}>
      {/* Circular gauge */}
      <div style={{ position: 'relative', width: svgSize, height: svgSize, margin: '0 auto' }}>
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          role="img"
          aria-hidden="true"
        >
          {/* Track */}
          <circle
            cx={cx}
            cy={cy}
            r={GAUGE_RADIUS}
            fill="none"
            stroke="var(--bg-elevated)"
            strokeWidth="8"
          />
          {/* Progress arc */}
          <circle
            cx={cx}
            cy={cy}
            r={GAUGE_RADIUS}
            fill="none"
            stroke={strokeColor}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={GAUGE_CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${cx} ${cy})`}
            style={{
              transition: animated ? 'stroke-dashoffset 1.2s cubic-bezier(0.33, 1, 0.68, 1)' : 'none',
            }}
          />
        </svg>

        {/* Score text centred in gauge */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              color: strokeColor,
              fontSize: '32px',
              fontWeight: 700,
              lineHeight: 1,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {displayScore}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px', marginTop: '2px' }}>
            / 100
          </span>
        </div>
      </div>

      {/* Tier label */}
      <p
        style={{
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '13px',
          fontWeight: 500,
          marginTop: 'var(--space-3)',
        }}
      >
        {TIER_LABELS[tier]}
      </p>

      {/* Dimension breakdown */}
      <div style={{ marginTop: 'var(--space-4)' }}>
        {(Object.entries(SCORE_DIMENSIONS) as [keyof ScoreBreakdown, typeof SCORE_DIMENSIONS[keyof typeof SCORE_DIMENSIONS]][]).map(
          ([key, dim], index) => {
            const entry = breakdown[key]
            const isPending = entry.phase2Pending
            const pct = isPending ? 0 : Math.round((entry.score / entry.maxScore) * 100)

            return (
              <div
                key={key}
                style={{ marginBottom: 'var(--space-3)' }}
                title={isPending ? 'Phase 2 data — coming soon' : undefined}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginBottom: '4px',
                  }}
                >
                  <span style={{ color: 'var(--text-secondary)', fontSize: '11px' }}>
                    {dim.label}
                  </span>
                  <span
                    className="mono"
                    style={{
                      color: isPending ? 'var(--text-muted)' : 'var(--text-primary)',
                      fontSize: '11px',
                    }}
                  >
                    {isPending ? '—' : `${entry.score}/${entry.maxScore}`}
                  </span>
                </div>
                <div
                  style={{
                    height: '3px',
                    backgroundColor: 'var(--bg-elevated)',
                    borderRadius: '2px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      backgroundColor: isPending ? 'var(--bg-elevated)' : strokeColor,
                      borderRadius: '2px',
                      transition: animated ? `width 1s cubic-bezier(0.33, 1, 0.68, 1) ${0.2 + index * 0.08}s` : 'none',
                    }}
                  />
                </div>
                {entry.evidence && entry.evidence.length > 0 && (
                  <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
                    {entry.evidence.map((ev, i) => (
                      <li
                        key={i}
                        style={{
                          fontSize: '10px',
                          color: 'var(--text-muted)',
                          lineHeight: '1.5',
                          paddingLeft: '10px',
                          position: 'relative',
                        }}
                      >
                        <span
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            left: 0,
                            color: isPending ? 'var(--text-muted)' : strokeColor,
                            opacity: 0.6,
                          }}
                        >
                          ·
                        </span>
                        {ev}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          }
        )}
      </div>

      <p
        style={{
          marginTop: 'var(--space-3)',
          color: 'var(--text-muted)',
          fontSize: '11px',
          lineHeight: '16px',
        }}
      >
        Phase 1 data only (max 75). Trading Track Record unlocks in Phase 2.
      </p>
    </div>
  )
}

'use client'

import { useState, useEffect } from 'react'

export interface GlowStep {
  keyword: string  // shown in the animated glow text
  label: string    // shown in the step list below
}

interface GlowLoaderProps {
  steps: GlowStep[]
  subtext?: string
  stepDuration?: number  // ms per step, default 5000
}

export default function GlowLoader({ steps, subtext, stepDuration = 5000 }: GlowLoaderProps) {
  const [currentStep, setCurrentStep] = useState(0)

  useEffect(() => {
    if (steps.length <= 1) return
    const interval = setInterval(() => {
      setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1))
    }, stepDuration)
    return () => clearInterval(interval)
  }, [steps.length, stepDuration])

  const keyword = steps[currentStep]?.keyword ?? ''
  const letters = keyword.split('')

  return (
    <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-4)' }}>
      {/* Animated keyword — key forces remount on step change to restart animation */}
      <div key={currentStep} className="glow-loader-wrapper">
        <div className="glow-loader" />
        {letters.map((letter, i) => (
          <span
            key={i}
            className="glow-loader-letter"
            style={{ animationDelay: `${0.1 + i * 0.105}s` }}
          >
            {letter === ' ' ? '\u00A0' : letter}
          </span>
        ))}
      </div>

      {subtext && (
        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '13px',
          fontWeight: 500,
          marginTop: 'var(--space-3)',
          maxWidth: '400px',
          margin: 'var(--space-3) auto 0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {subtext}
        </p>
      )}

      {/* Step list */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
        maxWidth: '320px',
        margin: 'var(--space-5) auto 0',
      }}>
        {steps.map((step, i) => {
          const isDone    = i < currentStep
          const isCurrent = i === currentStep
          return (
            <p
              key={i}
              style={{
                margin: 0,
                fontSize: '12px',
                fontWeight: isCurrent ? 600 : 400,
                color: isCurrent
                  ? 'var(--text-primary)'
                  : isDone
                  ? 'var(--text-muted)'
                  : 'var(--border-default)',
                transition: 'color 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <span style={{
                fontSize: '10px',
                color: isDone ? '#22c55e' : isCurrent ? 'var(--accent-primary)' : 'transparent',
              }}>
                {isDone ? '✓' : isCurrent ? '›' : '·'}
              </span>
              {step.label}
            </p>
          )
        })}
      </div>
    </div>
  )
}

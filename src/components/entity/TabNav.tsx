'use client'

import { useRef, useState } from 'react'

interface Tab {
  id: string
  label: string
}

interface TabNavProps {
  tabs: Tab[]
  defaultTab: string
  panels?: React.ReactNode[]
  onChange?: (id: string) => void
}

/**
 * ARIA-compliant tab navigation with optional panel rendering.
 * Panels are passed as ReactNode[] in same order as tabs.
 * Content computed on the server; client manages visibility.
 */
export default function TabNav({ tabs, defaultTab, panels, onChange }: TabNavProps) {
  const [active, setActive] = useState(defaultTab)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  function handleSelect(id: string) {
    setActive(id)
    onChange?.(id)
  }

  function handleKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index
    if (e.key === 'ArrowRight') {
      next = (index + 1) % tabs.length
    } else if (e.key === 'ArrowLeft') {
      next = (index - 1 + tabs.length) % tabs.length
    } else if (e.key === 'Home') {
      next = 0
    } else if (e.key === 'End') {
      next = tabs.length - 1
    } else {
      return
    }
    e.preventDefault()
    tabRefs.current[next]?.focus()
    handleSelect(tabs[next].id)
  }

  const activeIndex = tabs.findIndex((t) => t.id === active)

  return (
    <div>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Entity information sections"
        style={{
          display: 'flex',
          gap: '0',
          borderBottom: '1px solid var(--border-subtle)',
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {tabs.map((tab, i) => {
          const isActive = tab.id === active
          return (
            <button
              key={tab.id}
              ref={(el) => { tabRefs.current[i] = el }}
              role="tab"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => handleSelect(tab.id)}
              onKeyDown={(e) => handleKeyDown(e, i)}
              style={{
                position: 'relative',
                padding: 'var(--space-3) var(--space-4)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                fontSize: '13px',
                fontWeight: isActive ? 500 : 400,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                transition: 'color 0.15s ease',
                outline: 'none',
              }}
              onFocus={(e) => {
                e.currentTarget.style.outline = '2px solid var(--accent-primary)'
                e.currentTarget.style.outlineOffset = '-2px'
              }}
              onBlur={(e) => {
                e.currentTarget.style.outline = 'none'
              }}
            >
              {tab.label}
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  bottom: '-1px',
                  left: 'var(--space-4)',
                  right: 'var(--space-4)',
                  height: '2px',
                  backgroundColor: 'var(--accent-primary)',
                  borderRadius: '1px 1px 0 0',
                  transform: isActive ? 'scaleX(1)' : 'scaleX(0)',
                  transition: 'transform 0.2s cubic-bezier(0.33, 1, 0.68, 1)',
                  transformOrigin: 'left',
                }}
              />
            </button>
          )
        })}
      </div>

      {/* Tab panels */}
      {panels && tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={i !== activeIndex}
          style={{ marginTop: 'var(--space-5)' }}
        >
          {panels[i]}
        </div>
      ))}
    </div>
  )
}

export default function CompanyLoading() {
  return (
    <div
      style={{
        maxWidth: 'var(--max-width)',
        margin: '0 auto',
        padding: 'var(--space-6) var(--space-4)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'var(--sidebar-width) 1fr',
          gap: 'var(--space-8)',
        }}
      >
        {/* Sidebar skeleton */}
        <div>
          <div
            style={{
              width: '140px',
              height: '140px',
              borderRadius: '50%',
              backgroundColor: 'var(--bg-elevated)',
              margin: '0 auto var(--space-4)',
            }}
          />
          <div
            style={{
              height: '32px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: '6px',
              marginBottom: 'var(--space-3)',
            }}
          />
          <div
            style={{
              height: '28px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: '6px',
            }}
          />
        </div>

        {/* Main skeleton */}
        <div>
          <div
            style={{
              height: '16px',
              width: '120px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: '4px',
              marginBottom: 'var(--space-3)',
            }}
          />
          <div
            style={{
              height: '40px',
              width: '60%',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: '4px',
              marginBottom: 'var(--space-3)',
            }}
          />
          <div
            style={{
              height: '20px',
              width: '200px',
              backgroundColor: 'var(--bg-elevated)',
              borderRadius: '4px',
              marginBottom: 'var(--space-8)',
            }}
          />
          <div
            style={{
              height: '200px',
              backgroundColor: 'var(--bg-surface)',
              borderRadius: '8px',
            }}
          />
        </div>
      </div>
    </div>
  )
}


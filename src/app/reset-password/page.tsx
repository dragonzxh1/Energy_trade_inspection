import { Suspense } from 'react'
import ResetPasswordForm from './ResetPasswordForm'
import Link from 'next/link'

export default function ResetPasswordPage() {
  return (
    <div
      style={{
        minHeight:       '100vh',
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        backgroundColor: 'var(--bg-primary)',
        padding:         'var(--space-4)',
      }}
    >
      <div style={{ width: '100%', maxWidth: '380px' }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <Link
            href="/"
            style={{
              color:          'var(--text-primary)',
              textDecoration: 'none',
              fontSize:       '20px',
              fontWeight:     700,
              letterSpacing:  '-0.02em',
            }}
          >
            ETI
          </Link>
        </div>
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border:          '1px solid var(--border-subtle)',
            borderRadius:    '12px',
            padding:         'var(--space-8)',
          }}
        >
          <Suspense fallback={<p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '14px' }}>加载中...</p>}>
            <ResetPasswordForm />
          </Suspense>
        </div>
        <p style={{ textAlign: 'center', marginTop: 'var(--space-4)', color: 'var(--text-muted)', fontSize: '12px' }}>
          <Link href="/sign-in" style={{ color: 'var(--accent-primary)' }}>← 返回登录</Link>
        </p>
      </div>
    </div>
  )
}

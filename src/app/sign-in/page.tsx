import type { Metadata } from 'next'
import { signIn } from '@/auth'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'Sign In — Energy Trade Inspection',
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-primary)',
        padding: 'var(--space-4)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <Link
            href="/"
            style={{
              color: 'var(--text-primary)',
              textDecoration: 'none',
              fontSize: '20px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
            }}
          >
            ETI
          </Link>
          <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginTop: 'var(--space-2)' }}>
            Energy Trade Inspection
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: 'var(--space-8)',
          }}
        >
          <h1
            style={{
              fontSize: '20px',
              lineHeight: '28px',
              fontWeight: 600,
              marginBottom: 'var(--space-2)',
              textAlign: 'center',
            }}
          >
            Sign in
          </h1>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '13px',
              textAlign: 'center',
              marginBottom: 'var(--space-6)',
              lineHeight: '20px',
            }}
          >
            Access sanction screening, authenticity scores, and risk intelligence.
          </p>

          {/* Google sign-in form */}
          <form
            action={async () => {
              'use server'
              await signIn('google')
            }}
          >
            <button
              type="submit"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-3) var(--space-4)',
                backgroundColor: '#fff',
                color: '#1f2937',
                border: 'none',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
              }}
            >
              {/* Google G icon */}
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                />
                <path
                  fill="#34A853"
                  d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"
                />
                <path
                  fill="#FBBC05"
                  d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                />
                <path
                  fill="#EA4335"
                  d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                />
              </svg>
              Continue with Google
            </button>
          </form>

          <p
            style={{
              marginTop: 'var(--space-5)',
              color: 'var(--text-muted)',
              fontSize: '11px',
              textAlign: 'center',
              lineHeight: '17px',
            }}
          >
            By signing in, you agree to our Terms of Service and Privacy Policy.
            Free plan: 5 queries/month.
          </p>
        </div>

        <p style={{ textAlign: 'center', marginTop: 'var(--space-5)', color: 'var(--text-muted)', fontSize: '12px' }}>
        <Link href="/" style={{ color: 'var(--accent-primary)' }}>← Back to search</Link>
        </p>
      </div>
    </div>
  )
}


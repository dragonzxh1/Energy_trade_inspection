import Link from 'next/link'
import UserAvatar from './UserAvatar'

interface HeaderNavProps {
  user?: { name?: string | null; image?: string | null; plan?: string } | null
  plan: string
}

export default function HeaderNav({ user, plan }: HeaderNavProps) {
  const planLabel = plan === 'starter' ? 'Starter' : plan === 'professional' ? 'Pro' : plan === 'enterprise' ? 'Enterprise' : null

  const links: { href: string; label: string }[] = [
    { href: '/search', label: 'Database' },
    { href: '/pricing', label: 'Pricing' },
    ...(plan !== 'free' ? [{ href: '/screen', label: 'Screen' }] : []),
    ...(plan !== 'free' ? [{ href: '/trade', label: 'Trade' }] : []),
    ...((plan === 'professional' || plan === 'enterprise') ? [{ href: '/watchlist', label: 'Watchlist' }] : []),
  ]

  return (
    <nav aria-label="Site navigation" style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexShrink: 1, minWidth: 0 }}>
      {/* Desktop nav */}
      <div className="hidden-mobile-nav" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', flexShrink: 1 }}>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="nav-text-link hover-text-brand" style={{ color: 'var(--text-muted)', fontSize: '13px', textDecoration: 'none' }}>
            {l.label}
          </Link>
        ))}
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {planLabel && <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--brand-400)', border: '1px solid var(--brand-400)', borderRadius: '4px', padding: '2px 6px' }}>{planLabel}</span>}
            <Link href="/account" style={{ textDecoration: 'none', flexShrink: 0, lineHeight: 0 }}><UserAvatar src={user?.image ?? undefined} name={user?.name ?? undefined} /></Link>
            <form action={async () => { 'use server'; const { signOut } = await import('@/auth'); await signOut({ redirectTo: '/' }) }}>
              <button type="submit" style={{ background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '12px', fontFamily: 'inherit', padding: '4px 10px' }} className="hover-border-brand">Sign out</button>
            </form>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Link href="/sign-up" style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: 500, textDecoration: 'none', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-subtle)' }} className="hover-border-brand">Sign up</Link>
            <Link href="/sign-in" className="btn-primary" style={{ fontSize: '13px', fontWeight: 600, textDecoration: 'none', padding: '6px 16px', borderRadius: '8px', display: 'inline-block' }}>Console Login</Link>
          </div>
        )}
      </div>
      {/* Mobile hamburger using details/summary (no JS needed) */}
      <details className="mobile-nav-trigger" style={{ display: 'none', position: 'relative' }}>
        <summary style={{ listStyle: 'none', cursor: 'pointer', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: '6px', color: 'var(--text-primary)', padding: '6px 8px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h18M3 6h18M3 18h18" /></svg>
        </summary>
        <div className="mobile-nav-dropdown" style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, minWidth: '200px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: '2px', zIndex: 45, boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
          {links.map((l) => <Link key={l.href} href={l.href} style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: 500, textDecoration: 'none', padding: '10px 14px', borderRadius: '8px' }} className="hover-border-brand">{l.label}</Link>)}
          {links.length > 0 && <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '4px 0' }} />}
          {user ? <>
            {planLabel && <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--brand-400)', border: '1px solid var(--brand-400)', borderRadius: '4px', padding: '2px 6px', alignSelf: 'flex-start', margin: '4px 14px' }}>{planLabel}</span>}
            <Link href="/account" style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: 500, textDecoration: 'none', padding: '10px 14px', borderRadius: '8px' }} className="hover-border-brand">Account</Link>
            <form action={async () => { 'use server'; const { signOut } = await import('@/auth'); await signOut({ redirectTo: '/' }) }}>
              <button type="submit" style={{ background: 'none', border: 'none', color: 'var(--risk-critical)', cursor: 'pointer', fontSize: '14px', fontFamily: 'inherit', fontWeight: 500, padding: '10px 14px', borderRadius: '8px', width: '100%', textAlign: 'left' }}>Sign out</button>
            </form>
          </> : <>
            <Link href="/sign-up" style={{ color: 'var(--text-secondary)', fontSize: '14px', fontWeight: 500, textDecoration: 'none', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-subtle)', textAlign: 'center' }} className="hover-border-brand">Sign up</Link>
            <Link href="/sign-in" className="btn-primary" style={{ fontSize: '14px', fontWeight: 600, textDecoration: 'none', padding: '10px 14px', borderRadius: '8px', textAlign: 'center', display: 'block' }}>Console Login</Link>
          </>}
        </div>
      </details>
    </nav>
  )
}

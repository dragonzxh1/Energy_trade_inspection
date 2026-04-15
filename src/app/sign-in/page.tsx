import type { Metadata } from 'next'
import SignInClient from './SignInClient'

export const metadata: Metadata = {
  title: 'Sign In — Energy Trade Inspection',
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; verified?: string }>
}) {
  const { callbackUrl, error, verified } = await searchParams
  // Only allow same-origin relative URLs to prevent open-redirect attacks
  const redirectTo = callbackUrl?.startsWith('/') ? callbackUrl : '/'

  return (
    <SignInClient
      callbackUrl={redirectTo}
      verified={verified === '1'}
      errorCode={error ?? null}
    />
  )
}

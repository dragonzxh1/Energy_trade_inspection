import Header from '@/components/layout/Header'
import PricingClient from './PricingClient'

export const metadata = {
  title: 'Energy Pricing | ETI',
  description: 'Daily energy commodity pricing dashboard',
}

export default function PricingPage() {
  return (
    <>
      <Header />
      <PricingClient />
    </>
  )
}
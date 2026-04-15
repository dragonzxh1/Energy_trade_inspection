import type { Metadata } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: {
      default: 'Energy Trade Inspection — Counterparty Verification',
    template: '%s | Energy Trade Inspection',
  },
  description:
    'Verify energy trading counterparties. Check sanction status, authenticity scores, and risk flags for companies and vessels in real time.',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    siteName: 'Energy Trade Inspection',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className=""
    >
      <body>{children}</body>
    </html>
  )
}


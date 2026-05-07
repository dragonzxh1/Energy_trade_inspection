import type { Metadata } from 'next'
import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import '@/styles/globals.css'
import PageViewTracker from '@/components/analytics/PageViewTracker'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  weight: ['500', '600', '700'],
  variable: '--font-display',
})

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
})

export const metadata: Metadata = {
  title: {
      default: 'ETI Verify — Energy Trade Intelligence & Screening',
    template: '%s | ETI Verify',
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
    siteName: 'ETI Verify',
  },
  icons: {
    icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22%3E%3Crect fill=%22%230ea5e9%22 width=%22100%22 height=%22100%22 rx=%2216%22/%3E%3C/svg%3E',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="grid-bg">{children}<PageViewTracker /></body>
    </html>
  )
}

import type { NextConfig } from 'next'

// Content Security Policy
// - script-src needs 'unsafe-inline' + 'unsafe-eval' for Next.js hydration/webpack
// - style-src needs 'unsafe-inline' for Next.js injected styles
// - Stripe and Google OAuth require their CDN domains
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://accounts.google.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.stripe.com https://accounts.google.com",
  "frame-src https://js.stripe.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join('; ')

const securityHeaders = [
  // Prevent MIME type sniffing
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Prevent clickjacking
  { key: 'X-Frame-Options', value: 'DENY' },
  // Legacy XSS filter (still respected by some browsers)
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // Force HTTPS for 2 years (only effective once the site is on HTTPS)
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Don't leak full URL in Referer header to third parties
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Disable access to camera, mic, geolocation
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  // Content Security Policy
  { key: 'Content-Security-Policy', value: CSP },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'pdf-parse', 'mammoth', 'exceljs', 'unzipper'],
  // Allow local dev tools (browse daemon, DevTools) to access /_next/* resources
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async headers() {
    return [
      // Security headers on all routes
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // Allow AI crawlers to index entity pages for GEO
      {
        source: '/company/:slug',
        headers: [{ key: 'X-Robots-Tag', value: 'index, follow' }],
      },
      {
        source: '/vessel/:imo',
        headers: [{ key: 'X-Robots-Tag', value: 'index, follow' }],
      },
    ]
  },
}

export default nextConfig

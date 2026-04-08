import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer', 'pdf-parse', 'mammoth', 'xlsx'],
  // Allow local dev tools (browse daemon, DevTools) to access /_next/* resources
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Allow AI crawlers to index entity pages for GEO
  async headers() {
    return [
      {
        source: '/company/:slug',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'index, follow',
          },
        ],
      },
      {
        source: '/vessel/:imo',
        headers: [
          {
            key: 'X-Robots-Tag',
            value: 'index, follow',
          },
        ],
      },
    ]
  },
}

export default nextConfig

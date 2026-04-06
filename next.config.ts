import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
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

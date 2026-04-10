import type { MetadataRoute } from 'next'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://energytradeinspection.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/account',
          '/watchlist',
          '/sign-in',
          '/upgrade',
        ],
      },
    ],
    sitemap: `${APP_URL}/sitemap.xml`,
  }
}


import type { MetadataRoute } from 'next'
import { db } from '@/lib/server/db'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://energytradeinspection.com'

interface EntityRow {
  entity_type: 'company' | 'vessel'
  slug: string | null
  imo: string | null
  updated_at: string
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: APP_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${APP_URL}/pricing`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: `${APP_URL}/search`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.7,
    },
  ]

  // Dynamic entity pages from DB
  let entityPages: MetadataRoute.Sitemap = []
  try {
    const { rows } = await db.query<EntityRow>(`
      SELECT entity_type, slug, imo, updated_at
      FROM entities
      WHERE (entity_type = 'company' AND slug IS NOT NULL)
         OR (entity_type = 'vessel' AND imo IS NOT NULL)
      ORDER BY updated_at DESC
      LIMIT 5000
    `)

    entityPages = rows.map((row) => {
      const path =
        row.entity_type === 'vessel'
          ? `/vessel/${row.imo}`
          : `/company/${row.slug}`
      return {
        url: `${APP_URL}${path}`,
        lastModified: new Date(row.updated_at),
        changeFrequency: 'weekly' as const,
        priority: 0.6,
      }
    })
  } catch {
    // If the database is unavailable at build time, return static entries only.
  }

  return [...staticPages, ...entityPages]
}



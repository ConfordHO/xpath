import type { MetadataRoute } from 'next'

const siteUrl = 'https://olyvia.xpath-labs.com'
const now = new Date()

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: siteUrl,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1,
    },
    {
      url: `${siteUrl}/order-online`,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 0.82,
    },
    {
      url: `${siteUrl}/patient-portal`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.65,
    },
    {
      url: `${siteUrl}/doctor-portal`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.62,
    },
  ]
}

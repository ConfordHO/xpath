import type { MetadataRoute } from 'next'

const siteUrl = 'https://olyvia.xpath-labs.com'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/dashboard', '/admin', '/orders', '/reports', '/workflows'],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  }
}

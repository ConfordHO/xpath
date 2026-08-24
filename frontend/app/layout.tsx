import type { Metadata } from 'next'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'

import { localeFromHeaders } from '../src/i18nGeo'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/700.css'
import '../src/index.css'

export const metadata: Metadata = {
  metadataBase: new URL('https://olyvia.xpath-labs.com'),
  applicationName: 'OLYVIA LIMS',
  title: {
    default: 'OLYVIA LIMS | Africa-Built Laboratory Information Management System',
    template: '%s | OLYVIA LIMS',
  },
  description:
    'OLYVIA is an Africa-built Laboratory Information Management System by X.PATH Labs and Buntu Labs Technologies for pathology, genomics, histology, cytology, molecular diagnostics, reporting, quality control, and multi-site laboratory operations worldwide.',
  keywords: [
    'OLYVIA LIMS',
    'African LIMS',
    'LIMS Africa',
    'laboratory information management system Africa',
    'pathology LIMS',
    'molecular pathology LIMS',
    'genomics LIMS',
    'histology workflow software',
    'cytology reporting software',
    'laboratory reporting system',
    'medical laboratory software Cameroon',
    'healthcare software Kenya',
    'global LIMS platform',
    'X.PATH Labs',
    'Buntu Labs Technologies',
  ],
  authors: [{ name: 'X.PATH Labs' }, { name: 'Buntu Labs Technologies', url: 'https://www.buntulabs.com' }],
  creator: 'X.PATH Labs and Buntu Labs Technologies',
  publisher: 'X.PATH Labs',
  category: 'Healthcare technology',
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png', sizes: '256x256' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/olyvia-logo.png', type: 'image/png', sizes: '640x349' },
    ],
    shortcut: ['/favicon.png'],
    apple: [{ url: '/favicon.png', type: 'image/png', sizes: '256x256' }],
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    alternateLocale: ['fr_CM', 'fr_FR'],
    url: '/',
    siteName: 'OLYVIA LIMS',
    title: 'OLYVIA LIMS | Africa-Built Laboratory Information Management System',
    description:
      'Africa-built LIMS for pathology, genomics, histology, cytology, molecular diagnostics, quality-controlled reporting, and laboratory operations that can work worldwide.',
    images: [
      {
        url: '/olyvia-logo.jpg',
        width: 1407,
        height: 768,
        alt: 'OLYVIA by X.PATH Labs logo',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'OLYVIA LIMS | Africa-Built Laboratory Information Management System',
    description:
      'A Laboratory Information Management System developed in Africa for pathology, genomics, reporting, QC, and global laboratory operations.',
    images: ['/olyvia-logo.jpg'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  other: {
    'application-name': 'OLYVIA LIMS',
    classification: 'Laboratory Information Management System, Healthcare Software, Pathology LIMS',
    'geo.region': 'CM-CE',
    'geo.placename': 'Yaounde, Cameroon',
    'product:built_for': 'African laboratories and worldwide laboratory networks',
  },
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const requestHeaders = await headers()
  const defaultLocale = localeFromHeaders(requestHeaders)

  return (
    <html lang={defaultLocale}>
      <body>{children}</body>
    </html>
  )
}

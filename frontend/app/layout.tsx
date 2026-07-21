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
  title: 'OLYVIA',
  description: 'OLYVIA LIMS developed by X.PATH Labs',
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

import { headers } from 'next/headers'

import { NextClientApp } from '../../src/NextClientApp'
import { localeFromHeaders } from '../../src/i18nGeo'

export const dynamic = 'force-dynamic'

export default async function AppPage() {
  const requestHeaders = await headers()
  const defaultLocale = localeFromHeaders(requestHeaders)
  return <NextClientApp defaultLocale={defaultLocale} />
}

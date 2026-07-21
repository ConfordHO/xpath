import { headers } from 'next/headers'

import { NextClientApp } from '../../src/NextClientApp'
import { localeFromHeaders } from '../../src/i18nGeo'

export const dynamic = 'force-dynamic'

interface AppPageProps {
  params: Promise<{ path?: string[] }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function buildInitialPath(pathSegments: string[] = [], searchParams: Record<string, string | string[] | undefined> = {}) {
  const pathname = `/${pathSegments.map((segment) => encodeURIComponent(segment)).join('/')}`.replace(/\/$/, '') || '/'
  const params = new URLSearchParams()

  Object.entries(searchParams).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => params.append(key, entry))
      return
    }
    if (value !== undefined) {
      params.set(key, value)
    }
  })

  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export default async function AppPage({ params, searchParams }: AppPageProps) {
  const requestHeaders = await headers()
  const routeParams = await params
  const routeSearchParams = searchParams ? await searchParams : {}
  const defaultLocale = localeFromHeaders(requestHeaders)
  const initialPath = buildInitialPath(routeParams.path, routeSearchParams)
  return <NextClientApp defaultLocale={defaultLocale} initialPath={initialPath} />
}

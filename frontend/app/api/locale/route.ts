import { NextResponse } from 'next/server'

import { countryCodeFromHeaders, localeFromCountryCode, normalizeCountryCode } from '../../../src/i18nGeo'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function firstForwardedIp(headers: Headers) {
  const forwardedFor = headers.get('x-forwarded-for')
  const candidate =
    forwardedFor?.split(',')[0]?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('true-client-ip')?.trim() ||
    headers.get('cf-connecting-ip')?.trim() ||
    ''
  return candidate.replace(/^::ffff:/, '')
}

function isPrivateIp(ipAddress: string) {
  if (!ipAddress) {
    return true
  }
  if (
    ipAddress === '127.0.0.1' ||
    ipAddress === '::1' ||
    ipAddress.startsWith('10.') ||
    ipAddress.startsWith('192.168.') ||
    ipAddress.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ipAddress) ||
    /^f[cd][0-9a-f]{2}:/i.test(ipAddress) ||
    /^fe80:/i.test(ipAddress)
  ) {
    return true
  }
  return false
}

async function lookupCountryByIp(ipAddress: string) {
  if (isPrivateIp(ipAddress)) {
    return null
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 1500)

  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(ipAddress)}/country/`, {
      cache: 'no-store',
      headers: { accept: 'text/plain' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return null
    }
    return normalizeCountryCode(await response.text())
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function GET(request: Request) {
  const headerCountry = countryCodeFromHeaders(request.headers)
  const ipAddress = firstForwardedIp(request.headers)
  const lookupCountry =
    headerCountry || process.env.IP_LOCALE_LOOKUP_ENABLED === 'false'
      ? null
      : await lookupCountryByIp(ipAddress)
  const country = headerCountry ?? lookupCountry
  const locale = localeFromCountryCode(country)

  return NextResponse.json({
    locale,
    country,
    source: headerCountry ? 'request-header' : lookupCountry ? 'ip-lookup' : 'fallback',
  })
}

export type AppLocale = 'en' | 'fr'

const countryHeaderNames = [
  'x-vercel-ip-country',
  'x-country-code',
  'x-geo-country',
  'x-appengine-country',
  'cf-ipcountry',
  'fastly-client-country',
  'cloudfront-viewer-country',
]

const frenchOfficialCountries = new Set([
  'BE',
  'BF',
  'BI',
  'BJ',
  'BL',
  'CA',
  'CD',
  'CF',
  'CG',
  'CH',
  'CI',
  'CM',
  'DJ',
  'FR',
  'GA',
  'GF',
  'GN',
  'GP',
  'GQ',
  'HT',
  'KM',
  'LU',
  'MC',
  'MF',
  'MG',
  'ML',
  'MQ',
  'MU',
  'NC',
  'NE',
  'PF',
  'PM',
  'RE',
  'RW',
  'SC',
  'SN',
  'TD',
  'TG',
  'VU',
  'WF',
  'YT',
])

const englishPreferredBilingualCountries = new Set(['CA'])
const frenchPreferredBilingualCountries = new Set(['CM'])

export function normalizeCountryCode(value?: string | null) {
  const countryCode = String(value ?? '')
    .trim()
    .slice(0, 2)
    .toUpperCase()
  return /^[A-Z]{2}$/.test(countryCode) ? countryCode : null
}

export function localeFromCountryCode(countryCode?: string | null): AppLocale {
  const normalizedCountry = normalizeCountryCode(countryCode)
  if (!normalizedCountry) {
    return 'en'
  }
  if (frenchPreferredBilingualCountries.has(normalizedCountry)) {
    return 'fr'
  }
  if (englishPreferredBilingualCountries.has(normalizedCountry)) {
    return 'en'
  }
  return frenchOfficialCountries.has(normalizedCountry) ? 'fr' : 'en'
}

export function countryCodeFromHeaders(headers: Pick<Headers, 'get'>) {
  for (const headerName of countryHeaderNames) {
    const countryCode = normalizeCountryCode(headers.get(headerName))
    if (countryCode && countryCode !== 'XX') {
      return countryCode
    }
  }
  return null
}

export function localeFromHeaders(headers: Pick<Headers, 'get'>): AppLocale {
  return localeFromCountryCode(countryCodeFromHeaders(headers))
}

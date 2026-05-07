import axios from 'axios'

function resolveApiBaseUrl() {
  const configured =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_API_BASE_URL
  if (!configured) {
    return 'http://localhost:4000/api'
  }

  const normalized = configured
    .replace(/^https:\/\/localhost(?=[:/]|$)/i, 'http://localhost')
    .replace(/\/+$/, '')

  return normalized.endsWith('/api') ? normalized : `${normalized}/api`
}

export const apiBaseUrl = resolveApiBaseUrl()

export const storageKeys = {
  token: 'lims_token',
  locale: 'lims_locale',
  user: 'lims_user',
} as const

function envFlagEnabled(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback
  }
  return !['0', 'false', 'no', 'off'].includes(value.trim().toLowerCase())
}

export const testAccess = {
  enabled: envFlagEnabled(process.env.NEXT_PUBLIC_TEST_ACCESS, false),
  email: process.env.NEXT_PUBLIC_TEST_ACCESS_EMAIL?.trim() || 'admin@xpath.lims',
  password: process.env.NEXT_PUBLIC_TEST_ACCESS_PASSWORD?.trim() || 'admin123',
} as const

export const api = axios.create({
  baseURL: apiBaseUrl,
})

api.interceptors.request.use((config) => {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem(storageKeys.token) : null
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (typeof window !== 'undefined' && error.response?.status === 401) {
      window.localStorage.removeItem(storageKeys.token)
      window.localStorage.removeItem(storageKeys.user)
    }
    return Promise.reject(error)
  },
)

export function getStoredToken() {
  if (typeof window === 'undefined') {
    return null
  }
  return window.localStorage.getItem(storageKeys.token)
}

export function setStoredToken(token: string | null) {
  if (typeof window === 'undefined') {
    return
  }
  if (!token) {
    window.localStorage.removeItem(storageKeys.token)
    return
  }
  window.localStorage.setItem(storageKeys.token, token)
}

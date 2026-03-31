import axios from 'axios'

function resolveApiBaseUrl() {
  const configured = import.meta.env.VITE_API_URL ?? import.meta.env.VITE_API_BASE_URL
  if (!configured) {
    return 'http://localhost:4000/api'
  }

  return configured.replace(/^https:\/\/localhost(?=[:/]|$)/i, 'http://localhost')
}

export const storageKeys = {
  token: 'lims_token',
  locale: 'lims_locale',
  user: 'lims_user',
} as const

export const api = axios.create({
  baseURL: resolveApiBaseUrl(),
})

api.interceptors.request.use((config) => {
  const token = window.localStorage.getItem(storageKeys.token)
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.localStorage.removeItem(storageKeys.token)
      window.localStorage.removeItem(storageKeys.user)
    }
    return Promise.reject(error)
  },
)

export function getStoredToken() {
  return window.localStorage.getItem(storageKeys.token)
}

export function setStoredToken(token: string | null) {
  if (!token) {
    window.localStorage.removeItem(storageKeys.token)
    return
  }
  window.localStorage.setItem(storageKeys.token, token)
}

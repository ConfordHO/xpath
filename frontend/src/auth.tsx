import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import { api, getStoredToken, setStoredToken, storageKeys, testAccess } from './api'
import type { SafeUser } from './types'

interface AuthContextValue {
  user: SafeUser | null
  token: string | null
  organizationId: string | null
  loading: boolean
  signIn: (email: string, password: string, organizationSlug?: string) => Promise<void>
  signOut: () => void
  refreshUser: () => Promise<void>
  setUser: (user: SafeUser | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

function readLocaleFallback(): 'en' | 'fr' {
  if (typeof window === 'undefined') {
    return 'en'
  }
  const stored = window.localStorage.getItem(storageKeys.locale)
  if (stored === 'en' || stored === 'fr') {
    return stored
  }
  return document.documentElement.lang === 'fr' ? 'fr' : 'en'
}

function normalizeSafeUser(value: Partial<SafeUser> & { id?: string } | null | undefined) {
  if (!value) {
    return null
  }
  const id = value._id ?? value.id
  if (!id || !value.email || !value.name || !value.role) {
    return null
  }
  const preferredLocale = value.preferredLocale ?? readLocaleFallback()
  return {
    ...value,
    _id: id,
    preferredLanguage: value.preferredLanguage ?? (preferredLocale === 'fr' ? 'french' : 'english'),
    preferredLocale,
    active: value.active ?? true,
    createdAt: value.createdAt ?? '',
    updatedAt: value.updatedAt ?? '',
  } as SafeUser
}

function readStoredUser() {
  if (typeof window === 'undefined') {
    return null
  }
  const raw = window.localStorage.getItem(storageKeys.user)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SafeUser>
    return normalizeSafeUser(parsed)
  } catch {
    return null
  }
}

function readStoredOrgId() {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(storageKeys.token + '_org') ?? null
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => getStoredToken())
  const [user, setUserState] = useState<SafeUser | null>(() => readStoredUser())
  const [organizationId, setOrganizationId] = useState<string | null>(() => readStoredOrgId())
  const [loading, setLoading] = useState<boolean>(!!getStoredToken() || testAccess.enabled)
  const [testAccessAttempted, setTestAccessAttempted] = useState(false)

  const setUser = (nextUser: SafeUser | null) => {
    const normalizedUser = normalizeSafeUser(nextUser)
    setUserState(normalizedUser)
    if (typeof window === 'undefined') {
      return
    }
    if (!normalizedUser) {
      window.localStorage.removeItem(storageKeys.user)
      return
    }
    window.localStorage.setItem(storageKeys.user, JSON.stringify(normalizedUser))
  }

  const refreshUser = async () => {
    if (!token) {
      if (!testAccess.enabled || testAccessAttempted) {
        setLoading(false)
      }
      return
    }
    try {
      const response = await api.get<SafeUser>('/users/me')
      const normalizedUser = normalizeSafeUser(response.data)
      if (!normalizedUser) {
        throw new Error('The server returned an invalid user session')
      }
      setUser(normalizedUser)
    } catch {
      setStoredToken(null)
      setToken(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshUser()
  }, [token])

  useEffect(() => {
    if (token || !testAccess.enabled || testAccessAttempted) {
      return
    }
    let cancelled = false
    setTestAccessAttempted(true)
    setLoading(true)
    api
      .post<{ token: string; user: SafeUser }>('/auth/login', {
        email: testAccess.email,
        password: testAccess.password,
      })
      .then((response) => {
        if (cancelled) {
          return
        }
        const normalizedUser = normalizeSafeUser(response.data.user)
        if (!normalizedUser) {
          throw new Error('The server returned an invalid testing user')
        }
        setStoredToken(response.data.token)
        setToken(response.data.token)
        setUser(normalizedUser)
      })
      .catch(() => {
        if (!cancelled) {
          setStoredToken(null)
          setToken(null)
          setUser(null)
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [testAccessAttempted, token])

  const signIn = async (email: string, password: string, organizationSlug?: string) => {
    const response = await api.post<{ token: string; user: SafeUser; organizationId?: string }>('/auth/login', {
      email,
      password,
      ...(organizationSlug ? { organizationSlug } : {}),
    })
    const normalizedUser = normalizeSafeUser(response.data.user)
    if (!normalizedUser) {
      throw new Error('The server returned an invalid user session')
    }
    const orgId = response.data.organizationId ?? normalizedUser.organizationId ?? null
    setStoredToken(response.data.token)
    setToken(response.data.token)
    setUser(normalizedUser)
    setOrganizationId(orgId)
    if (typeof window !== 'undefined') {
      if (orgId) window.localStorage.setItem(storageKeys.token + '_org', orgId)
      else window.localStorage.removeItem(storageKeys.token + '_org')
    }
    setLoading(false)
  }

  const signOut = () => {
    void api.post('/auth/logout').catch(() => undefined)
    setStoredToken(null)
    setToken(null)
    setUser(null)
    setOrganizationId(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKeys.token + '_org')
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      organizationId,
      loading,
      signIn,
      signOut,
      refreshUser,
      setUser,
    }),
    [loading, token, user, organizationId],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

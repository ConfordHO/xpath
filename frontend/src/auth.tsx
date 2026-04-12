import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react'

import { api, getStoredToken, setStoredToken, storageKeys } from './api'
import type { SafeUser } from './types'

interface AuthContextValue {
  user: SafeUser | null
  token: string | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  refreshUser: () => Promise<void>
  setUser: (user: SafeUser | null) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

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
    if (!parsed || !parsed._id || !parsed.email || !parsed.name || !parsed.role) {
      return null
    }
    return {
      ...parsed,
      preferredLanguage: parsed.preferredLanguage ?? 'french',
      preferredLocale: parsed.preferredLocale ?? 'fr',
      active: parsed.active ?? true,
      createdAt: parsed.createdAt ?? '',
      updatedAt: parsed.updatedAt ?? '',
    } as SafeUser
  } catch {
    return null
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [token, setToken] = useState<string | null>(() => getStoredToken())
  const [user, setUserState] = useState<SafeUser | null>(() => readStoredUser())
  const [loading, setLoading] = useState<boolean>(!!getStoredToken())

  const setUser = (nextUser: SafeUser | null) => {
    setUserState(nextUser)
    if (typeof window === 'undefined') {
      return
    }
    if (!nextUser) {
      window.localStorage.removeItem(storageKeys.user)
      return
    }
    window.localStorage.setItem(storageKeys.user, JSON.stringify(nextUser))
  }

  const refreshUser = async () => {
    if (!token) {
      setLoading(false)
      return
    }
    try {
      const response = await api.get<SafeUser>('/users/me')
      setUser(response.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshUser()
  }, [token])

  const signIn = async (email: string, password: string) => {
    const response = await api.post<{ token: string; user: SafeUser }>('/auth/login', {
      email,
      password,
    })
    setStoredToken(response.data.token)
    setToken(response.data.token)
    setUser(response.data.user)
    setLoading(false)
  }

  const signOut = () => {
    void api.post('/auth/logout').catch(() => undefined)
    setStoredToken(null)
    setToken(null)
    setUser(null)
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      loading,
      signIn,
      signOut,
      refreshUser,
      setUser,
    }),
    [loading, token, user],
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

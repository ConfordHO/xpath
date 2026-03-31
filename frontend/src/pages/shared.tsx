import { Alert, LinearProgress } from '@mui/material'
import axios from 'axios'
import { useEffect, useEffectEvent, useRef, useState, type DependencyList } from 'react'

import { api, getStoredToken } from '../api'

export function errorMessage(error: unknown) {
  if (axios.isAxiosError(error)) {
    return String(error.response?.data?.message ?? error.message)
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'Something went wrong'
}

export function useLoadable<T>(initial: T, dependencies: DependencyList, loader: () => Promise<T>) {
  const [data, setData] = useState<T>(initial)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const onLoad = useEffectEvent(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await loader())
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  })

  useEffect(() => {
    void onLoad()
  }, [...dependencies, tick])

  return {
    data,
    setData,
    loading,
    error,
    refresh: () => setTick((value) => value + 1),
  }
}

export function PageError({ message }: { message: string }) {
  return <Alert severity="error">{message}</Alert>
}

export function TablePlaceholder({ loading }: { loading: boolean }) {
  return loading ? <LinearProgress sx={{ mb: 2 }} /> : null
}

export const chartColors = ['#1565c0', '#2e7d32', '#ed6c02', '#8b5e34']

export type AnalyticsRange = 'daily' | 'weekly' | 'monthly' | 'custom'

export function useRealtimeStream(
  path: string,
  onEvent: (eventName: string, payload: unknown) => void,
  enabled = true,
) {
  const [connected, setConnected] = useState(false)
  const handleEvent = useEffectEvent(onEvent)
  const hasConnectedRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setConnected(false)
      hasConnectedRef.current = false
      return
    }

    const token = getStoredToken()
    const baseUrl = String(api.defaults.baseURL ?? '')
    if (!token || !baseUrl) {
      setConnected(false)
      hasConnectedRef.current = false
      return
    }

    const normalizedBaseUrl = baseUrl.startsWith('http')
      ? baseUrl
      : `${window.location.origin}${baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`}`

    const url = new URL(
      `${normalizedBaseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`,
    )
    url.searchParams.set('token', token)
    const source = new EventSource(url.toString())

    source.onopen = () => {
      hasConnectedRef.current = true
      setConnected(true)
    }
    source.addEventListener('connected', () => setConnected(true))
    source.addEventListener('heartbeat', () => setConnected(true))
    source.addEventListener('internal-message', (event) => {
      setConnected(true)
      handleEvent('internal-message', JSON.parse((event as MessageEvent<string>).data))
    })
    source.addEventListener('message-read', (event) => {
      setConnected(true)
      handleEvent('message-read', JSON.parse((event as MessageEvent<string>).data))
    })
    source.onerror = () => {
      if (!hasConnectedRef.current || source.readyState === EventSource.CLOSED) {
        setConnected(false)
      }
    }

    return () => {
      source.close()
      setConnected(false)
      hasConnectedRef.current = false
    }
  }, [enabled, handleEvent, path])

  return connected
}

export function useActionLock() {
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({})
  const pendingRef = useRef<Record<string, boolean>>({})

  const setPending = (key: string, value: boolean) => {
    setPendingMap((current) => {
      const next = { ...current }
      if (value) {
        next[key] = true
      } else {
        delete next[key]
      }
      pendingRef.current = next
      return next
    })
  }

  const runLocked = useEffectEvent(async (key: string, action: () => Promise<unknown>) => {
    if (pendingRef.current[key]) {
      return null
    }

    setPending(key, true)
    try {
      return await action()
    } finally {
      setPending(key, false)
    }
  })

  return {
    isPending: (key: string) => Boolean(pendingMap[key]),
    runLocked,
  }
}

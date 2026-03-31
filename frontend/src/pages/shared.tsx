import { Alert, LinearProgress } from '@mui/material'
import axios from 'axios'
import { useEffect, useEffectEvent, useState, type DependencyList } from 'react'

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

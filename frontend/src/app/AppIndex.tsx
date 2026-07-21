import { Navigate } from 'react-router-dom'

import { useAuth } from '../auth'
import { LoadingPanel } from '../components'
import { LandingPage } from '../views/landing'

export function AppIndex() {
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingPanel label="Loading…" />
  }
  if (user) {
    return <Navigate to="/dashboard" replace />
  }

  return <LandingPage />
}

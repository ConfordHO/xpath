import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../auth'
import { AppShell, LoadingPanel } from '../components'
import { getNavGroups } from './nav'

export function ProtectedLayout() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LoadingPanel label="Restoring session…" />
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  return (
    <AppShell groups={getNavGroups(user)}>
      <Outlet />
    </AppShell>
  )
}

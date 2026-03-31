import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../auth'
import { LoadingPanel } from '../components'
import type { UserRole } from '../types'

export function RoleGuard({ roles }: { roles: UserRole[] }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <LoadingPanel label="Checking access…" />
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

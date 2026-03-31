import type { SafeUser, UserRole } from '../types'

export const roleLabels: Record<UserRole, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  receptionist: 'Receptionist',
  technician: 'Technician',
  pathologist: 'Pathologist',
  doctor: 'Doctor',
  finance: 'Finance',
  courier: 'Courier',
}

export const adminRoles: UserRole[] = ['admin', 'super_admin']
export const operationalRoles: UserRole[] = ['receptionist', 'technician', 'pathologist', 'finance', 'courier']
export const siteRoles: UserRole[] = ['admin', 'receptionist', 'technician', 'pathologist', 'finance', 'courier']

export function hasRole(user: SafeUser | null | undefined, roles: UserRole[]) {
  return Boolean(user && roles.includes(user.role))
}

export function canManageUsers(user: SafeUser | null | undefined) {
  return hasRole(user, adminRoles)
}

export function canDeleteUsers(user: SafeUser | null | undefined) {
  return hasRole(user, adminRoles)
}

export function canManageListedUser(
  actor: SafeUser | null | undefined,
  target: SafeUser,
) {
  if (!actor) {
    return false
  }
  if (actor.role === 'super_admin') {
    return true
  }
  if (actor.role !== 'admin') {
    return actor._id === target._id
  }
  if (target.role === 'super_admin' || target.role === 'admin') {
    return false
  }
  return (actor.siteId ?? 'site-1') === (target.siteId ?? 'site-1')
}

export function canSelectUserSite(user: SafeUser | null | undefined) {
  return user?.role === 'super_admin'
}

export function defaultSiteIdForUser(user: SafeUser | null | undefined) {
  return user?.siteId ?? 'site-1'
}

export function allowedUserRolesForManager(user: SafeUser | null | undefined): UserRole[] {
  if (user?.role === 'super_admin') {
    return ['super_admin', 'admin', 'receptionist', 'technician', 'pathologist', 'doctor', 'finance', 'courier']
  }
  return ['receptionist', 'technician', 'pathologist', 'doctor', 'finance', 'courier']
}

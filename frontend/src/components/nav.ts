import type { ReactNode } from 'react'

export interface NavItem {
  label: string
  to: string
  icon: ReactNode
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

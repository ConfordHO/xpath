import { Chip } from '@mui/material'
import { alpha, useTheme, type Theme } from '@mui/material/styles'

import type { CourierStatus, OrderStatus, Report } from '../types'
import { courierStatusLabel, reportTrafficLightLabel, statusLabel } from '../utils'

function chipSx(theme: Theme, tone: string) {
  switch (tone) {
    case 'success':
      return {
        bgcolor: alpha(theme.palette.success.main, 0.14),
        color: theme.palette.success.dark,
      }
    case 'warning':
      return {
        bgcolor: alpha(theme.palette.warning.main, 0.16),
        color: theme.palette.warning.dark,
      }
    case 'error':
      return {
        bgcolor: alpha(theme.palette.error.main, 0.14),
        color: theme.palette.error.dark,
      }
    case 'info':
      return {
        bgcolor: alpha(theme.palette.info.main, 0.14),
        color: theme.palette.info.dark,
      }
    default:
      return {
        bgcolor: alpha(theme.palette.primary.main, 0.1),
        color: theme.palette.primary.dark,
      }
  }
}

export function StatusChip({ status }: { status: OrderStatus }) {
  const theme = useTheme()
  const tone =
    status === 'completed' || status === 'released'
      ? 'success'
      : status === 'review'
        ? 'warning'
        : status === 'cancelled'
          ? 'error'
          : status === 'received' || status === 'in_progress'
            ? 'info'
            : 'default'
  return <Chip label={statusLabel(status)} size="small" sx={chipSx(theme, tone)} />
}

export function PriorityChip({ priority }: { priority: 'normal' | 'urgent' }) {
  const theme = useTheme()
  return (
    <Chip
      label={priority}
      size="small"
      sx={chipSx(theme, priority === 'urgent' ? 'warning' : 'default')}
    />
  )
}

export function ReportTrafficLightChip({ status }: { status?: Report['trafficLightStatus'] }) {
  const theme = useTheme()
  const tone = status === 'green' ? 'success' : status === 'yellow' ? 'warning' : 'error'
  return <Chip label={reportTrafficLightLabel(status)} size="small" sx={chipSx(theme, tone)} />
}

export function CourierChip({ status }: { status: CourierStatus }) {
  const theme = useTheme()
  const tone = status === 'received_at_lab' ? 'success' : status ? 'info' : 'default'
  return <Chip label={courierStatusLabel(status)} size="small" sx={chipSx(theme, tone)} />
}

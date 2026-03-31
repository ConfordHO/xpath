import {
  Box,
  Button,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useState, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'

import { api } from '../api'
import { useAuth } from '../auth'
import { CourierChip, EChartPanel, LoadingPanel, MetricCard, PageHeader, SectionCard, StatusChip } from '../components'
import { roleLabels } from '../app/access'
import { PageError, chartColors, useLoadable } from './shared'

import type {
  Accession,
  AnalyticsOverview,
  DashboardSummary,
  FinanceMonthlyTrendPoint,
  FinanceSummary,
  HydratedOrder,
  NotificationEntry,
  SafeUser,
  Site,
} from '../types'

import { formatDate, formatMoney, paymentMethodLabel } from '../utils'

type OperationalSummary = {
  totalOrders: number
  validatedOrders: number
  completedReports: number
  openQualityEvents: number
  activeIntegrations: number
  multiSiteTransfers: number
  deidentifiedExports: number
}

type DoctorStats = {
  totalOrders: number
  completedOrders: number
  reviewOrders: number
}

function MetricsGrid({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>{children}</Box>
}

function AnalyticsFilterBar({
  range,
  startDate,
  endDate,
  onRangeChange,
  onStartDateChange,
  onEndDateChange,
}: {
  range: 'daily' | 'weekly' | 'monthly' | 'custom'
  startDate: string
  endDate: string
  onRangeChange: (value: 'daily' | 'weekly' | 'monthly' | 'custom') => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
}) {
  return (
    <SectionCard title="Analytics window" description="Filter tallies by day, week, month, or a custom date range.">
      <Stack direction={{ xs: 'column', lg: 'row' }} spacing={2}>
        <FormControl sx={{ minWidth: 180 }}>
          <InputLabel>Range</InputLabel>
          <Select
            label="Range"
            value={range}
            onChange={(event) => onRangeChange(String(event.target.value) as 'daily' | 'weekly' | 'monthly' | 'custom')}
          >
            <MenuItem value="daily">Daily</MenuItem>
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="custom">Custom</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label="Start date"
          type="date"
          InputLabelProps={{ shrink: true }}
          value={startDate}
          disabled={range !== 'custom'}
          onChange={(event) => onStartDateChange(event.target.value)}
        />
        <TextField
          label="End date"
          type="date"
          InputLabelProps={{ shrink: true }}
          value={endDate}
          disabled={range !== 'custom'}
          onChange={(event) => onEndDateChange(event.target.value)}
        />
      </Stack>
    </SectionCard>
  )
}

function NotificationsPanel({ items }: { items: NotificationEntry[] }) {
  return (
    <SectionCard title="Notifications" scrollable maxBodyHeight={360}>
      <Stack spacing={1.5}>
        {items.length ? (
          items.slice(0, 10).map((item) => (
            <Paper key={item._id} sx={{ p: 2, bgcolor: item.read ? 'white' : 'rgba(21,101,192,0.05)' }}>
              <Typography fontWeight={700}>{item.title}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {item.body}
              </Typography>
            </Paper>
          ))
        ) : (
          <Typography color="text.secondary">No new notifications for this workspace.</Typography>
        )}
      </Stack>
    </SectionCard>
  )
}

function QuickActions({
  title = 'Quick actions',
  actions,
}: {
  title?: string
  actions: Array<{ label: string; description: string; to: string }>
}) {
  return (
    <SectionCard title={title}>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
        {actions.map((action) => (
          <Paper key={action.to} sx={{ p: 2.5, borderRadius: 3 }}>
            <Typography variant="h6">{action.label}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {action.description}
            </Typography>
            <Button component={RouterLink} to={action.to} sx={{ mt: 2 }}>
              {action.label}
            </Button>
          </Paper>
        ))}
      </Box>
    </SectionCard>
  )
}

function OrdersTable({
  orders,
  empty,
  actionLabel = 'View',
  actionTo,
}: {
  orders: HydratedOrder[]
  empty: string
  actionLabel?: string
  actionTo?: (order: HydratedOrder) => string
}) {
  const visibleOrders = orders.slice(0, 10)
  return (
    <SectionCard title="Orders">
      {visibleOrders.length ? (
        <TableContainer sx={{ maxHeight: 440 }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleOrders.map((order) => (
                <TableRow key={order._id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.patient.firstName} {order.patient.lastName}</TableCell>
                  <TableCell><StatusChip status={order.status} /></TableCell>
                  <TableCell>{formatDate(order.createdAt)}</TableCell>
                  <TableCell>
                    <Button component={RouterLink} to={actionTo?.(order) ?? `/orders/${order._id}`}>
                      {actionLabel}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Typography color="text.secondary">{empty}</Typography>
      )}
    </SectionCard>
  )
}

function QueueList({
  title,
  rows,
  renderMeta,
  actionForOrder,
}: {
  title: string
  rows: HydratedOrder[]
  renderMeta: (order: HydratedOrder) => React.ReactNode
  actionForOrder?: (order: HydratedOrder) => React.ReactNode
}) {
  const visibleRows = rows.slice(0, 10)
  return (
    <SectionCard title={title} scrollable maxBodyHeight={420}>
      <Stack spacing={1.5}>
        {visibleRows.length ? (
          visibleRows.map((order) => (
            <Paper key={order._id} sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                <Box>
                  <Typography fontWeight={700}>{order.orderNumber}</Typography>
                  <Typography color="text.secondary">{order.patient.firstName} {order.patient.lastName}</Typography>
                </Box>
                <Stack spacing={1} alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
                  <Box>{renderMeta(order)}</Box>
                  {actionForOrder ? actionForOrder(order) : (
                    <Button component={RouterLink} to={`/orders/${order._id}`}>
                      Open order
                    </Button>
                  )}
                </Stack>
              </Stack>
            </Paper>
          ))
        ) : (
          <Typography color="text.secondary">Nothing is waiting in this queue.</Typography>
        )}
      </Stack>
    </SectionCard>
  )
}

function RoleIntro({ user }: { user: SafeUser }) {
  return (
    <Typography variant="body2" color="text.secondary">
      Signed in as {roleLabels[user.role]}. This workspace is filtered to the tasks and data for your role.
    </Typography>
  )
}

function buildDepartmentQueueOption(analytics: AnalyticsOverview) {
  return {
    tooltip: { trigger: 'axis' as const },
    legend: { bottom: 0 },
    xAxis: {
      type: 'category' as const,
      data: analytics.departmentTallies.map((item) => item.label),
      axisLabel: { interval: 0, rotate: 20 },
    },
    yAxis: { type: 'value' as const },
    series: [
      {
        name: 'Current queue',
        type: 'bar' as const,
        itemStyle: { color: '#1565c0' },
        data: analytics.departmentTallies.map((item) => item.currentQueue),
      },
      {
        name: 'Activity in range',
        type: 'bar' as const,
        itemStyle: { color: '#2e7d32' },
        data: analytics.departmentTallies.map((item) => item.activityCount),
      },
    ],
  }
}

function buildDepartmentTrendOption(analytics: AnalyticsOverview) {
  const seriesKeys = ['Reception', 'Courier', 'Finance', 'Technical', 'Pathology']
  return {
    tooltip: { trigger: 'axis' as const },
    legend: { bottom: 0 },
    xAxis: {
      type: 'category' as const,
      data: analytics.departmentActivityTrend.map((item) => String(item.label)),
    },
    yAxis: { type: 'value' as const },
    series: seriesKeys.map((seriesName, index) => ({
      name: seriesName,
      type: 'line' as const,
      smooth: true,
      symbolSize: 8,
      lineStyle: { width: 3 },
      itemStyle: { color: chartColors[index % chartColors.length] },
      data: analytics.departmentActivityTrend.map((item) => Number(item[seriesName] ?? 0)),
    })),
  }
}

function buildTatOption(analytics: AnalyticsOverview) {
  return {
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const,
      data: analytics.tat.byPhase.map((item) => item.label),
      axisLabel: { interval: 0, rotate: 15 },
    },
    yAxis: { type: 'value' as const, name: 'Minutes' },
    series: [
      {
        name: 'Average minutes',
        type: 'bar' as const,
        itemStyle: { color: '#ed6c02' },
        data: analytics.tat.byPhase.map((item) => item.averageMinutes),
      },
    ],
  }
}

function buildFinanceTrendOption(points: FinanceMonthlyTrendPoint[]) {
  return {
    tooltip: { trigger: 'axis' as const },
    xAxis: {
      type: 'category' as const,
      data: points.map((item) => item.label),
    },
    yAxis: { type: 'value' as const },
    series: [
      {
        name: 'Revenue',
        type: 'bar' as const,
        itemStyle: { color: '#1565c0' },
        data: points.map((item) => item.totalRevenue),
      },
      {
        name: 'Transactions',
        type: 'line' as const,
        smooth: true,
        yAxisIndex: 0,
        itemStyle: { color: '#2e7d32' },
        data: points.map((item) => item.transactionCount),
      },
    ],
  }
}

function buildPaymentsByMethodOption(summary: FinanceSummary | null) {
  const entries = Object.entries(summary?.paymentsByMethod ?? {})
    .filter(([, value]) => value > 0)
    .map(([method, amount]) => ({
      name: paymentMethodLabel(method as FinanceSummary['transactions'][number]['method']),
      value: amount,
    }))

  return {
    tooltip: { trigger: 'item' as const },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie' as const,
        radius: ['42%', '70%'],
        avoidLabelOverlap: false,
        data: entries,
      },
    ],
  }
}

export function DashboardPage() {
  const { user } = useAuth()
  const [analyticsRange, setAnalyticsRange] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('weekly')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')

  const summaryState = useLoadable<DashboardSummary | null>(null, [user?._id], async () => {
    const response = await api.get<DashboardSummary>('/dashboard/summary')
    return response.data
  })
  const ordersState = useLoadable<{ data: HydratedOrder[]; total: number }>({ data: [], total: 0 }, [user?._id], async () => {
    const response = await api.get('/orders', { params: { limit: 25 } })
    return response.data
  })
  const notificationsState = useLoadable<NotificationEntry[]>([], [user?._id], async () => {
    if (user?.role === 'doctor') {
      return []
    }
    const response = await api.get<NotificationEntry[]>('/notifications')
    return response.data
  })
  const financeState = useLoadable<FinanceSummary | null>(null, [user?._id], async () => {
    if (!user || !['super_admin', 'admin', 'finance'].includes(user.role)) {
      return null
    }
    const response = await api.get<FinanceSummary>('/finance/summary')
    return response.data
  })
  const financeTrendState = useLoadable<FinanceMonthlyTrendPoint[]>([], [user?._id], async () => {
    if (!user || !['super_admin', 'admin', 'finance'].includes(user.role)) {
      return []
    }
    const response = await api.get<FinanceMonthlyTrendPoint[]>('/finance/monthly-trends', {
      params: { months: 12 },
    })
    return response.data
  })
  const accessionsState = useLoadable<Accession[]>([], [user?._id], async () => {
    if (!user || !['super_admin', 'admin', 'technician', 'pathologist'].includes(user.role)) {
      return []
    }
    const response = await api.get<Accession[]>('/accessions')
    return response.data
  })
  const usersState = useLoadable<SafeUser[]>([], [user?._id], async () => {
    if (!user || !['super_admin', 'admin'].includes(user.role)) {
      return []
    }
    const response = await api.get<SafeUser[]>('/users')
    return response.data
  })
  const sitesState = useLoadable<Site[]>([], [user?._id], async () => {
    if (user?.role !== 'super_admin') {
      return []
    }
    const response = await api.get<Site[]>('/sites')
    return response.data
  })
  const operationalState = useLoadable<OperationalSummary | null>(null, [user?._id], async () => {
    if (!user || !['super_admin', 'admin'].includes(user.role)) {
      return null
    }
    const response = await api.get<OperationalSummary>('/analytics/operational-summary')
    return response.data
  })
  const analyticsState = useLoadable<AnalyticsOverview | null>(
    null,
    [user?._id, analyticsRange, customStartDate, customEndDate],
    async () => {
      if (!user || !['super_admin', 'admin'].includes(user.role)) {
        return null
      }
      const response = await api.get<AnalyticsOverview>('/analytics/overview', {
        params: {
          range: analyticsRange,
          start: analyticsRange === 'custom' ? customStartDate || undefined : undefined,
          end: analyticsRange === 'custom' ? customEndDate || undefined : undefined,
        },
      })
      return response.data
    },
  )
  const doctorStatsState = useLoadable<DoctorStats | null>(null, [user?._id], async () => {
    if (user?.role !== 'doctor') {
      return null
    }
    const response = await api.get<DoctorStats>('/doctors/me/stats')
    return response.data
  })

  const waitingForRoleData =
    (user?.role === 'finance' && (financeState.loading || financeTrendState.loading)) ||
    (user?.role === 'courier' && notificationsState.loading) ||
    (user?.role === 'technician' && accessionsState.loading) ||
    (user?.role === 'pathologist' && accessionsState.loading) ||
    (user?.role === 'doctor' && doctorStatsState.loading) ||
    (user?.role === 'admin' &&
      (financeState.loading || financeTrendState.loading || usersState.loading || operationalState.loading || analyticsState.loading)) ||
    (user?.role === 'super_admin' &&
      (financeState.loading || financeTrendState.loading || usersState.loading || sitesState.loading || operationalState.loading || analyticsState.loading))

  if (!user || summaryState.loading || ordersState.loading || notificationsState.loading || waitingForRoleData) {
    return <LoadingPanel label="Loading dashboard…" />
  }

  if (summaryState.error || !summaryState.data) {
    return <PageError message={summaryState.error ?? 'Could not load dashboard'} />
  }

  const orders = ordersState.data.data
  const urgentOrders = orders.filter((order) => order.priority === 'urgent')
  const reviewQueue = orders.filter((order) => order.status === 'review')
  const courierQueue = orders.filter((order) => order.courierStatus && order.courierStatus !== 'received_at_lab')
  const financialBlocks = orders.filter((order) => order.financialClearance === 'blocked' || order.financialClearance === 'pending')
  const activeAccessions = accessionsState.data.filter((entry) => !entry.stainedAt)
  const completedDeliveries = orders.filter((order) => order.courierStatus === 'received_at_lab')
  const latestTransactions = financeState.data?.transactions.slice(0, 6) ?? []
  const analytics = analyticsState.data
  const usersByRole = usersState.data.reduce<Record<string, number>>((acc, item) => {
    acc[item.role] = (acc[item.role] ?? 0) + 1
    return acc
  }, {})
  const accessionByOrderId = new Map(accessionsState.data.map((entry) => [entry.orderId, entry]))
  const departmentQueueOption = analytics ? buildDepartmentQueueOption(analytics) : null
  const departmentTrendOption = analytics ? buildDepartmentTrendOption(analytics) : null
  const tatOption = analytics ? buildTatOption(analytics) : null
  const financeTrendOption = financeTrendState.data.length
    ? buildFinanceTrendOption(financeTrendState.data)
    : null
  const paymentsByMethodOption = buildPaymentsByMethodOption(financeState.data)

  let content: React.ReactNode

  switch (user.role) {
    case 'receptionist':
      content = (
        <Stack spacing={3}>
          <QuickActions
            actions={[
              { label: 'Register a new order', description: 'Create walk-in or referred orders from the front desk.', to: '/orders/create' },
              { label: 'Open receptionist workflow', description: 'Receive, clear, assign, and release front-office work from one queue.', to: '/receptionist/workflow' },
              { label: 'Track courier handoffs', description: 'Monitor samples that need pickup or delivery follow-up.', to: '/courier' },
              { label: 'Review all orders', description: 'Search the full site order list and open case details.', to: '/orders' },
            ]}
          />
          <MetricsGrid>
            <MetricCard label="Orders today" value={String(summaryState.data.totalOrders)} />
            <MetricCard label="Urgent intake" value={String(urgentOrders.length)} />
            <MetricCard label="Courier pickups" value={String(courierQueue.length)} />
            <MetricCard label="Financial holds" value={String(financialBlocks.length)} />
          </MetricsGrid>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <QueueList
              title="Urgent intake"
              rows={urgentOrders}
              renderMeta={(order) => <StatusChip status={order.status} />}
              actionForOrder={(order) => (
                <Button component={RouterLink} to={`/orders/${order._id}`}>
                  Open intake
                </Button>
              )}
            />
            <QueueList
              title="Courier pickup queue"
              rows={courierQueue}
              renderMeta={(order) => <CourierChip status={order.courierStatus} />}
              actionForOrder={() => (
                <Button component={RouterLink} to="/courier">
                  Open courier board
                </Button>
              )}
            />
          </Box>
          <OrdersTable orders={orders.slice(0, 8)} empty="No site orders are available yet." />
          <NotificationsPanel items={notificationsState.data} />
        </Stack>
      )
      break
    case 'technician':
      content = (
        <Stack spacing={3}>
          <QuickActions
            actions={[
              { label: 'Open technician queue', description: 'Pick up received orders and assign cases onward when histology is complete.', to: '/technician/workflow' },
              { label: 'Continue histology', description: 'Move accessioned cases through grossing, processing, embedding, sectioning, and staining.', to: '/histology' },
              { label: 'Record IHC stains', description: 'Capture antibody runs and quality notes for stained slides.', to: '/ihc' },
              { label: 'Check inventory', description: 'Inspect synced specimens and accession-linked sample details.', to: '/inventory' },
            ]}
          />
          <MetricsGrid>
            <MetricCard label="Active cases" value={String(activeAccessions.length)} />
            <MetricCard label="In progress" value={String(orders.filter((order) => order.status === 'in_progress').length)} />
            <MetricCard label="Awaiting review" value={String(reviewQueue.length)} />
            <MetricCard label="Grossed / accessioned" value={String(accessionsState.data.length)} />
          </MetricsGrid>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <QueueList
              title="Processing queue"
              rows={orders.filter((order) => ['received', 'in_progress'].includes(order.status))}
              renderMeta={(order) => <StatusChip status={order.status} />}
              actionForOrder={(order) => {
                const accession = accessionByOrderId.get(order._id)
                return (
                  <Button component={RouterLink} to={accession ? `/histology?accession=${encodeURIComponent(accession.accessionId)}` : '/technician/workflow'}>
                    {accession ? 'Open histology' : 'Open queue'}
                  </Button>
                )
              }}
            />
            <QueueList
              title="Ready for pathologist"
              rows={reviewQueue}
              renderMeta={(order) => <StatusChip status={order.status} />}
              actionForOrder={(order) => (
                <Button component={RouterLink} to={`/orders/${order._id}`}>
                  Open case
                </Button>
              )}
            />
          </Box>
          <OrdersTable orders={orders.slice(0, 8)} empty="No active technical workload is available." actionLabel="Open case" />
        </Stack>
      )
      break
    case 'pathologist':
      content = (
        <Stack spacing={3}>
          <QuickActions
            actions={[
              { label: 'Review queue', description: 'Open cases awaiting sign-out and report completion.', to: '/pathologist/workflow' },
              { label: 'Released reports', description: 'Download PDFs and send finalized reports to clients.', to: '/reports' },
              { label: 'Digital pathology', description: 'Inspect simulated slide imaging output for scanned slides.', to: '/digital-pathology' },
              { label: 'Notifications', description: 'Catch escalations, unread alerts, and critical handoffs.', to: '/notifications' },
            ]}
          />
          <MetricsGrid>
            <MetricCard label="Review queue" value={String(reviewQueue.length)} />
            <MetricCard label="Ready reports" value={String(summaryState.data.readyReports)} />
            <MetricCard label="Signed-out cases" value={String(orders.filter((order) => order.status === 'completed').length)} />
            <MetricCard label="Digital-ready slides" value={String(accessionsState.data.filter((entry) => entry.stainedAt).length)} />
          </MetricsGrid>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <QueueList
              title="Cases awaiting interpretation"
              rows={reviewQueue}
              renderMeta={(order) => <StatusChip status={order.status} />}
              actionForOrder={(order) => (
                <Button component={RouterLink} to={`/orders/${order._id}`}>
                  Review case
                </Button>
              )}
            />
            <NotificationsPanel items={notificationsState.data} />
          </Box>
          <OrdersTable orders={orders.slice(0, 8)} empty="No pathology cases are ready right now." actionLabel="Open report" />
        </Stack>
      )
      break
    case 'finance':
      content = (
        <Stack spacing={3}>
          <QuickActions
            actions={[
              { label: 'Open finance console', description: 'Process payments, confirm with patients, and generate receipts.', to: '/financial' },
              { label: 'Monitor outstanding clearance', description: 'Review blocked or pending orders before they move forward.', to: '/financial' },
              { label: 'Review notifications', description: 'Stay on top of payment issues and follow-ups from the portal.', to: '/notifications' },
            ]}
          />
          <MetricsGrid>
            <MetricCard label="Revenue" value={financeState.data?.totalRevenueDisplay ?? formatMoney(0)} />
            <MetricCard label="Completed payments" value={String(financeState.data?.completedPayments ?? 0)} />
            <MetricCard label="Pending payments" value={String(financeState.data?.pendingPayments ?? 0)} />
            <MetricCard label="Financial clearance queue" value={String(financialBlocks.length)} />
          </MetricsGrid>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <QueueList
              title="Clearance queue"
              rows={financialBlocks}
              renderMeta={(order) => <Typography color="text.secondary">{order.financialClearance ?? 'pending'}</Typography>}
              actionForOrder={(order) => (
                <Button component={RouterLink} to={`/orders/${order._id}`}>
                  Open financial case
                </Button>
              )}
            />
            <NotificationsPanel items={notificationsState.data} />
          </Box>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            {financeTrendOption ? (
              <EChartPanel
                title="Monthly revenue"
                description="Month by month totals and transaction volume."
                option={financeTrendOption}
              />
            ) : null}
            <EChartPanel
              title="Payments by method"
              description="Completed collections by payment channel."
              option={paymentsByMethodOption}
            />
          </Box>
          <SectionCard title="Latest transactions" scrollable maxBodyHeight={420}>
            <Stack spacing={1.5}>
              {latestTransactions.length ? (
                latestTransactions.slice(0, 10).map((payment) => (
                  <Paper key={payment._id} sx={{ p: 2 }}>
                    <Typography fontWeight={700}>{payment.order.orderNumber}</Typography>
                    <Typography color="text.secondary">
                      {payment.order.patient.firstName} {payment.order.patient.lastName}
                    </Typography>
                    <Typography sx={{ mt: 1 }}>{payment.amountDisplay} via {paymentMethodLabel(payment.method)}</Typography>
                    <Button component={RouterLink} to={`/orders/${payment.orderId}`} sx={{ mt: 1.5 }}>
                      Open order
                    </Button>
                  </Paper>
                ))
              ) : (
                <Typography color="text.secondary">No finance transactions are available yet.</Typography>
              )}
            </Stack>
          </SectionCard>
        </Stack>
      )
      break
    case 'courier':
      content = (
        <Stack spacing={3}>
          <QuickActions
            actions={[
              { label: 'Open courier board', description: 'Advance pickup requests through dispatch, transit, and receipt at the lab.', to: '/courier' },
              { label: 'Review active jobs', description: 'Track orders already assigned to the courier lifecycle.', to: '/courier' },
              { label: 'Read notifications', description: 'Catch urgent sample delivery changes and failed handoffs.', to: '/notifications' },
            ]}
          />
          <MetricsGrid>
            <MetricCard label="Pickup requests" value={String(orders.filter((order) => order.courierStatus === 'ready_for_pickup').length)} />
            <MetricCard label="Active trips" value={String(courierQueue.length)} />
            <MetricCard label="Delivered" value={String(completedDeliveries.length)} />
            <MetricCard label="Orders awaiting check-in" value={String(orders.filter((order) => !order.courierStatus).length)} />
          </MetricsGrid>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <QueueList
              title="Pickup requests"
              rows={orders.filter((order) => order.courierStatus === 'ready_for_pickup')}
              renderMeta={(order) => <CourierChip status={order.courierStatus} />}
              actionForOrder={(order) => (
                <Button component={RouterLink} to={`/orders/${order._id}`}>
                  View pickup
                </Button>
              )}
            />
            <QueueList
              title="In transit"
              rows={orders.filter((order) =>
                ['on_way_to_pickup', 'at_site_for_pickup', 'picked_up_on_way_to_lab', 'in_transit'].includes(order.courierStatus),
              )}
              renderMeta={(order) => <CourierChip status={order.courierStatus} />}
              actionForOrder={(order) => (
                <Button component={RouterLink} to={`/orders/${order._id}`}>
                  Track order
                </Button>
              )}
            />
          </Box>
          <OrdersTable orders={courierQueue.slice(0, 8)} empty="No courier jobs are active right now." actionLabel="Track" />
        </Stack>
      )
      break
    case 'doctor':
      content = (
        <Stack spacing={3}>
          <MetricsGrid>
            <MetricCard label="My referrals" value={String(doctorStatsState.data?.totalOrders ?? 0)} />
            <MetricCard label="Ready reports" value={String(doctorStatsState.data?.completedOrders ?? 0)} />
            <MetricCard label="In review" value={String(doctorStatsState.data?.reviewOrders ?? 0)} />
            <MetricCard label="Visible cases" value={String(orders.length)} />
          </MetricsGrid>
          <QuickActions
            actions={[
              { label: 'Open referrer portal', description: 'Review referral totals and your linked clinician profile.', to: '/doctor-portal' },
              { label: 'Review linked cases', description: 'Open referral cases and inspect released reports or current status.', to: '/dashboard' },
              { label: 'Manage account', description: 'Update your name or password for portal access.', to: '/settings' },
            ]}
          />
          <OrdersTable
            orders={orders.slice(0, 8)}
            empty="No linked referral orders were found for this doctor account."
            actionLabel="Review"
          />
        </Stack>
      )
      break
    case 'admin':
      content = (
        <Stack spacing={3}>
          <AnalyticsFilterBar
            range={analyticsRange}
            startDate={customStartDate}
            endDate={customEndDate}
            onRangeChange={setAnalyticsRange}
            onStartDateChange={setCustomStartDate}
            onEndDateChange={setCustomEndDate}
          />
          <QuickActions
            actions={[
              { label: 'Manage staff', description: 'Create, activate, and update users for this lab only.', to: '/admin/users' },
              { label: 'Monitor operations', description: 'Review site orders, queues, and released cases.', to: '/orders' },
              { label: 'Control finance', description: 'Process payments and watch site-level clearance status.', to: '/financial' },
              { label: 'Adjust configuration', description: 'Update test types, workflows, and local system settings.', to: '/admin/settings' },
            ]}
          />
          <MetricsGrid>
            <MetricCard label="Site orders" value={String(summaryState.data.totalOrders)} />
            <MetricCard label="Review queue" value={String(summaryState.data.reviewOrders)} />
            <MetricCard label="Revenue" value={financeState.data?.totalRevenueDisplay ?? formatMoney(0)} />
            <MetricCard label="Active staff" value={String(usersState.data.filter((item) => item.active).length)} />
            <MetricCard label="Average TAT" value={`${analytics?.tat.overallAverageMinutes ?? 0} min`} />
            <MetricCard label="TAT breaches" value={String(analytics?.tat.breachCount ?? 0)} />
          </MetricsGrid>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <SectionCard title="Workforce mix">
              <Stack spacing={1}>
                {Object.entries(usersByRole).map(([role, count]) => (
                  <Typography key={role}>{roleLabels[role as keyof typeof roleLabels] ?? role}: {count}</Typography>
                ))}
              </Stack>
            </SectionCard>
            <NotificationsPanel items={notificationsState.data} />
          </Box>
          {analytics && departmentQueueOption && departmentTrendOption && tatOption ? (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
              <EChartPanel
                title="Department tallies"
                description="Current workload versus filtered activity by department."
                option={departmentQueueOption}
              />
              <EChartPanel
                title="Department trend"
                description="Filtered activity over time."
                option={departmentTrendOption}
              />
              <EChartPanel
                title="Turnaround time"
                description="Average TAT per major phase."
                option={tatOption}
              />
              {financeTrendOption ? (
                <EChartPanel
                  title="Monthly financial performance"
                  description="Revenue and transaction volume by month."
                  option={financeTrendOption}
                />
              ) : null}
            </Box>
          ) : null}
          <OrdersTable orders={orders.slice(0, 8)} empty="No orders are available for this lab yet." />
        </Stack>
      )
      break
    case 'super_admin':
      content = (
        <Stack spacing={3}>
          <AnalyticsFilterBar
            range={analyticsRange}
            startDate={customStartDate}
            endDate={customEndDate}
            onRangeChange={setAnalyticsRange}
            onStartDateChange={setCustomStartDate}
            onEndDateChange={setCustomEndDate}
          />
          <QuickActions
            actions={[
              { label: 'Global user control', description: 'Manage users across sites, including admin and super admin accounts.', to: '/admin/users' },
              { label: 'Enterprise administration', description: 'Review master-data, integrations, and cross-module operations.', to: '/operations/enterprise-admin' },
              { label: 'Module audit', description: 'Inspect implemented module coverage and remaining production gaps.', to: '/operations/module-audit' },
              { label: 'Governance & compliance', description: 'Review quality, audit, and compliance-related enterprise records.', to: '/operations/governance' },
            ]}
          />
          <MetricsGrid>
            <MetricCard label="Network orders" value={String(operationalState.data?.totalOrders ?? summaryState.data.totalOrders)} />
            <MetricCard label="Validated" value={String(operationalState.data?.validatedOrders ?? 0)} />
            <MetricCard label="Completed reports" value={String(operationalState.data?.completedReports ?? 0)} />
            <MetricCard label="Sites" value={String(sitesState.data.length)} />
            <MetricCard label="Average TAT" value={`${analytics?.tat.overallAverageMinutes ?? 0} min`} />
            <MetricCard label="TAT breaches" value={String(analytics?.tat.breachCount ?? 0)} />
          </MetricsGrid>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
            <SectionCard title="Global controls">
              <Stack spacing={1.25}>
                <Typography>Revenue: {financeState.data?.totalRevenueDisplay ?? formatMoney(0)}</Typography>
                <Typography>Open quality events: {operationalState.data?.openQualityEvents ?? 0}</Typography>
                <Typography>Active integrations: {operationalState.data?.activeIntegrations ?? 0}</Typography>
                <Typography>Multi-site transfers: {operationalState.data?.multiSiteTransfers ?? 0}</Typography>
                <Typography>De-identified exports: {operationalState.data?.deidentifiedExports ?? 0}</Typography>
              </Stack>
            </SectionCard>
            <SectionCard title="Site footprint">
              <Stack spacing={1}>
                {sitesState.data.map((site) => (
                  <Typography key={site._id}>{site.name} ({site.code})</Typography>
                ))}
              </Stack>
            </SectionCard>
          </Box>
          {analytics && departmentQueueOption && departmentTrendOption && tatOption ? (
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
              <EChartPanel
                title="Department tallies"
                description="Current queues across the network and activity in the selected range."
                option={departmentQueueOption}
              />
              <EChartPanel
                title="Department trend"
                description="Operational activity over time."
                option={departmentTrendOption}
              />
              <EChartPanel
                title="Turnaround time"
                description="Average TAT per phase for the selected range."
                option={tatOption}
              />
              {financeTrendOption ? (
                <EChartPanel
                  title="Monthly financial performance"
                  description="Month by month revenue and payment volume."
                  option={financeTrendOption}
                />
              ) : null}
            </Box>
          ) : null}
          <SectionCard title="User directory" scrollable maxBodyHeight={320}>
            <Stack spacing={1}>
              {usersState.data.slice(0, 10).map((account) => (
                <Typography key={account._id}>
                  {account.name} · {roleLabels[account.role]} · {account.siteId ?? 'global'}
                </Typography>
              ))}
            </Stack>
          </SectionCard>
          <OrdersTable orders={orders.slice(0, 8)} empty="No orders exist in the network yet." />
        </Stack>
      )
      break
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Dashboard" description="Role-focused laboratory workspace." />
      <RoleIntro user={user} />
      {content}
    </Stack>
  )
}

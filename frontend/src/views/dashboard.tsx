import {
  Box,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'

import { api } from '../api'
import { useAuth } from '../auth'
import { CourierChip, LoadingPanel, MetricCard, PageHeader, SectionCard, StatusChip } from '../components'
import { roleLabels } from '../app/access'
import { PageError, unwrapList, useLoadable } from './shared'

import type {
  Accession,
  DashboardSummary,
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

function WorkflowItemStatusGrid({ summary }: { summary: DashboardSummary['workflowItems'] }) {
  return (
    <MetricsGrid>
      <MetricCard label="Pending items" value={String(summary.pending)} />
      <MetricCard label="Blocked items" value={String(summary.blocked)} />
      <MetricCard label="Completed items" value={String(summary.completed)} />
      <MetricCard label="Released items" value={String(summary.released)} />
    </MetricsGrid>
  )
}

function NotificationsPanel({ items }: { items: NotificationEntry[] }) {
  return (
    <SectionCard title="Notifications">
      <Stack spacing={1.5}>
        {items.length ? (
          items.slice(0, 5).map((item) => (
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
  return (
    <SectionCard title="Orders">
      {orders.length ? (
        <TableContainer>
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
              {orders.map((order) => (
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
  return (
    <SectionCard title={title}>
      <Stack spacing={1.5}>
        {rows.length ? (
          rows.slice(0, 6).map((order) => (
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

export function DashboardPage() {
  const { user } = useAuth()

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
    const response = await api.get<SafeUser[] | { data: SafeUser[] }>('/users')
    return unwrapList(response.data)
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
  const doctorStatsState = useLoadable<DoctorStats | null>(null, [user?._id], async () => {
    if (user?.role !== 'doctor') {
      return null
    }
    const response = await api.get<DoctorStats>('/doctors/me/stats')
    return response.data
  })

  const waitingForRoleData =
    (user?.role === 'finance' && financeState.loading) ||
    (user?.role === 'courier' && notificationsState.loading) ||
    (user?.role === 'technician' && accessionsState.loading) ||
    (user?.role === 'pathologist' && accessionsState.loading) ||
    (user?.role === 'doctor' && doctorStatsState.loading) ||
    (user?.role === 'admin' && (financeState.loading || usersState.loading || operationalState.loading)) ||
    (user?.role === 'super_admin' &&
      (financeState.loading || usersState.loading || sitesState.loading || operationalState.loading))

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
  const usersByRole = usersState.data.reduce<Record<string, number>>((acc, item) => {
    acc[item.role] = (acc[item.role] ?? 0) + 1
    return acc
  }, {})
  const accessionByOrderId = new Map(accessionsState.data.map((entry) => [entry.orderId, entry]))

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
          <SectionCard title="Latest transactions">
            <Stack spacing={1.5}>
              {latestTransactions.length ? (
                latestTransactions.map((payment) => (
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
          <OrdersTable orders={orders.slice(0, 8)} empty="No orders are available for this lab yet." />
        </Stack>
      )
      break
    case 'super_admin':
      content = (
        <Stack spacing={3}>
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
          <SectionCard title="User directory">
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
      <WorkflowItemStatusGrid summary={summaryState.data.workflowItems} />
      {content}
    </Stack>
  )
}

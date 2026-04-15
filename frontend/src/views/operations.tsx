import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'

import EmailRoundedIcon from '@mui/icons-material/EmailRounded'

import SyncRoundedIcon from '@mui/icons-material/SyncRounded'

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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

import { useState } from 'react'

import ReactECharts from 'echarts-for-react'

import { Link as RouterLink, useParams } from 'react-router-dom'

import { api } from '../api'

import {
  CourierChip,
  EmptyState,
  LoadingPanel,
  MetricCard,
  PageHeader,
  SectionCard,
} from '../components'

import { errorMessage, PageError, useActionLock, useLoadable } from './shared'

import type {
  FinanceSummary,
  FinanceMonthlyDashboard,
  HydratedOrder,
  MavianceGatewayConfig,
  MavianceTransaction,
  NotificationEntry,
  Report,
  Sample,
  Doctor,
  ZohoBooksConfig,
  ZohoBooksOrganization,
  ZohoBooksSyncLog,
} from '../types'

import { downloadPathologyReportPdf, downloadPdfDocument, formatDate, formatDateTime, formatMoney, paymentMethodLabel } from '../utils'

const manualPaymentMethods = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'bank_transfer', label: 'Bank transfer' },
] as const

const mavianceChannels = [
  { value: 'mtn_cameroon', label: 'MTN Mobile Money' },
  { value: 'orange_cameroon', label: 'Orange Money' },
] as const

export function FinancePage() {
  const actionLock = useActionLock()
  const summaryState = useLoadable<FinanceSummary | null>(null, [], async () => {
    const response = await api.get<FinanceSummary>('/finance/summary')
    return response.data
  })
  const monthlyState = useLoadable<FinanceMonthlyDashboard | null>(null, [], async () => {
    const response = await api.get<FinanceMonthlyDashboard>('/finance/monthly-dashboard')
    return response.data
  })
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders', { params: { limit: 100 } })
    return response.data
  })
  const mavianceConfigState = useLoadable<MavianceGatewayConfig | null>(null, [], async () => {
    const response = await api.get<MavianceGatewayConfig>('/payments/maviance/config')
    return response.data
  })
  const mavianceTransactionsState = useLoadable<Array<MavianceTransaction & { order: HydratedOrder }>>([], [], async () => {
    const response = await api.get<Array<MavianceTransaction & { order: HydratedOrder }>>('/payments/maviance/transactions')
    return response.data
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [mavianceDialogOpen, setMavianceDialogOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [mavianceSubmitting, setMavianceSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [paymentForm, setPaymentForm] = useState<{
    orderId: string
    amount: number
    method: 'cash' | 'card' | 'mobile_money' | 'bank_transfer'
    status: 'pending' | 'completed' | 'failed'
  }>({
    orderId: '',
    amount: 0,
    method: 'cash',
    status: 'completed',
  })
  const [mavianceForm, setMavianceForm] = useState<{
    orderId: string
    amount: number
    channel: 'mtn_cameroon' | 'orange_cameroon'
    customerPhone: string
    customerEmail: string
    customerName: string
    customerAddress: string
    tag: string
  }>({
    orderId: '',
    amount: 0,
    channel: 'mtn_cameroon',
    customerPhone: '',
    customerEmail: '',
    customerName: '',
    customerAddress: '',
    tag: '',
  })

  if (summaryState.loading || ordersState.loading || monthlyState.loading) return <LoadingPanel label="Loading finance…" />
  if (summaryState.error || !summaryState.data) return <PageError message={summaryState.error ?? 'Could not load finance'} />

  const pieData = Object.entries(summaryState.data.paymentsByMethod)
    .filter(([, value]) => value > 0)
    .map(([name, value]) => ({ name: paymentMethodLabel(name as FinanceSummary['transactions'][number]['method']), value }))
  const paymentMethodChart = {
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['45%', '72%'],
        data: pieData,
      },
    ],
  }
  const monthlyChart = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Net revenue', 'Gross revenue', 'Refunds'] },
    grid: { left: 40, right: 20, top: 50, bottom: 35 },
    xAxis: {
      type: 'category',
      data: monthlyState.data?.rows.map((row) => row.month) ?? [],
    },
    yAxis: { type: 'value' },
    series: [
      {
        name: 'Net revenue',
        type: 'bar',
        data: monthlyState.data?.rows.map((row) => row.netRevenue) ?? [],
      },
      {
        name: 'Gross revenue',
        type: 'line',
        smooth: true,
        data: monthlyState.data?.rows.map((row) => row.grossRevenue) ?? [],
      },
      {
        name: 'Refunds',
        type: 'line',
        smooth: true,
        data: monthlyState.data?.rows.map((row) => row.refunds) ?? [],
      },
    ],
  }
  const completedAmountsByOrder = summaryState.data.transactions
    .filter((payment) => payment.status === 'completed')
    .reduce<Record<string, number>>((acc, payment) => {
      acc[payment.orderId] = (acc[payment.orderId] ?? 0) + payment.amount
      return acc
    }, {})
  const outstandingOrders = ordersState.data.data
    .map((order) => {
      const totalAmount = order.testTypes.reduce((sum, test) => sum + test.price, 0)
      const paidAmount = completedAmountsByOrder[order._id] ?? 0
      return {
        order,
        totalAmount,
        paidAmount,
        outstandingAmount: Math.max(0, totalAmount - paidAmount),
      }
    })
    .filter(({ order, outstandingAmount }) => order.financialClearance !== 'cleared' || outstandingAmount > 0)
    .sort((a, b) => b.outstandingAmount - a.outstandingAmount)

  const openPaymentDialog = (order?: HydratedOrder) => {
    const target = order ?? outstandingOrders[0]?.order ?? ordersState.data.data[0]
    const targetOutstanding = outstandingOrders.find((entry) => entry.order._id === target?._id)
    setPaymentForm({
      orderId: target?._id ?? '',
      amount: targetOutstanding?.outstandingAmount ?? target?.testTypes.reduce((sum, test) => sum + test.price, 0) ?? 0,
      method: 'cash',
      status: 'completed',
    })
    setFeedback(null)
    setDialogOpen(true)
  }

  const openMavianceDialog = (order?: HydratedOrder) => {
    const target = order ?? outstandingOrders[0]?.order ?? ordersState.data.data[0]
    const targetOutstanding = outstandingOrders.find((entry) => entry.order._id === target?._id)
    setMavianceForm({
      orderId: target?._id ?? '',
      amount: targetOutstanding?.outstandingAmount ?? target?.testTypes.reduce((sum, test) => sum + test.price, 0) ?? 0,
      channel: 'mtn_cameroon',
      customerPhone: target?.patient.phone ?? '',
      customerEmail: target?.patient.email ?? '',
      customerName: target ? `${target.patient.firstName} ${target.patient.lastName}` : '',
      customerAddress: target?.patient.address ?? '',
      tag: target?.orderNumber ?? '',
    })
    setFeedback(null)
    setMavianceDialogOpen(true)
  }

  const refreshFinance = () => {
    summaryState.refresh()
    monthlyState.refresh()
    ordersState.refresh()
    mavianceConfigState.refresh()
    mavianceTransactionsState.refresh()
  }

  const selectedOrder = ordersState.data.data.find((order) => order._id === paymentForm.orderId)
  const selectedOrderTotal = selectedOrder?.testTypes.reduce((sum, test) => sum + test.price, 0) ?? 0
  const selectedOrderPaid = completedAmountsByOrder[paymentForm.orderId] ?? 0
  const selectedOrderBalance = Math.max(0, selectedOrderTotal - selectedOrderPaid)
  const selectedMavianceOrder = ordersState.data.data.find((order) => order._id === mavianceForm.orderId)

  const submitPayment = async () => {
    if (!paymentForm.orderId) {
      setFeedback({ kind: 'error', message: 'Choose an order before processing payment.' })
      return
    }
    setSubmitting(true)
    setFeedback(null)
    try {
      await api.post(`/orders/${paymentForm.orderId}/payment`, paymentForm)
      setDialogOpen(false)
      refreshFinance()
      setFeedback({ kind: 'success', message: 'Payment recorded and finance summary refreshed.' })
    } catch (submitError) {
      setFeedback({ kind: 'error', message: errorMessage(submitError) })
    } finally {
      setSubmitting(false)
    }
  }

  const submitMaviance = async () => {
    if (!mavianceForm.orderId) {
      setFeedback({ kind: 'error', message: 'Choose an order before starting a Maviance collection.' })
      return
    }
    setMavianceSubmitting(true)
    setFeedback(null)
    try {
      const response = await api.post<{ message?: string }>('/payments/maviance/initiate', mavianceForm)
      setMavianceDialogOpen(false)
      refreshFinance()
      setFeedback({
        kind: 'success',
        message: response.data.message ?? 'Maviance collection started successfully.',
      })
    } catch (submitError) {
      setFeedback({ kind: 'error', message: errorMessage(submitError) })
    } finally {
      setMavianceSubmitting(false)
    }
  }

  const verifyMaviance = async (transactionId: string) => {
    await actionLock.runLocked(`verify-${transactionId}`, async () => {
      try {
        const response = await api.post<{ message?: string }>(`/payments/maviance/transactions/${transactionId}/verify`)
        refreshFinance()
        setFeedback({
          kind: 'success',
          message: response.data.message ?? 'Maviance transaction verified.',
        })
      } catch (verifyError) {
        setFeedback({ kind: 'error', message: errorMessage(verifyError) })
      }
    })
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Finance"
        title="Financial"
        action={(
          <Stack direction="row" spacing={1.5}>
            <Button onClick={refreshFinance}>Refresh</Button>
            <Button onClick={() => openMavianceDialog()}>Maviance collection</Button>
            <Button variant="contained" onClick={() => openPaymentDialog()}>
              Process payment
            </Button>
          </Stack>
        )}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      {ordersState.error ? <Alert severity="error">{ordersState.error}</Alert> : null}
      {monthlyState.error ? <Alert severity="error">{monthlyState.error}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
        <MetricCard label="Total revenue (paid)" value={summaryState.data.totalRevenueDisplay} helper={`${summaryState.data.completedPayments} completed payments`} />
        <MetricCard label="Paid transactions" value={String(summaryState.data.completedPayments)} />
        <MetricCard label="Pending" value={String(summaryState.data.pendingPayments)} />
        <MetricCard label="Outstanding orders" value={String(outstandingOrders.length)} />
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1.3fr' } }}>
        <SectionCard title="Maviance readiness" description="Cameroon wallet collections run through Smobilpay by Maviance.">
          <Stack spacing={1.5}>
            {mavianceConfigState.error ? <Alert severity="error">{mavianceConfigState.error}</Alert> : null}
            <Typography>
              Enabled: {mavianceConfigState.data?.enabled ? 'Yes' : 'No'} · Credentials: {mavianceConfigState.data?.credentialsConfigured ? 'Configured' : 'Missing'}
            </Typography>
            <Typography>
              Webhook secret: {mavianceConfigState.data?.webhookConfigured ? 'Configured' : 'Missing'} · Request format: {mavianceConfigState.data?.requestFormat ?? '—'}
            </Typography>
            {mavianceConfigState.data?.channels.map((channel) => (
              <Paper key={channel.channel} variant="outlined" sx={{ p: 1.5 }}>
                <Typography fontWeight={700}>{channel.label}</Typography>
                <Typography color="text.secondary" variant="body2">
                  Merchant {channel.merchantCode ?? '—'} · Service {channel.serviceId ?? '—'}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Pay item {channel.payItemId ?? 'Auto-discover from /cashin'} · {channel.configured ? 'Ready' : 'Needs env setup'}
                </Typography>
              </Paper>
            ))}
          </Stack>
        </SectionCard>
        <SectionCard title="Recent Maviance collections" description="Track MTN and Orange payment prompts, then verify pending ones.">
          {mavianceTransactionsState.error ? <Alert severity="error">{mavianceTransactionsState.error}</Alert> : null}
          {mavianceTransactionsState.data.length ? (
            <Stack spacing={1.5}>
              {mavianceTransactionsState.data.slice(0, 5).map((transaction) => (
                <Paper key={transaction._id} sx={{ p: 2 }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                    <Box>
                      <Typography fontWeight={700}>{transaction.order.orderNumber}</Typography>
                      <Typography color="text.secondary">
                        {transaction.order.patient.firstName} {transaction.order.patient.lastName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                        {formatMoney(transaction.amount, transaction.currency)} · {transaction.channel === 'mtn_cameroon' ? 'MTN Mobile Money' : 'Orange Money'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Status {transaction.providerStatus}{transaction.ptn ? ` · PTN ${transaction.ptn}` : ''}
                      </Typography>
                    </Box>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                      <Button
                        size="small"
                        disabled={actionLock.isPending(`verify-${transaction._id}`)}
                        onClick={() => verifyMaviance(transaction._id)}
                      >
                        Verify
                      </Button>
                      <Button size="small" component={RouterLink} to={`/orders/${transaction.orderId}`}>
                        Open order
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          ) : (
            <EmptyState title="No Maviance collections yet" body="Start an MTN or Orange wallet collection to begin tracking live gateway activity." />
          )}
        </SectionCard>
      </Box>
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
        <SectionCard title="Payments by method">
          <Box sx={{ height: 280, minWidth: 0 }}>
            <ReactECharts option={paymentMethodChart} style={{ height: 280, width: '100%' }} />
          </Box>
        </SectionCard>
        <SectionCard title="Month-by-month revenue" description="Finance-grade revenue trend from posted payments and approved refunds.">
          <Box sx={{ height: 320, minWidth: 0 }}>
            {monthlyState.data?.rows.some((row) => row.grossRevenue > 0 || row.refunds > 0) ? (
              <ReactECharts option={monthlyChart} style={{ height: 320, width: '100%' }} />
            ) : (
              <EmptyState title="No monthly revenue yet" body="Completed payments and refunds will appear here automatically." />
            )}
          </Box>
        </SectionCard>
      </Box>
      <SectionCard title="Outstanding clearance queue" description="Orders remain here until they are financially cleared or fully paid.">
        {outstandingOrders.length ? (
          <Stack spacing={1.5}>
            {outstandingOrders.slice(0, 8).map(({ order, totalAmount, paidAmount, outstandingAmount }) => (
              <Paper key={order._id} sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} justifyContent="space-between">
                  <Box>
                    <Typography fontWeight={700}>{order.orderNumber}</Typography>
                    <Typography color="text.secondary">
                      {order.patient.firstName} {order.patient.lastName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                      Total {formatMoney(totalAmount)} · Paid {formatMoney(paidAmount)} · Balance {formatMoney(outstandingAmount)}
                    </Typography>
                  </Box>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                    <Button onClick={() => openMavianceDialog(order)}>Maviance</Button>
                    <Button onClick={() => openPaymentDialog(order)}>Record payment</Button>
                    <Button component={RouterLink} to={`/orders/${order._id}`}>
                      Open order
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <EmptyState title="No outstanding clearance" body="Orders that still need payment attention will appear here." />
        )}
      </SectionCard>
      <SectionCard title="Transactions">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Order</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell>Method</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Confirmed with patient</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summaryState.data.transactions.map((payment) => (
                <TableRow key={payment._id}>
                  <TableCell>{formatDateTime(payment.createdAt)}</TableCell>
                  <TableCell>{payment.order.orderNumber}</TableCell>
                  <TableCell>{payment.order.patient.firstName} {payment.order.patient.lastName}</TableCell>
                  <TableCell>{payment.amountDisplay}</TableCell>
                  <TableCell>{paymentMethodLabel(payment.method)}</TableCell>
                  <TableCell>{payment.status}</TableCell>
                  <TableCell>{payment.confirmedWithPatientAt ? 'Yes' : 'No'}</TableCell>
                  <TableCell>
                    {!payment.confirmedWithPatientAt ? (
                      <Button
                        size="small"
                        disabled={actionLock.isPending(`confirm-${payment._id}`)}
                        onClick={async () => {
                          await actionLock.runLocked(`confirm-${payment._id}`, async () => {
                            try {
                              await api.post(`/orders/${payment.orderId}/confirm-payment-with-patient`)
                              setFeedback({ kind: 'success', message: `Confirmed payment with patient for ${payment.order.orderNumber}.` })
                              summaryState.refresh()
                            } catch (confirmError) {
                              setFeedback({ kind: 'error', message: errorMessage(confirmError) })
                            }
                          })
                        }}
                      >
                        Confirm with patient
                      </Button>
                    ) : null}
                    <Button
                      size="small"
                      onClick={() => {
                        void downloadPdfDocument(`receipt-${payment.order.orderNumber}.pdf`, 'Payment Receipt', [], {
                          metadata: [
                            { label: 'Order number', value: payment.order.orderNumber },
                            { label: 'Receipt date', value: formatDate(payment.createdAt) },
                          ],
                          sections: [
                            {
                              heading: 'Patient',
                              lines: [`${payment.order.patient.firstName} ${payment.order.patient.lastName}`],
                            },
                            {
                              heading: 'Payment',
                              lines: [
                                `Amount: ${payment.amountDisplay}`,
                                `Method: ${paymentMethodLabel(payment.method)}`,
                                `Status: ${payment.status}`,
                                `Confirmed with patient: ${payment.confirmedWithPatientAt ? 'Yes' : 'No'}`,
                                ...(payment.gatewayReference ? [`Reference: ${payment.gatewayReference}`] : []),
                              ],
                            },
                          ],
                        })
                      }}
                    >
                      Receipt
                    </Button>
                    <Button size="small" component={RouterLink} to={`/orders/${payment.orderId}`}>
                      Open order
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Process payment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Order</InputLabel>
              <Select
                label="Order"
                value={paymentForm.orderId}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, orderId: String(event.target.value) }))}
              >
                {ordersState.data.data.map((order) => (
                  <MenuItem key={order._id} value={order._id}>
                    {order.orderNumber} - {order.patient.firstName} {order.patient.lastName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedOrder ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography fontWeight={700}>{selectedOrder.orderNumber}</Typography>
                <Typography color="text.secondary">
                  {selectedOrder.patient.firstName} {selectedOrder.patient.lastName}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Total {formatMoney(selectedOrderTotal)} · Paid {formatMoney(selectedOrderPaid)} · Balance {formatMoney(selectedOrderBalance)}
                </Typography>
              </Paper>
            ) : null}
            <TextField
              label="Amount"
              type="number"
              fullWidth
              value={paymentForm.amount}
              onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: Number(event.target.value) }))}
            />
            <FormControl fullWidth>
              <InputLabel>Method</InputLabel>
              <Select
                label="Method"
                value={paymentForm.method}
                onChange={(event) => setPaymentForm((prev) => ({
                  ...prev,
                  method: String(event.target.value) as 'cash' | 'card' | 'mobile_money' | 'bank_transfer',
                }))}
              >
                {manualPaymentMethods.map((method) => (
                  <MenuItem key={method.value} value={method.value}>
                    {method.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={paymentForm.status}
                onChange={(event) => setPaymentForm((prev) => ({
                  ...prev,
                  status: String(event.target.value) as 'pending' | 'completed' | 'failed',
                }))}
              >
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button disabled={submitting || !paymentForm.orderId || paymentForm.amount <= 0} variant="contained" onClick={submitPayment}>
            Save payment
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={mavianceDialogOpen} onClose={() => setMavianceDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Start Maviance collection</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Order</InputLabel>
              <Select
                label="Order"
                value={mavianceForm.orderId}
                onChange={(event) => {
                  const nextOrderId = String(event.target.value)
                  const nextOrder = ordersState.data.data.find((order) => order._id === nextOrderId)
                  const targetOutstanding = outstandingOrders.find((entry) => entry.order._id === nextOrderId)
                  setMavianceForm((prev) => ({
                    ...prev,
                    orderId: nextOrderId,
                    amount: targetOutstanding?.outstandingAmount ?? prev.amount,
                    customerPhone: nextOrder?.patient.phone ?? prev.customerPhone,
                    customerEmail: nextOrder?.patient.email ?? prev.customerEmail,
                    customerName: nextOrder ? `${nextOrder.patient.firstName} ${nextOrder.patient.lastName}` : prev.customerName,
                    customerAddress: nextOrder?.patient.address ?? prev.customerAddress,
                    tag: nextOrder?.orderNumber ?? prev.tag,
                  }))
                }}
              >
                {ordersState.data.data.map((order) => (
                  <MenuItem key={order._id} value={order._id}>
                    {order.orderNumber} - {order.patient.firstName} {order.patient.lastName}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedMavianceOrder ? (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography fontWeight={700}>{selectedMavianceOrder.orderNumber}</Typography>
                <Typography color="text.secondary">
                  {selectedMavianceOrder.patient.firstName} {selectedMavianceOrder.patient.lastName}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  Outstanding amount defaults to the current balance, but you can adjust it if needed.
                </Typography>
              </Paper>
            ) : null}
            <FormControl fullWidth>
              <InputLabel>Wallet</InputLabel>
              <Select
                label="Wallet"
                value={mavianceForm.channel}
                onChange={(event) => setMavianceForm((prev) => ({
                  ...prev,
                  channel: String(event.target.value) as 'mtn_cameroon' | 'orange_cameroon',
                }))}
              >
                {mavianceChannels.map((channel) => (
                  <MenuItem key={channel.value} value={channel.value}>
                    {channel.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Amount (XAF)"
              type="number"
              fullWidth
              value={mavianceForm.amount}
              onChange={(event) => setMavianceForm((prev) => ({ ...prev, amount: Number(event.target.value) }))}
            />
            <TextField
              label="Customer phone"
              fullWidth
              value={mavianceForm.customerPhone}
              onChange={(event) => setMavianceForm((prev) => ({ ...prev, customerPhone: event.target.value }))}
            />
            <TextField
              label="Customer email"
              fullWidth
              value={mavianceForm.customerEmail}
              onChange={(event) => setMavianceForm((prev) => ({ ...prev, customerEmail: event.target.value }))}
            />
            <TextField
              label="Customer name"
              fullWidth
              value={mavianceForm.customerName}
              onChange={(event) => setMavianceForm((prev) => ({ ...prev, customerName: event.target.value }))}
            />
            <TextField
              label="Customer address"
              fullWidth
              value={mavianceForm.customerAddress}
              onChange={(event) => setMavianceForm((prev) => ({ ...prev, customerAddress: event.target.value }))}
            />
            <TextField
              label="Tag"
              helperText="Usually the order number for reconciliation."
              fullWidth
              value={mavianceForm.tag}
              onChange={(event) => setMavianceForm((prev) => ({ ...prev, tag: event.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMavianceDialogOpen(false)}>Cancel</Button>
          <Button
            disabled={
              mavianceSubmitting
              || !mavianceForm.orderId
              || mavianceForm.amount <= 0
              || !mavianceForm.customerPhone
              || !mavianceForm.customerEmail
            }
            variant="contained"
            onClick={submitMaviance}
          >
            Send wallet prompt
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function AccountingPage() {
  const configState = useLoadable<ZohoBooksConfig | null>(null, [], async () => {
    const response = await api.get<ZohoBooksConfig>('/accounting/zoho/config')
    return response.data
  })
  const logsState = useLoadable<ZohoBooksSyncLog[]>([], [], async () => {
    const response = await api.get<ZohoBooksSyncLog[]>('/accounting/zoho/sync-logs')
    return response.data
  })
  const doctorsState = useLoadable<Doctor[]>([], [], async () => {
    const response = await api.get<Doctor[]>('/doctors')
    return response.data
  })
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders', { params: { limit: 100 } })
    return response.data
  })
  const financeSummaryState = useLoadable<FinanceSummary | null>(null, [], async () => {
    const response = await api.get<FinanceSummary>('/finance/summary')
    return response.data
  })
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [grantToken, setGrantToken] = useState('')
  const [organizations, setOrganizations] = useState<ZohoBooksOrganization[]>([])
  const [organizationError, setOrganizationError] = useState<string | null>(null)
  const [syncSelection, setSyncSelection] = useState({
    doctorId: '',
    orderId: '',
    paymentId: '',
  })

  const refresh = () => {
    configState.refresh()
    logsState.refresh()
    doctorsState.refresh()
    ordersState.refresh()
    financeSummaryState.refresh()
  }

  const openAuthorizeUrl = async () => {
    setFeedback(null)
    try {
      const response = await api.get<{ authorizeUrl: string }>('/accounting/zoho/authorize-url')
      window.open(response.data.authorizeUrl, '_blank', 'noopener,noreferrer')
      setFeedback({ kind: 'success', message: 'Opened the Zoho Books consent screen in a new tab.' })
    } catch (authorizeError) {
      setFeedback({ kind: 'error', message: errorMessage(authorizeError) })
    }
  }

  const exchangeGrantToken = async () => {
    if (!grantToken.trim()) return
    try {
      const response = await api.post<{ message: string; refreshToken: string | null }>('/accounting/zoho/exchange-token', {
        grantToken: grantToken.trim(),
      })
      setGrantToken('')
      refresh()
      setFeedback({
        kind: 'success',
        message: response.data.refreshToken
          ? 'Grant token exchanged. Copy the returned refresh token into backend/.env as ZOHO_BOOKS_REFRESH_TOKEN and restart the backend.'
          : response.data.message,
      })
    } catch (exchangeError) {
      setFeedback({ kind: 'error', message: errorMessage(exchangeError) })
    }
  }

  const loadOrganizations = async () => {
    setOrganizationError(null)
    try {
      const response = await api.get<ZohoBooksOrganization[]>('/accounting/zoho/organizations')
      setOrganizations(response.data)
      setFeedback({ kind: 'success', message: 'Zoho organizations loaded.' })
    } catch (organizationLoadError) {
      setOrganizationError(errorMessage(organizationLoadError))
    }
  }

  const runDoctorSync = async () => {
    if (!syncSelection.doctorId) return
    try {
      await api.post(`/accounting/zoho/sync/doctor/${syncSelection.doctorId}`)
      setFeedback({ kind: 'success', message: 'Referral doctor synced to Zoho Books contacts.' })
      logsState.refresh()
    } catch (syncError) {
      setFeedback({ kind: 'error', message: errorMessage(syncError) })
    }
  }

  const runOrderSync = async () => {
    if (!syncSelection.orderId) return
    try {
      await api.post('/accounting/zoho/sync/order', { orderId: syncSelection.orderId })
      setFeedback({ kind: 'success', message: 'Order invoice synced to Zoho Books.' })
      refresh()
    } catch (syncError) {
      setFeedback({ kind: 'error', message: errorMessage(syncError) })
    }
  }

  const runPaymentSync = async () => {
    if (!syncSelection.paymentId) return
    try {
      await api.post('/accounting/zoho/sync/payment', { paymentId: syncSelection.paymentId })
      setFeedback({ kind: 'success', message: 'Payment synced to Zoho Books.' })
      refresh()
    } catch (syncError) {
      setFeedback({ kind: 'error', message: errorMessage(syncError) })
    }
  }

  if (
    configState.loading
    || logsState.loading
    || doctorsState.loading
    || ordersState.loading
    || financeSummaryState.loading
  ) {
    return <LoadingPanel label="Loading Zoho Books…" />
  }

  const syncedInvoices = ordersState.data.data.filter((order) => order.financialClearance === 'cleared').length
  const successfulInvoiceLogs = logsState.data.filter((entry) => entry.operation === 'sync_invoice' && entry.status === 'success').length
  const successfulPaymentLogs = logsState.data.filter((entry) => entry.operation === 'sync_payment' && entry.status === 'success').length
  const failedLogs = logsState.data.filter((entry) => entry.status === 'failed').length
  const paymentOptions = financeSummaryState.data?.transactions.filter((entry) => entry.status === 'completed') ?? []

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Accounting"
        title="Zoho Books integration workspace"
        description="The LIMS no longer runs a separate internal ledger. Orders, invoices, payments, and referral contacts are prepared here for Zoho Books via OAuth, organization mapping, and sync logs."
        action={<Button onClick={refresh}>Refresh</Button>}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      {configState.error ? <Alert severity="error">{configState.error}</Alert> : null}
      {logsState.error ? <Alert severity="error">{logsState.error}</Alert> : null}
      {doctorsState.error ? <Alert severity="error">{doctorsState.error}</Alert> : null}
      {ordersState.error ? <Alert severity="error">{ordersState.error}</Alert> : null}
      {financeSummaryState.error ? <Alert severity="error">{financeSummaryState.error}</Alert> : null}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
        <MetricCard label="OAuth ready" value={configState.data?.clientConfigured && configState.data?.redirectConfigured ? 'Yes' : 'No'} helper={configState.data?.organizationConfigured ? 'Organization set' : 'Set organization'} />
        <MetricCard label="Invoice syncs" value={String(successfulInvoiceLogs)} helper={`${syncedInvoices} financially cleared orders`} />
        <MetricCard label="Payment syncs" value={String(successfulPaymentLogs)} helper={`${failedLogs} failed sync attempts`} />
      </Box>

      <SectionCard title="OAuth and organization setup" description="Zoho Books uses the server-side OAuth flow. Generate consent, exchange the one-time grant token, then place the refresh token into backend/.env for long-lived syncs.">
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
            <MetricCard label="Client" value={configState.data?.clientConfigured ? 'Configured' : 'Missing'} />
            <MetricCard label="Redirect URI" value={configState.data?.redirectConfigured ? 'Configured' : 'Missing'} />
            <MetricCard label="Refresh token" value={configState.data?.refreshTokenConfigured ? 'Configured' : 'Missing'} />
            <MetricCard label="Organization" value={configState.data?.organizationConfigured ? (configState.data.organizationId ?? 'Configured') : 'Missing'} />
          </Box>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
            <Button variant="contained" onClick={openAuthorizeUrl}>Open Zoho consent screen</Button>
            <Button onClick={loadOrganizations}>Load organizations</Button>
          </Box>
          {organizationError ? <Alert severity="error">{organizationError}</Alert> : null}
          {organizations.length ? (
            <Stack spacing={1}>
              {organizations.map((organization) => (
                <Paper key={organization.organization_id} variant="outlined" sx={{ p: 2 }}>
                  <Typography fontWeight={700}>{organization.name}</Typography>
                  <Typography color="text.secondary">
                    {organization.organization_id}
                    {organization.country ? ` · ${organization.country}` : ''}
                    {organization.currency_code ? ` · ${organization.currency_code}` : ''}
                  </Typography>
                </Paper>
              ))}
            </Stack>
          ) : null}
          <TextField
            label="Grant token from Zoho consent redirect"
            value={grantToken}
            onChange={(event) => setGrantToken(event.target.value)}
            helperText="Exchange once, then save the returned refresh token into backend/.env as ZOHO_BOOKS_REFRESH_TOKEN."
          />
          <Button variant="outlined" disabled={!grantToken.trim()} onClick={exchangeGrantToken}>
            Exchange grant token
          </Button>
        </Stack>
      </SectionCard>

      <SectionCard title="Manual sync actions" description="Use these controls while onboarding Zoho Books or reconciling edge cases. Orders sync invoices, payments sync customer payments, and referral doctors sync as Zoho contacts.">
        <Stack spacing={2}>
          <FormControl fullWidth>
            <InputLabel>Referral doctor</InputLabel>
            <Select
              label="Referral doctor"
              value={syncSelection.doctorId}
              onChange={(event) => setSyncSelection((prev) => ({ ...prev, doctorId: String(event.target.value) }))}
            >
              <MenuItem value="">Select doctor</MenuItem>
              {doctorsState.data.map((doctor) => (
                <MenuItem key={doctor._id} value={doctor._id}>
                  {doctor.name} · {doctor.email}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button disabled={!syncSelection.doctorId} onClick={runDoctorSync}>Sync doctor contact</Button>

          <FormControl fullWidth>
            <InputLabel>Order invoice</InputLabel>
            <Select
              label="Order invoice"
              value={syncSelection.orderId}
              onChange={(event) => setSyncSelection((prev) => ({ ...prev, orderId: String(event.target.value) }))}
            >
              <MenuItem value="">Select order</MenuItem>
              {ordersState.data.data.map((order) => (
                <MenuItem key={order._id} value={order._id}>
                  {order.orderNumber} · {order.patient.firstName} {order.patient.lastName}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button disabled={!syncSelection.orderId} onClick={runOrderSync}>Sync invoice to Zoho</Button>

          <FormControl fullWidth>
            <InputLabel>Completed payment</InputLabel>
            <Select
              label="Completed payment"
              value={syncSelection.paymentId}
              onChange={(event) => setSyncSelection((prev) => ({ ...prev, paymentId: String(event.target.value) }))}
            >
              <MenuItem value="">Select payment</MenuItem>
              {paymentOptions.map((payment) => (
                <MenuItem key={payment._id} value={payment._id}>
                  {payment.order.orderNumber} · {formatMoney(payment.amount)} · {paymentMethodLabel(payment.method)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button disabled={!syncSelection.paymentId} onClick={runPaymentSync}>Sync payment to Zoho</Button>
        </Stack>
      </SectionCard>

      <SectionCard title="Zoho sync log" description="Every OAuth, contact, invoice, and payment action is tracked here for support and production validation.">
        <TableContainer sx={{ maxHeight: 520 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Operation</TableCell>
                <TableCell>Entity</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Endpoint</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logsState.data.map((entry) => (
                <TableRow key={entry._id}>
                  <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                  <TableCell>{entry.operation}</TableCell>
                  <TableCell>{entry.entityType}{entry.orderId ? ` · ${entry.orderId}` : ''}</TableCell>
                  <TableCell>
                    <Chip size="small" label={entry.status} color={entry.status === 'success' ? 'success' : entry.status === 'failed' ? 'error' : 'warning'} />
                  </TableCell>
                  <TableCell>{entry.endpoint}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {!logsState.data.length ? (
          <EmptyState title="No Zoho sync activity yet" body="Generate an authorization URL or sync a doctor, order, or payment to populate this log." />
        ) : null}
      </SectionCard>
    </Stack>
  )
}

export function CourierPage() {
  const actionLock = useActionLock()
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [pickupDialog, setPickupDialog] = useState<{
    orderId: string
    paymentCollectionStatus: 'unpaid' | 'cash_with_courier' | 'paid_online'
    paymentCollectionMethod: 'cash' | 'mtn_mobile_money' | 'orange_money' | 'card' | 'transfer' | 'other'
    paymentCollectionAmount: number
    paymentCollectionReference: string
    temperatureCelsius: number | ''
  } | null>(null)

  const queue = ordersState.data.data.filter((order) => order.courierStatus)
  const pickupRequests = queue.filter((order) => order.courierStatus === 'ready_for_pickup')
  const checkInEligible = ordersState.data.data.filter((order) => !order.courierStatus && ['received', 'in_progress'].includes(order.status))

  const nextCourierStatus = (order: HydratedOrder) =>
    order.courierStatus === 'ready_for_pickup'
      ? 'on_way_to_pickup'
      : order.courierStatus === 'on_way_to_pickup'
        ? 'at_site_for_pickup'
        : order.courierStatus === 'at_site_for_pickup'
          ? 'picked_up_on_way_to_lab'
        : order.courierStatus === 'picked_up_on_way_to_lab'
          ? 'in_transit'
          : 'received_at_lab'

  const collectGeo = async () => {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      return {}
    }
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 30000,
        })
      })
      return {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }
    } catch {
      return {}
    }
  }

  const submitCourierAdvance = async (order: HydratedOrder, extras: Record<string, unknown> = {}) => {
    const next = nextCourierStatus(order)
    await actionLock.runLocked(`courier-${order._id}-${next}`, async () => {
      try {
        const geo = await collectGeo()
        await api.post(`/orders/${order._id}/courier-status`, { courierStatus: next, ...geo, ...extras })
        setFeedback({ kind: 'success', message: `${order.orderNumber} advanced to the next courier step.` })
        ordersState.refresh()
      } catch (advanceError) {
        setFeedback({ kind: 'error', message: errorMessage(advanceError) })
      }
    })
  }

  const advanceStatus = async (order: HydratedOrder) => {
    if (order.courierStatus === 'at_site_for_pickup') {
      setPickupDialog({
        orderId: order._id,
        paymentCollectionStatus: order.paymentCollectionStatus === 'paid_online' ? 'paid_online' : 'unpaid',
        paymentCollectionMethod:
          order.paymentCollectionMethod === 'cash'
            ? 'cash'
            : order.paymentCollectionMethod === 'mtn_mobile_money'
              ? 'mtn_mobile_money'
              : order.paymentCollectionMethod === 'orange_money'
                ? 'orange_money'
                : order.paymentCollectionMethod === 'card'
                  ? 'card'
                  : order.paymentCollectionMethod === 'transfer'
                    ? 'transfer'
                    : 'other',
        paymentCollectionAmount: order.paymentCollectionAmount ?? 0,
        paymentCollectionReference: order.paymentCollectionReference ?? '',
        temperatureCelsius: '',
      })
      return
    }
    await submitCourierAdvance(order)
  }

  const nextActionLabel = (order: HydratedOrder) => {
    switch (order.courierStatus) {
      case 'ready_for_pickup':
        return 'Dispatch courier'
      case 'on_way_to_pickup':
        return 'Arrived at pickup'
      case 'at_site_for_pickup':
        return 'Confirm pickup'
      case 'picked_up_on_way_to_lab':
        return 'Mark in transit'
      case 'in_transit':
        return 'Receive at lab'
      default:
        return 'Advance status'
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Courier"
        description="Online orders enter the pickup queue automatically. Progress them through pickup scheduling, arrival at site, sample pickup, transit, and receipt at the lab."
        action={<Button onClick={() => ordersState.refresh()}>Refresh queue</Button>}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <SectionCard title="Pickup requests">
        {pickupRequests.length ? (
          <Stack spacing={2}>
            {pickupRequests.map((order) => (
              <Paper key={order._id} sx={{ p: 2 }}>
                <Typography variant="h6">{order.orderNumber}</Typography>
                <Typography>{order.patient.firstName} {order.patient.lastName}</Typography>
                <Typography color="text.secondary">{order.patient.phone}</Typography>
                <Typography color="text.secondary">Pickup: {order.pickupPlaceName ?? order.pickupAddress ?? order.patient.address}</Typography>
                <Stack direction="row" spacing={1.5} sx={{ mt: 2 }}>
                  <CourierChip status={order.courierStatus} />
                  <Button
                    variant="contained"
                    disabled={actionLock.isPending(`courier-${order._id}-${nextCourierStatus(order)}`)}
                    onClick={() => advanceStatus(order)}
                  >
                    {nextActionLabel(order)}
                  </Button>
                  <Button component={RouterLink} to={`/orders/${order._id}`}>
                    Open order
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <EmptyState title="No pickup requests right now." body="New online orders will appear here." />
        )}
      </SectionCard>
      <SectionCard title="Check in orders for courier pickup (optional)">
        {checkInEligible.length ? (
          <Stack spacing={2}>
            {checkInEligible.map((order) => (
              <Paper key={order._id} sx={{ p: 2 }}>
                <Typography>{order.orderNumber} — {order.patient.firstName} {order.patient.lastName}</Typography>
                <Button
                  sx={{ mt: 1 }}
                  onClick={async () => {
                    await actionLock.runLocked(`checkin-${order._id}`, async () => {
                      try {
                        await api.post(`/orders/${order._id}/check-in-courier`)
                        setFeedback({ kind: 'success', message: `${order.orderNumber} moved into the courier queue.` })
                        ordersState.refresh()
                      } catch (checkInError) {
                        setFeedback({ kind: 'error', message: errorMessage(checkInError) })
                      }
                    })
                  }}
                  disabled={actionLock.isPending(`checkin-${order._id}`)}
                >
                  Add to courier queue
                </Button>
              </Paper>
            ))}
          </Stack>
        ) : (
          <EmptyState title="No orders available to check in." body='Orders with status "Received" or "In progress" (and not yet in courier flow) appear here.' />
        )}
      </SectionCard>
      <SectionCard title="Courier queue — track all pickups and deliveries">
        {queue.length ? (
          <Stack spacing={2}>
            {queue.map((order) => (
              <Paper key={order._id} sx={{ p: 2 }}>
                <Typography variant="h6">{order.orderNumber}</Typography>
                <Typography>{order.patient.firstName} {order.patient.lastName}</Typography>
                <Typography color="text.secondary">{order.patient.phone}</Typography>
                <Typography color="text.secondary">Pickup: {order.pickupPlaceName ?? order.pickupAddress ?? order.patient.address}</Typography>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2, flexWrap: 'wrap' }}>
                  <CourierChip status={order.courierStatus} />
                  {order.courierStatus !== 'received_at_lab' ? (
                    <Button
                      disabled={actionLock.isPending(`courier-${order._id}-${nextCourierStatus(order)}`)}
                      onClick={() => advanceStatus(order)}
                    >
                      {nextActionLabel(order)}
                    </Button>
                  ) : null}
                  <Button component={RouterLink} to={`/orders/${order._id}`}>
                    Open order
                  </Button>
                  <Typography variant="body2" color="text.secondary">
                    Sample QR — scan for chain of custody
                  </Typography>
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <EmptyState title="No active courier jobs." body="Orders that have entered the courier lifecycle will appear here." />
        )}
      </SectionCard>
      <Dialog open={!!pickupDialog} onClose={() => setPickupDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm sample pickup</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Payment status at pickup</InputLabel>
              <Select
                label="Payment status at pickup"
                value={pickupDialog?.paymentCollectionStatus ?? 'unpaid'}
                onChange={(event) =>
                  setPickupDialog((prev) =>
                    prev
                      ? {
                          ...prev,
                          paymentCollectionStatus: String(event.target.value) as 'unpaid' | 'cash_with_courier' | 'paid_online',
                        }
                      : null,
                  )
                }
              >
                <MenuItem value="unpaid">Not paid</MenuItem>
                <MenuItem value="cash_with_courier">Cash handed to courier</MenuItem>
                <MenuItem value="paid_online">Paid online already</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Payment method</InputLabel>
              <Select
                label="Payment method"
                value={pickupDialog?.paymentCollectionMethod ?? 'cash'}
                onChange={(event) =>
                  setPickupDialog((prev) =>
                    prev
                      ? {
                          ...prev,
                          paymentCollectionMethod: String(event.target.value) as 'cash' | 'mtn_mobile_money' | 'orange_money' | 'card' | 'transfer' | 'other',
                        }
                      : null,
                  )
                }
              >
                <MenuItem value="cash">Cash</MenuItem>
                <MenuItem value="mtn_mobile_money">MTN Mobile Money</MenuItem>
                <MenuItem value="orange_money">Orange Money</MenuItem>
                <MenuItem value="card">Card</MenuItem>
                <MenuItem value="transfer">Transfer</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Amount collected"
              type="number"
              value={pickupDialog?.paymentCollectionAmount ?? 0}
              onChange={(event) =>
                setPickupDialog((prev) => (prev ? { ...prev, paymentCollectionAmount: Number(event.target.value) } : null))
              }
            />
            <TextField
              label="Payment reference"
              value={pickupDialog?.paymentCollectionReference ?? ''}
              onChange={(event) =>
                setPickupDialog((prev) => (prev ? { ...prev, paymentCollectionReference: event.target.value } : null))
              }
            />
            <TextField
              label="Transport temperature (°C)"
              type="number"
              value={pickupDialog?.temperatureCelsius ?? ''}
              onChange={(event) =>
                setPickupDialog((prev) =>
                  prev
                    ? {
                        ...prev,
                        temperatureCelsius: event.target.value === '' ? '' : Number(event.target.value),
                      }
                    : null,
                )
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickupDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!pickupDialog || actionLock.isPending(`courier-${pickupDialog.orderId}-picked_up_on_way_to_lab`)}
            onClick={async () => {
              if (!pickupDialog) return
              const order = queue.find((entry) => entry._id === pickupDialog.orderId)
              if (!order) return
              await submitCourierAdvance(order, {
                paymentCollectionStatus: pickupDialog.paymentCollectionStatus,
                paymentCollectionMethod: pickupDialog.paymentCollectionMethod,
                paymentCollectionAmount: pickupDialog.paymentCollectionAmount,
                paymentCollectionReference: pickupDialog.paymentCollectionReference,
                temperatureCelsius: pickupDialog.temperatureCelsius === '' ? undefined : pickupDialog.temperatureCelsius,
              })
              setPickupDialog(null)
            }}
          >
            Confirm pickup
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function ReportsPage() {
  const actionLock = useActionLock()
  const reportsState = useLoadable<Array<{ order: HydratedOrder; report: Report }>>([], [], async () => {
    const response = await api.get('/reports')
    return response.data
  })

  return (
    <Stack spacing={3}>
      <PageHeader title="Reports" description="Download a PDF report to give to the patient or send to them." />
      <SectionCard>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Order #</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Report PDF</TableCell>
                <TableCell>Email to client</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportsState.data.map((item) => (
                <TableRow key={item.order._id}>
                  <TableCell>{item.order.orderNumber}</TableCell>
                  <TableCell>{item.order.patient.firstName} {item.order.patient.lastName}</TableCell>
                  <TableCell>{item.order.status}</TableCell>
                  <TableCell>{formatDate(item.order.createdAt)}</TableCell>
                  <TableCell>
                    <Button
                      startIcon={<DownloadRoundedIcon />}
                      onClick={() => {
                        void downloadPathologyReportPdf(`report-${item.order.orderNumber}.pdf`, {
                          ...item.order,
                          report: item.report,
                        })
                      }}
                    >
                      Download PDF
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button
                      startIcon={<EmailRoundedIcon />}
                      disabled={actionLock.isPending(`email-${item.order._id}`)}
                      onClick={async () => {
                        await actionLock.runLocked(`email-${item.order._id}`, async () => {
                          await api.post(`/reports/${item.order._id}/email`)
                          reportsState.refresh()
                        })
                      }}
                    >
                      Email to client
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Stack>
  )
}

export function InventoryPage() {
  const samplesState = useLoadable<{ data: Sample[] }>({ data: [] }, [], async () => {
    const response = await api.get('/samples')
    return response.data
  })

  return (
    <Stack spacing={3}>
      <PageHeader title="Inventory" action={<Button startIcon={<SyncRoundedIcon />} onClick={async () => { await api.post('/accessions/backfill-samples'); samplesState.refresh() }}>Sync from accessions</Button>} />
      <SectionCard description='Specimens received in the lab (accessioned) appear here. If the table is empty but you have received orders, click "Sync from accessions" once to populate it.'>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Label</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Order</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {samplesState.data.data.map((sample) => (
                <TableRow key={sample._id}>
                  <TableCell>{sample.label}</TableCell>
                  <TableCell>{sample.type}</TableCell>
                  <TableCell>{sample.status}</TableCell>
                  <TableCell>{sample.order?.orderNumber ?? '—'}</TableCell>
                  <TableCell>
                    <Button component={RouterLink} to={`/inventory/sample/${sample._id}`}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Stack>
  )
}

export function SampleDetailPage() {
  const { sampleId = '' } = useParams()
  const sampleState = useLoadable<any>(null, [sampleId], async () => {
    const response = await api.get(`/samples/${sampleId}`)
    return response.data
  })
  if (sampleState.loading) return <LoadingPanel label="Loading sample…" />
  if (sampleState.error || !sampleState.data) return <PageError message={sampleState.error ?? 'Sample not found'} />
  return (
    <Stack spacing={3}>
      <PageHeader title={`Sample ${sampleState.data.label}`} action={<Button component={RouterLink} to="/inventory">Back to inventory</Button>} />
      <SectionCard>
        <Typography>Type: {sampleState.data.type}</Typography>
        <Typography sx={{ mt: 1 }}>Status: {sampleState.data.status}</Typography>
        <Typography sx={{ mt: 1 }}>Location: {sampleState.data.location ?? '—'}</Typography>
        <Typography sx={{ mt: 1 }}>Received: {formatDateTime(sampleState.data.receivedAt)}</Typography>
      </SectionCard>
    </Stack>
  )
}

export function NotificationsPage() {
  const notificationsState = useLoadable<NotificationEntry[]>([], [], async () => {
    const response = await api.get<NotificationEntry[]>('/notifications')
    return response.data
  })
  return (
    <Stack spacing={3}>
      <PageHeader title="Notifications" />
      <Stack spacing={2}>
        {notificationsState.data.map((item) => (
          <Paper key={item._id} sx={{ p: 3 }}>
            <Typography variant="h6">{item.title}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>{item.body}</Typography>
            {!item.read ? (
              <Button sx={{ mt: 2 }} onClick={async () => { await api.post(`/notifications/${item._id}/read`); notificationsState.refresh() }}>
                Mark read
              </Button>
            ) : null}
          </Paper>
        ))}
      </Stack>
    </Stack>
  )
}

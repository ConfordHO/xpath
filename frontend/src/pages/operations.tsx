import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'

import EmailRoundedIcon from '@mui/icons-material/EmailRounded'

import SyncRoundedIcon from '@mui/icons-material/SyncRounded'

import {
  Alert,
  Box,
  Button,
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

import { Link as RouterLink, useParams } from 'react-router-dom'

import { api } from '../api'

import {
  CourierChip,
  EChartPanel,
  EmptyState,
  LoadingPanel,
  MetricCard,
  PageHeader,
  SectionCard,
} from '../components'

import { chartColors, errorMessage, PageError, useActionLock, useLoadable } from './shared'

import type {
  FinanceSummary,
  FinanceMonthlyTrendPoint,
  HydratedOrder,
  MavianceGatewayConfig,
  MavianceTransaction,
  NotificationEntry,
  Report,
  Sample,
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

function buildPaymentsMethodOption(summary: FinanceSummary) {
  const entries = Object.entries(summary.paymentsByMethod)
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
        data: entries,
      },
    ],
  }
}

function buildMonthlyRevenueOption(points: FinanceMonthlyTrendPoint[]) {
  return {
    tooltip: { trigger: 'axis' as const },
    legend: { bottom: 0 },
    xAxis: {
      type: 'category' as const,
      data: points.map((item) => item.label),
    },
    yAxis: { type: 'value' as const },
    series: [
      {
        name: 'Revenue',
        type: 'bar' as const,
        itemStyle: { color: chartColors[0] },
        data: points.map((item) => item.totalRevenue),
      },
      {
        name: 'Transactions',
        type: 'line' as const,
        smooth: true,
        itemStyle: { color: chartColors[1] },
        data: points.map((item) => item.transactionCount),
      },
    ],
  }
}

export function FinancePage() {
  const actionLock = useActionLock()
  const summaryState = useLoadable<FinanceSummary | null>(null, [], async () => {
    const response = await api.get<FinanceSummary>('/finance/summary')
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
  const monthlyTrendState = useLoadable<FinanceMonthlyTrendPoint[]>([], [], async () => {
    const response = await api.get<FinanceMonthlyTrendPoint[]>('/finance/monthly-trends', {
      params: { months: 12 },
    })
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

  if (summaryState.loading || ordersState.loading || monthlyTrendState.loading) return <LoadingPanel label="Loading finance…" />
  if (summaryState.error || !summaryState.data) return <PageError message={summaryState.error ?? 'Could not load finance'} />
  const paymentMethodOption = buildPaymentsMethodOption(summaryState.data)
  const monthlyRevenueOption = buildMonthlyRevenueOption(monthlyTrendState.data)
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
    ordersState.refresh()
    mavianceConfigState.refresh()
    mavianceTransactionsState.refresh()
    monthlyTrendState.refresh()
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
        <SectionCard title="Recent Maviance collections" description="Track MTN and Orange payment prompts, then verify pending ones." scrollable maxBodyHeight={360}>
          {mavianceTransactionsState.error ? <Alert severity="error">{mavianceTransactionsState.error}</Alert> : null}
          {mavianceTransactionsState.data.length ? (
            <Stack spacing={1.5}>
              {mavianceTransactionsState.data.slice(0, 10).map((transaction) => (
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
        <EChartPanel title="Payments by method" option={paymentMethodOption} />
        <EChartPanel
          title="Monthly revenue"
          description="Month by month totals and transaction volume."
          option={monthlyRevenueOption}
        />
      </Box>
      <SectionCard title="Outstanding clearance queue" description="Orders remain here until they are financially cleared or fully paid." scrollable maxBodyHeight={420}>
        {outstandingOrders.length ? (
          <Stack spacing={1.5}>
            {outstandingOrders.slice(0, 10).map(({ order, totalAmount, paidAmount, outstandingAmount }) => (
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
        <TableContainer sx={{ maxHeight: 460 }}>
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
              {summaryState.data.transactions.slice(0, 10).map((payment) => (
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

export function CourierPage() {
  const actionLock = useActionLock()
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

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

  const advanceStatus = async (order: HydratedOrder) => {
    const next = nextCourierStatus(order)
    await actionLock.runLocked(`courier-${order._id}-${next}`, async () => {
      try {
        await api.post(`/orders/${order._id}/courier-status`, { courierStatus: next })
        setFeedback({ kind: 'success', message: `${order.orderNumber} advanced to the next courier step.` })
        ordersState.refresh()
      } catch (advanceError) {
        setFeedback({ kind: 'error', message: errorMessage(advanceError) })
      }
    })
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
      <SectionCard title="Messages" scrollable maxBodyHeight={640}>
        <Stack spacing={2}>
          {notificationsState.data.slice(0, 10).map((item) => (
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
      </SectionCard>
    </Stack>
  )
}

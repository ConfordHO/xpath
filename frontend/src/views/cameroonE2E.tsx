import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded'
import DescriptionRoundedIcon from '@mui/icons-material/DescriptionRounded'
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded'
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded'
import PrintRoundedIcon from '@mui/icons-material/PrintRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  MenuItem,
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
import { useMemo, useState } from 'react'

import { api } from '../api'
import { MetricCard, PageHeader, SectionCard, StatusChip } from '../components'
import type { ArchiveRecord, AuditEvent, HydratedOrder, Invoice, OcrIntakeJob } from '../types'
import { formatDateTime, formatMoney } from '../utils'
import { errorMessage, TablePlaceholder, useActionLock, useLoadable } from './shared'

type Receipt = {
  _id: string
  receiptNumber: string
  orderId: string
  invoiceId: string
  provider: 'maviance' | 'manual'
  amount: number
  currency: string
  status: string
  gatewayReference: string
  createdAt: string
}

type SyncState = {
  status: string
  queuedObjects: number
  lastSuccessAt: string | null
  lastError: string | null
}

type GatewayTransaction = {
  _id: string
  order?: HydratedOrder
  orderNumber?: string
  provider?: 'maviance'
  amount: number
  currency: string
  customerPhone?: string
  ptn?: string | null
  externalTransactionId?: string | null
  gatewayReference?: string
  normalizedStatus?: string
}

function printDocument(title: string, rows: Array<[string, string]>) {
  const popup = window.open('', '_blank', 'width=720,height=760')
  if (!popup) return
  popup.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 28px; color: #111827; }
          h1 { font-size: 22px; margin: 0 0 20px; }
          table { width: 100%; border-collapse: collapse; }
          td { padding: 10px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
          td:first-child { width: 34%; color: #4b5563; font-weight: 700; }
          .brand { font-size: 13px; letter-spacing: .12em; font-weight: 800; color: #0f766e; margin-bottom: 8px; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <div class="brand">X.PATH LIMS CAMEROON</div>
        <h1>${title}</h1>
        <table>
          ${rows.map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`).join('')}
        </table>
        <p><button onclick="window.print()">Print</button></p>
      </body>
    </html>
  `)
  popup.document.close()
}

export function CameroonE2EPage() {
  const actionLock = useActionLock()
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [ocrText, setOcrText] = useState('First Name: Marie\nLast Name: Etoundi\nDOB: 1979-05-10\nPlease run CBC and histology biopsy.')
  const [paymentForm, setPaymentForm] = useState({ orderNumber: '', provider: 'maviance', amount: '6000', channel: 'mtn_cameroon', phone: '+237600000000' })
  const [threadForm, setThreadForm] = useState({ subject: 'Sample handoff clarification', department: 'histology', body: '' })

  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const invoicesState = useLoadable<Invoice[]>([], [], async () => (await api.get('/invoices')).data)
  const receiptsState = useLoadable<Receipt[]>([], [], async () => [])
  const ocrState = useLoadable<OcrIntakeJob[]>([], [], async () => (await api.get('/intake/ocr/jobs')).data)
  const archivesState = useLoadable<ArchiveRecord[]>([], [], async () => (await api.get('/archive-records')).data)
  const auditState = useLoadable<{ hashChainValid: boolean; data: AuditEvent[] }>({ hashChainValid: true, data: [] }, [], async () => (await api.get('/audit/events')).data)
  const syncState = useLoadable<SyncState>({ status: 'idle', queuedObjects: 0, lastSuccessAt: null, lastError: null }, [], async () => {
    const response = await api.get('/dr/dashboard')
    const events = response.data.offlineSync ?? []
    const latest = events[0]
    return {
      status: latest?.status ?? 'idle',
      queuedObjects: events.length,
      lastSuccessAt: latest?.createdAt ?? null,
      lastError: latest?.errorMessage ?? null,
    }
  })
  const gatewayState = useLoadable<GatewayTransaction[]>([], [], async () => (await api.get('/payments/maviance/transactions')).data)

  const refreshAll = () => {
    ordersState.refresh()
    invoicesState.refresh()
    receiptsState.refresh()
    ocrState.refresh()
    archivesState.refresh()
    auditState.refresh()
    syncState.refresh()
    gatewayState.refresh()
  }

  const selectedOrder = useMemo(
    () => ordersState.data.data.find((order) => order.orderNumber === paymentForm.orderNumber) ?? ordersState.data.data[0],
    [ordersState.data.data, paymentForm.orderNumber],
  )

  const run = async (key: string, action: () => Promise<void>) => {
    setFeedback(null)
    await actionLock.runLocked(key, async () => {
      try {
        await action()
        setFeedback({ kind: 'success', message: 'Saved.' })
        refreshAll()
      } catch (error) {
        setFeedback({ kind: 'error', message: errorMessage(error) })
      }
    })
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Cameroon E2E control" description="Payments, OCR, custody, audit, archive, and cloud sync" />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
        <Box>
          <MetricCard label="Orders" value={String(ordersState.data.data.length)} />
        </Box>
        <Box>
          <MetricCard label="Invoices" value={String(invoicesState.data.length)} />
        </Box>
        <Box>
          <MetricCard label="Archives" value={String(archivesState.data.length)} />
        </Box>
        <Box>
          <MetricCard label="Audit chain" value={auditState.data.hashChainValid ? 'Valid' : 'Broken'} />
        </Box>
      </Box>

      <SectionCard title="OCR intake" action={<UploadFileRoundedIcon color="primary" />}>
        <Stack spacing={2}>
          <TextField
            label="Typed or extracted note"
            value={ocrText}
            onChange={(event) => setOcrText(event.target.value)}
            minRows={5}
            multiline
            fullWidth
          />
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <Button
              variant="contained"
              onClick={() => run('ocr-text', async () => {
                await api.post('/intake/ocr/jobs', { extractedText: ocrText, fileText: ocrText, verify: true })
              })}
            >
              Extract and create order
            </Button>
            <Button component="label" variant="outlined">
              Upload note image
              <input
                hidden
                type="file"
                accept="image/*,.txt,.pdf"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  void run('ocr-file', async () => {
                    const formData = new FormData()
                    formData.append('file', file)
                    await api.post('/intake/ocr/jobs', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
                  })
                }}
              />
            </Button>
          </Stack>
          <TablePlaceholder loading={ocrState.loading} />
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Job</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Confidence</TableCell>
                  <TableCell>Extracted tests</TableCell>
                  <TableCell>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ocrState.data.map((job) => {
                  const parsed = typeof job.parsedPayload === 'string' ? JSON.parse(job.parsedPayload) : job.parsedPayload
                  const codes = parsed?.matchedTestCodes?.join(', ') ?? ''
                  return (
                    <TableRow key={job._id}>
                      <TableCell>{job._id}</TableCell>
                      <TableCell><Chip size="small" label={job.status} /></TableCell>
                      <TableCell>{Math.round(job.confidence)}%</TableCell>
                      <TableCell>{codes}</TableCell>
                      <TableCell>
                        <Button size="small" onClick={() => run(`ocr-convert-${job._id}`, async () => { await api.post(`/intake/ocr/jobs/${job._id}/convert-order`) })}>
                          Create order
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </SectionCard>

      <SectionCard title="Payments and printable documents" action={<PaymentsRoundedIcon color="primary" />}>
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.5fr 1fr 1fr 1.5fr 1fr' }, gap: 2 }}>
            <Box>
              <TextField select label="Order" value={paymentForm.orderNumber || selectedOrder?.orderNumber || ''} onChange={(event) => setPaymentForm((prev) => ({ ...prev, orderNumber: event.target.value }))} fullWidth>
                {ordersState.data.data.map((order) => <MenuItem key={order._id} value={order.orderNumber}>{order.orderNumber}</MenuItem>)}
              </TextField>
            </Box>
            <Box>
              <TextField select label="Provider" value={paymentForm.provider} onChange={(event) => setPaymentForm((prev) => ({ ...prev, provider: event.target.value }))} fullWidth>
                <MenuItem value="maviance">Maviance</MenuItem>
              </TextField>
            </Box>
            <Box>
              <TextField label="Amount" value={paymentForm.amount} onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: event.target.value }))} fullWidth />
            </Box>
            <Box>
              <TextField label="Phone" value={paymentForm.phone} onChange={(event) => setPaymentForm((prev) => ({ ...prev, phone: event.target.value }))} fullWidth />
            </Box>
            <Box>
              <Button
                fullWidth
                sx={{ height: '100%' }}
                variant="contained"
                onClick={() => run('gateway-initiate', async () => {
                  const orderNumber = paymentForm.orderNumber || selectedOrder?.orderNumber
                  if (!orderNumber) throw new Error('Select an order')
                  if (paymentForm.provider !== 'maviance') throw new Error('Maviance is the configured Cameroon gateway.')
                  await api.post('/payments/maviance/initiate', {
                    orderId: selectedOrder?._id,
                    amount: Number(paymentForm.amount),
                    channel: paymentForm.channel,
                    customerPhone: paymentForm.phone,
                    customerEmail: selectedOrder?.patient.email || 'patient@example.com',
                    customerName: selectedOrder ? `${selectedOrder.patient.firstName} ${selectedOrder.patient.lastName}` : 'Patient',
                  })
                })}
              >
                Initiate
              </Button>
            </Box>
          </Box>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Invoice</TableCell>
                  <TableCell>Order</TableCell>
                  <TableCell>Total</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Print</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoicesState.data.map((invoice) => (
                  <TableRow key={invoice._id}>
                    <TableCell>{invoice.invoiceNumber}</TableCell>
                    <TableCell>{invoice.orderId}</TableCell>
                    <TableCell>{formatMoney(invoice.total, 'XAF')}</TableCell>
                    <TableCell><Chip size="small" label={invoice.status} /></TableCell>
                    <TableCell>
                      <Button size="small" startIcon={<PrintRoundedIcon />} onClick={() => printDocument(`Invoice ${invoice.invoiceNumber}`, [
                        ['Invoice', invoice.invoiceNumber],
                        ['Order', invoice.orderId],
                        ['Total', formatMoney(invoice.total, 'XAF')],
                        ['Status', invoice.status],
                        ['Issued', formatDateTime(invoice.issuedAt)],
                      ])}>
                        Print
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {receiptsState.data.map((receipt) => (
              <Chip
                key={receipt._id}
                icon={<DescriptionRoundedIcon />}
                label={`${receipt.receiptNumber} · ${receipt.provider} · ${formatMoney(receipt.amount, receipt.currency)}`}
                onClick={() => printDocument(`Receipt ${receipt.receiptNumber}`, [
                  ['Receipt', receipt.receiptNumber],
                  ['Order', receipt.orderId],
                  ['Provider', receipt.provider],
                  ['Amount', formatMoney(receipt.amount, receipt.currency)],
                  ['Status', receipt.status],
                  ['Reference', receipt.gatewayReference],
                ])}
              />
            ))}
          </Stack>
          <Stack spacing={1}>
            {gatewayState.data.map((transaction) => (
              <Box key={transaction._id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography variant="body2">
                  {transaction.order?.orderNumber ?? transaction.orderNumber} · maviance · {transaction.ptn ?? transaction.externalTransactionId ?? transaction.gatewayReference ?? transaction._id}
                </Typography>
                <Button size="small" onClick={() => run(`verify-${transaction._id}`, async () => { await api.post(`/payments/maviance/transactions/${transaction._id}/verify`) })}>
                  Verify
                </Button>
              </Box>
            ))}
          </Stack>
        </Stack>
      </SectionCard>

      <SectionCard title="Multi-test workflow custody" action={<FactCheckRoundedIcon color="primary" />}>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Department</TableCell>
                <TableCell>Routes</TableCell>
                <TableCell>Next</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ordersState.data.data.map((order) => (
                <TableRow key={order._id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{(order as HydratedOrder & { currentDepartment?: string }).currentDepartment ?? 'reception'}</TableCell>
                  <TableCell>{order.workflowRoutes?.map((route) => `${route.testCode}: ${route.stages.join(' > ')}`).join(' / ')}</TableCell>
                  <TableCell>{order.workflowPlan?.nextStageLabel ?? 'Complete'}</TableCell>
                  <TableCell><StatusChip status={order.status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
        <Box>
          <SectionCard title="Department communication">
            <Stack spacing={2}>
              <TextField label="Subject" value={threadForm.subject} onChange={(event) => setThreadForm((prev) => ({ ...prev, subject: event.target.value }))} fullWidth />
              <TextField label="Department" value={threadForm.department} onChange={(event) => setThreadForm((prev) => ({ ...prev, department: event.target.value }))} fullWidth />
              <TextField label="Message" value={threadForm.body} onChange={(event) => setThreadForm((prev) => ({ ...prev, body: event.target.value }))} minRows={3} multiline fullWidth />
              <Button variant="contained" onClick={() => run('thread', async () => { await api.post('/communications/threads', threadForm) })}>Send</Button>
            </Stack>
          </SectionCard>
        </Box>
        <Box>
          <SectionCard title="Archive and cloud sync" action={<CloudSyncRoundedIcon color="primary" />}>
            <Stack spacing={2}>
              <Alert severity={syncState.data.status === 'success' ? 'success' : 'info'}>
                Cloud sync: {syncState.data.status}{syncState.data.lastSuccessAt ? ` · ${formatDateTime(syncState.data.lastSuccessAt)}` : ''}
              </Alert>
              <Button variant="contained" onClick={() => run('sync', async () => { await api.post('/offline/sync', { clientId: 'cameroon-e2e-console', mutations: [] }) })}>Run cloud sync</Button>
              <Typography variant="subtitle2">Archives</Typography>
              {archivesState.data.map((archive) => (
                <Typography key={archive._id} variant="body2">{archive._id} · retain until {formatDateTime(archive.retentionUntil)}</Typography>
              ))}
            </Stack>
          </SectionCard>
        </Box>
      </Box>

      <SectionCard title="Immutable admin log">
        <Stack spacing={1}>
          <Alert severity={auditState.data.hashChainValid ? 'success' : 'error'}>
            Hash chain {auditState.data.hashChainValid ? 'valid' : 'failed'} · {auditState.data.data.length} events
          </Alert>
          {auditState.data.data.slice(-12).reverse().map((event) => (
            <Box key={event._id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, borderBottom: '1px solid', borderColor: 'divider', py: 1 }}>
              <Typography variant="body2">{event.action} · {event.summary}</Typography>
              <Typography variant="caption" color="text.secondary">{event.hash?.slice(0, 12)}</Typography>
            </Box>
          ))}
        </Stack>
      </SectionCard>
    </Stack>
  )
}

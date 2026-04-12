import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
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
import ReactECharts from 'echarts-for-react'
import { useState } from 'react'

import { api } from '../api'
import { EmptyState, MetricCard, PageHeader, SectionCard } from '../components'
import type { AccountingJournalEntry } from '../types'
import { downloadPdfDocument, formatDateTime, formatMoney } from '../utils'
import { errorMessage, PageError, useLoadable } from './shared'

type ProductionReadiness = {
  generatedAt: string
  audit: {
    valid: boolean
    checked: number
    latestSequence: number
  }
  finance: {
    postedJournalEntries: number
    exportBatches: number
    provider: string
    providerConfigured: boolean
  }
  traceability: {
    chainOfCustodyEvents: number
    barcodeScans: number
    rejectedScans: number
  }
  communications: {
    chatThreads: number
    chatMessages: number
    smsConfigured: boolean
    whatsappConfigured: boolean
  }
  tat: Record<string, number>
  offline: {
    enabled: boolean
    syncEvents: number
  }
  integrations: {
    aiProvider: string
    aiConfigured: boolean
    gpsProvider: string
  }
}

type ProviderReadiness = Record<string, {
  provider: string
  configured: boolean
  requiredEnv?: string[]
  note?: string
}>

type DisasterRecoveryDashboard = {
  backups: Array<{ _id: string; status: string; notes: string; createdAt: string }>
  restores: Array<{ _id: string; status: string; notes: string; createdAt: string }>
  drills: Array<{ _id: string; status: string; notes: string; createdAt: string }>
  offlineSync: Array<{ _id: string; status: string; clientId: string; createdAt: string }>
  recommended: {
    rpoMinutes: number
    rtoMinutes: number
    architecture: string
  }
}

export function ProductionHardeningPage() {
  const readinessState = useLoadable<ProductionReadiness | null>(null, [], async () => {
    const response = await api.get<ProductionReadiness>('/production-readiness')
    return response.data
  })
  const providerState = useLoadable<ProviderReadiness>({}, [], async () => {
    const response = await api.get<ProviderReadiness>('/integrations/provider-readiness')
    return response.data
  })
  const ledgerState = useLoadable<AccountingJournalEntry[]>([], [], async () => {
    const response = await api.get<AccountingJournalEntry[]>('/accounting/ledger')
    return response.data
  })
  const drState = useLoadable<DisasterRecoveryDashboard | null>(null, [], async () => {
    const response = await api.get<DisasterRecoveryDashboard>('/dr/dashboard')
    return response.data
  })
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  if (readinessState.error || providerState.error || ledgerState.error || drState.error) {
    return <PageError message={readinessState.error ?? providerState.error ?? ledgerState.error ?? drState.error ?? 'Could not load production console'} />
  }

  const readiness = readinessState.data
  const tatChart = {
    tooltip: { trigger: 'item' },
    series: [
      {
        type: 'pie',
        radius: ['45%', '72%'],
        data: readiness
          ? Object.entries(readiness.tat).map(([name, value]) => ({ name, value }))
          : [],
      },
    ],
  }

  const rebuildLedger = async () => {
    try {
      await api.post('/accounting/rebuild-ledger')
      ledgerState.refresh()
      readinessState.refresh()
      setFeedback({ kind: 'success', message: 'Accounting ledger rebuilt from completed payments.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    }
  }

  const exportLedger = async () => {
    try {
      await api.post('/accounting/export', { provider: 'generic' })
      readinessState.refresh()
      setFeedback({ kind: 'success', message: 'Accounting export batch created. If provider env is configured, it was sent to the accounting endpoint.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: errorMessage(error) })
    }
  }

  const downloadEvidence = async () => {
    const response = await api.get('/audit/evidence-export')
    await downloadPdfDocument('audit-evidence-export.pdf', 'Audit Evidence Export', [], {
      sections: [
        {
          heading: 'Audit evidence',
          lines: [
            `Exported at: ${response.data.exportedAt}`,
            `Valid hash chain: ${response.data.verification.valid ? 'Yes' : 'No'}`,
            `Events checked: ${response.data.verification.checked}`,
            `Latest sequence: ${response.data.verification.latestSequence}`,
            response.data.note,
          ],
        },
      ],
    })
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Production hardening"
        title="Production readiness console"
        description="Operational controls for accounting, audit evidence, offline sync, MFA readiness, provider integrations, barcode traceability, and TAT monitoring."
        action={(
          <Stack direction="row" spacing={1}>
            <Button startIcon={<DownloadRoundedIcon />} onClick={downloadEvidence}>Audit evidence</Button>
            <Button startIcon={<SyncRoundedIcon />} onClick={() => { readinessState.refresh(); providerState.refresh(); ledgerState.refresh(); drState.refresh() }}>Refresh</Button>
          </Stack>
        )}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
        <MetricCard label="Audit chain" value={readiness?.audit.valid ? 'Valid' : 'Check'} helper={`${readiness?.audit.checked ?? 0} events`} />
        <MetricCard label="Journal entries" value={String(readiness?.finance.postedJournalEntries ?? 0)} helper={readiness?.finance.providerConfigured ? 'Provider configured' : 'Provider env pending'} />
        <MetricCard label="Barcode scans" value={String(readiness?.traceability.barcodeScans ?? 0)} helper={`${readiness?.traceability.rejectedScans ?? 0} rejected scans`} />
        <MetricCard label="Chat messages" value={String(readiness?.communications.chatMessages ?? 0)} helper={readiness?.communications.whatsappConfigured ? 'WhatsApp configured' : 'WhatsApp env pending'} />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' } }}>
        <SectionCard title="Provider readiness" description="External integrations are code-ready; live status depends on env credentials and vendor conformance.">
          <Stack spacing={1.5}>
            {Object.entries(providerState.data).map(([key, item]) => (
              <Paper key={key} variant="outlined" sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
                  <Box>
                    <Typography fontWeight={700}>{key.toUpperCase()} · {item.provider}</Typography>
                    {item.note ? <Typography variant="body2" color="text.secondary">{item.note}</Typography> : null}
                    {item.requiredEnv?.length ? (
                      <Typography variant="caption" color="text.secondary">Env: {item.requiredEnv.join(', ')}</Typography>
                    ) : null}
                  </Box>
                  <Chip color={item.configured ? 'success' : 'warning'} label={item.configured ? 'Configured' : 'Needs env'} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        </SectionCard>
        <SectionCard title="TAT status mix" description="ECharts visualization of current TAT dashboard counts.">
          <Box sx={{ height: 320 }}>
            {readiness ? <ReactECharts option={tatChart} style={{ height: 320, width: '100%' }} /> : null}
          </Box>
        </SectionCard>
      </Box>

      <SectionCard
        title="Accounting ledger"
        description="Posted journal entries are the finance-grade bridge to external accounting software."
        action={(
          <Stack direction="row" spacing={1}>
            <Button onClick={rebuildLedger}>Rebuild ledger</Button>
            <Button variant="contained" onClick={exportLedger}>Export ledger</Button>
          </Stack>
        )}
      >
        {ledgerState.data.length ? (
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Entry</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Debit</TableCell>
                  <TableCell>Credit</TableCell>
                  <TableCell>Amount</TableCell>
                  <TableCell>Posted</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ledgerState.data.map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell>{entry.entryNumber}</TableCell>
                    <TableCell>{entry.entryType}</TableCell>
                    <TableCell>{entry.debitAccount}</TableCell>
                    <TableCell>{entry.creditAccount}</TableCell>
                    <TableCell>{formatMoney(entry.amount, entry.currency)}</TableCell>
                    <TableCell>{entry.postedAt ? formatDateTime(entry.postedAt) : entry.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState title="No journal entries yet" body="Rebuild the ledger after payments are recorded." />
        )}
      </SectionCard>

      <SectionCard title="Offline and disaster recovery" description={drState.data?.recommended.architecture}>
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
          <MetricCard label="RPO target" value={`${drState.data?.recommended.rpoMinutes ?? 0} min`} />
          <MetricCard label="RTO target" value={`${drState.data?.recommended.rtoMinutes ?? 0} min`} />
          <MetricCard label="Offline sync events" value={String(readiness?.offline.syncEvents ?? 0)} helper={readiness?.offline.enabled ? 'Enabled' : 'Disabled'} />
        </Box>
      </SectionCard>
    </Stack>
  )
}

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
import type { ZohoBooksConfig, ZohoBooksSyncLog } from '../types'
import { downloadPdfDocument, formatDateTime } from '../utils'
import { errorMessage, PageError, useLoadable } from './shared'

type ProductionReadiness = {
  generatedAt: string
  audit: {
    valid: boolean
    checked: number
    latestSequence: number
  }
  finance: {
    provider: string
    providerConfigured: boolean
    syncedInvoices: number
    pendingInvoices: number
    syncedPayments: number
    pendingPayments: number
    failedZohoSyncs: number
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
  provider?: string
  configured: boolean
  requiredEnv?: string[]
  note?: string
}>

type OssStackReadiness = {
  categories: Array<{
    category: string
    implemented: boolean
    libraries?: string[]
    configured?: boolean
    note?: string
  }>
}

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
  const ossState = useLoadable<OssStackReadiness>({ categories: [] }, [], async () => {
    const response = await api.get<OssStackReadiness>('/oss/stack-readiness')
    return response.data
  })
  const zohoConfigState = useLoadable<ZohoBooksConfig | null>(null, [], async () => {
    const response = await api.get<ZohoBooksConfig>('/accounting/zoho/config')
    return response.data
  })
  const zohoLogsState = useLoadable<ZohoBooksSyncLog[]>([], [], async () => {
    const response = await api.get<ZohoBooksSyncLog[]>('/accounting/zoho/sync-logs')
    return response.data
  })
  const drState = useLoadable<DisasterRecoveryDashboard | null>(null, [], async () => {
    const response = await api.get<DisasterRecoveryDashboard>('/dr/dashboard')
    return response.data
  })
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  if (readinessState.error || providerState.error || ossState.error || zohoConfigState.error || zohoLogsState.error || drState.error) {
    return <PageError message={readinessState.error ?? providerState.error ?? ossState.error ?? zohoConfigState.error ?? zohoLogsState.error ?? drState.error ?? 'Could not load production console'} />
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

  const openZohoAuthorizeUrl = async () => {
    try {
      const response = await api.get<{ authorizeUrl: string }>('/accounting/zoho/authorize-url')
      window.open(response.data.authorizeUrl, '_blank', 'noopener,noreferrer')
      zohoLogsState.refresh()
      setFeedback({ kind: 'success', message: 'Opened the Zoho Books authorization screen.' })
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
            <Button startIcon={<SyncRoundedIcon />} onClick={() => { readinessState.refresh(); providerState.refresh(); ossState.refresh(); zohoConfigState.refresh(); zohoLogsState.refresh(); drState.refresh() }}>Refresh</Button>
          </Stack>
        )}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
        <MetricCard label="Audit chain" value={readiness?.audit.valid ? 'Valid' : 'Check'} helper={`${readiness?.audit.checked ?? 0} events`} />
        <MetricCard label="Zoho invoice syncs" value={String(readiness?.finance.syncedInvoices ?? 0)} helper={readiness?.finance.providerConfigured ? 'Provider configured' : 'Provider env pending'} />
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
                    <Typography fontWeight={700}>{key.toUpperCase()} · {item.provider ?? 'configured service'}</Typography>
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

      <SectionCard title="Open-source implementation stack" description="The production backend now reports the concrete OSS engines wired into the Node service.">
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
          {ossState.data.categories.map((item) => (
            <Paper key={item.category} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" spacing={1}>
                  <Typography fontWeight={700}>{item.category}</Typography>
                  <Chip size="small" color={item.implemented ? 'success' : 'warning'} label={item.implemented ? 'Implemented' : 'Pending'} />
                </Stack>
                {item.libraries?.length ? (
                  <Typography variant="caption" color="text.secondary">{item.libraries.join(', ')}</Typography>
                ) : null}
                {item.note ? <Typography variant="body2" color="text.secondary">{item.note}</Typography> : null}
              </Stack>
            </Paper>
          ))}
        </Box>
      </SectionCard>

      <SectionCard
        title="Zoho Books readiness"
        description="The accounting bridge is now Zoho Books only. Use this section to confirm env readiness and inspect recent sync activity."
        action={<Button onClick={openZohoAuthorizeUrl}>Open Zoho consent</Button>}
      >
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' }, mb: 2 }}>
          <MetricCard label="Client" value={zohoConfigState.data?.clientConfigured ? 'Configured' : 'Missing'} />
          <MetricCard label="Refresh token" value={zohoConfigState.data?.refreshTokenConfigured ? 'Configured' : 'Missing'} />
          <MetricCard label="Organization" value={zohoConfigState.data?.organizationConfigured ? 'Configured' : 'Missing'} />
          <MetricCard label="Failed syncs" value={String(readiness?.finance.failedZohoSyncs ?? 0)} />
        </Box>
        {zohoLogsState.data.length ? (
          <TableContainer sx={{ maxHeight: 420 }}>
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
                {zohoLogsState.data.slice(0, 20).map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                    <TableCell>{entry.operation}</TableCell>
                    <TableCell>{entry.entityType}</TableCell>
                    <TableCell>{entry.status}</TableCell>
                    <TableCell>{entry.endpoint}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState title="No Zoho sync activity yet" body="Authorize Zoho Books or trigger a doctor/order/payment sync to populate this log." />
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

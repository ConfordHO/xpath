import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
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
import { useEffect, useMemo, useState } from 'react'

import { api } from '../api'
import { MetricCard, SectionCard } from '../components'
import type {
  Accession,
  HydratedOrder,
  VendorAuthType,
  VendorConnector,
  VendorConnectorStatus,
  VendorDeviceType,
  VendorJob,
  VendorJobType,
  VendorName,
  VendorWebhookEvent,
} from '../types'
import { formatDateTime } from '../utils'
import { errorMessage, PageError, TablePlaceholder, useLoadable } from './shared'

interface VendorCatalogEntry {
  vendor: VendorName
  deviceType: VendorDeviceType
  productName: string
  suggestedProtocol: string
  suggestedDispatchPath: string
  capabilities: string[]
}

interface ConnectorFormState {
  name: string
  vendor: VendorName
  deviceType: VendorDeviceType
  instrumentId: string
  integrationId: string
  siteId: string
  status: VendorConnectorStatus
  enabled: boolean
  liveMode: boolean
  baseUrl: string
  apiVersion: string
  healthPath: string
  dispatchPath: string
  webhookPath: string
  authType: VendorAuthType
  authTokenEnvVar: string
  webhookSecretEnvVar: string
  externalDeviceId: string
  capabilities: string
  metadata: string
}

interface DispatchFormState {
  connectorId: string
  jobType: VendorJobType
  orderId: string
  accessionId: string
  sampleId: string
  slideId: string
  overridesJson: string
}

function defaultConnectorForm(): ConnectorFormState {
  return {
    name: '',
    vendor: 'leica',
    deviceType: 'tissue_processor',
    instrumentId: '',
    integrationId: '',
    siteId: '',
    status: 'ready',
    enabled: true,
    liveMode: false,
    baseUrl: '',
    apiVersion: 'v1',
    healthPath: '/api/v1/health',
    dispatchPath: '/api/v1/runs/tissue-processing',
    webhookPath: '/webhooks/vendors/leica/tissue_processor',
    authType: 'api_key',
    authTokenEnvVar: '',
    webhookSecretEnvVar: '',
    externalDeviceId: '',
    capabilities: 'case_sync, run_start, run_complete, status_poll',
    metadata: '',
  }
}

function defaultDispatchForm(): DispatchFormState {
  return {
    connectorId: '',
    jobType: 'case_sync',
    orderId: '',
    accessionId: '',
    sampleId: '',
    slideId: '',
    overridesJson: '{}',
  }
}

function formatStatusTone(status: VendorConnectorStatus | VendorJob['status'] | VendorWebhookEvent['processingStatus']) {
  if (status === 'online' || status === 'completed' || status === 'processed' || status === 'ready') {
    return 'success'
  }
  if (status === 'error' || status === 'failed' || status === 'offline') {
    return 'error'
  }
  if (status === 'acknowledged' || status === 'dispatched') {
    return 'info'
  }
  return 'default'
}

function parseConnectorForm(
  form: ConnectorFormState,
  existing?: VendorConnector | null,
): Omit<VendorConnector, '_id' | 'createdAt' | 'updatedAt'> {
  return {
    name: form.name.trim(),
    vendor: form.vendor,
    deviceType: form.deviceType,
    instrumentId: form.instrumentId.trim() || null,
    integrationId: form.integrationId.trim() || null,
    siteId: form.siteId.trim() || null,
    status: form.status,
    enabled: form.enabled,
    liveMode: form.liveMode,
    baseUrl: form.baseUrl.trim(),
    apiVersion: form.apiVersion.trim() || 'v1',
    healthPath: form.healthPath.trim() || '/api/v1/health',
    dispatchPath: form.dispatchPath.trim(),
    webhookPath: form.webhookPath.trim(),
    authType: form.authType,
    authTokenEnvVar: form.authTokenEnvVar.trim() || null,
    webhookSecretEnvVar: form.webhookSecretEnvVar.trim() || null,
    externalDeviceId: form.externalDeviceId.trim() || null,
    capabilities: form.capabilities
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    metadata: form.metadata.trim(),
    lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
    lastTestedAt: existing?.lastTestedAt ?? null,
  }
}

function buildConnectorForm(connector?: VendorConnector | null): ConnectorFormState {
  if (!connector) {
    return defaultConnectorForm()
  }

  return {
    name: connector.name,
    vendor: connector.vendor,
    deviceType: connector.deviceType,
    instrumentId: connector.instrumentId ?? '',
    integrationId: connector.integrationId ?? '',
    siteId: connector.siteId ?? '',
    status: connector.status,
    enabled: connector.enabled,
    liveMode: connector.liveMode,
    baseUrl: connector.baseUrl,
    apiVersion: connector.apiVersion,
    healthPath: connector.healthPath,
    dispatchPath: connector.dispatchPath,
    webhookPath: connector.webhookPath,
    authType: connector.authType,
    authTokenEnvVar: connector.authTokenEnvVar ?? '',
    webhookSecretEnvVar: connector.webhookSecretEnvVar ?? '',
    externalDeviceId: connector.externalDeviceId ?? '',
    capabilities: connector.capabilities.join(', '),
    metadata: connector.metadata,
  }
}

function buildDefaultPaths(vendor: VendorName, deviceType: VendorDeviceType, catalog: VendorCatalogEntry[]) {
  const match = catalog.find((entry) => entry.vendor === vendor && entry.deviceType === deviceType)
  if (!match) {
    return {
      name: '',
      dispatchPath: '',
      webhookPath: `/webhooks/vendors/${vendor}/${deviceType}`,
      capabilities: '',
    }
  }

  return {
    name: match.productName,
    dispatchPath: match.suggestedDispatchPath,
    webhookPath: `/webhooks/vendors/${vendor}/${deviceType}`,
    capabilities: match.capabilities.join(', '),
  }
}

export function VendorIntegrationConsole() {
  const connectorsState = useLoadable<VendorConnector[]>([], [], async () => {
    const response = await api.get<VendorConnector[]>('/vendor-connectors')
    return response.data
  })
  const jobsState = useLoadable<VendorJob[]>([], [], async () => {
    const response = await api.get<VendorJob[]>('/vendor-jobs')
    return response.data
  })
  const eventsState = useLoadable<VendorWebhookEvent[]>([], [], async () => {
    const response = await api.get<VendorWebhookEvent[]>('/vendor-webhook-events')
    return response.data
  })
  const catalogState = useLoadable<VendorCatalogEntry[]>([], [], async () => {
    const response = await api.get<VendorCatalogEntry[]>('/vendor-connectors/catalog')
    return response.data
  })
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const accessionsState = useLoadable<Accession[]>([], [], async () => {
    const response = await api.get<Accession[]>('/accessions')
    return response.data
  })

  const [connectorDialogOpen, setConnectorDialogOpen] = useState(false)
  const [editingConnector, setEditingConnector] = useState<VendorConnector | null>(null)
  const [connectorForm, setConnectorForm] = useState<ConnectorFormState>(defaultConnectorForm())
  const [connectorError, setConnectorError] = useState<string | null>(null)
  const [connectorSaving, setConnectorSaving] = useState(false)
  const [dispatchForm, setDispatchForm] = useState<DispatchFormState>(defaultDispatchForm())
  const [dispatchError, setDispatchError] = useState<string | null>(null)
  const [dispatchSuccess, setDispatchSuccess] = useState<string | null>(null)
  const [dispatching, setDispatching] = useState(false)
  const [testFeedback, setTestFeedback] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)

  const connectorOptions = connectorsState.data.map((entry) => ({
    label: `${entry.name} · ${entry.vendor}/${entry.deviceType}`,
    value: entry._id,
  }))

  const orderOptions = ordersState.data.data.map((order) => ({
    label: `${order.orderNumber} · ${order.patient.firstName} ${order.patient.lastName}`,
    value: order._id,
  }))

  const accessionOptions = accessionsState.data.map((accession) => ({
    label: accession.accessionId,
    value: accession._id,
  }))

  const connectorNameById = useMemo(
    () => new Map(connectorsState.data.map((entry) => [entry._id, entry.name])),
    [connectorsState.data],
  )

  const selectedConnector =
    connectorsState.data.find((entry) => entry._id === dispatchForm.connectorId) ?? null

  useEffect(() => {
    if (!dispatchForm.connectorId && connectorOptions[0]?.value) {
      setDispatchForm((prev) => ({ ...prev, connectorId: connectorOptions[0].value }))
    }
  }, [connectorOptions, dispatchForm.connectorId])

  useEffect(() => {
    if (!selectedConnector) {
      return
    }

    const suggestedJobType: VendorJobType =
      selectedConnector.deviceType === 'scanner'
        ? 'scan_request'
        : selectedConnector.deviceType === 'stainer'
          ? 'stain_request'
          : 'case_sync'

    setDispatchForm((prev) =>
      prev.connectorId === selectedConnector._id
        ? { ...prev, jobType: suggestedJobType }
        : prev,
    )
  }, [selectedConnector])

  const openCreateConnector = () => {
    setEditingConnector(null)
    setConnectorForm(defaultConnectorForm())
    setConnectorError(null)
    setConnectorDialogOpen(true)
  }

  const openEditConnector = (connector: VendorConnector) => {
    setEditingConnector(connector)
    setConnectorForm(buildConnectorForm(connector))
    setConnectorError(null)
    setConnectorDialogOpen(true)
  }

  const applyCatalogDefaults = (vendor: VendorName, deviceType: VendorDeviceType) => {
    const defaults = buildDefaultPaths(vendor, deviceType, catalogState.data)
    setConnectorForm((prev) => ({
      ...prev,
      vendor,
      deviceType,
      name: editingConnector ? prev.name : defaults.name,
      dispatchPath: defaults.dispatchPath,
      webhookPath: defaults.webhookPath,
      capabilities: defaults.capabilities || prev.capabilities,
    }))
  }

  const saveConnector = async () => {
    setConnectorSaving(true)
    setConnectorError(null)
    try {
      const payload = parseConnectorForm(connectorForm, editingConnector)
      if (editingConnector) {
        await api.put(`/vendor-connectors/${editingConnector._id}`, payload)
      } else {
        await api.post('/vendor-connectors', payload)
      }
      setConnectorDialogOpen(false)
      connectorsState.refresh()
    } catch (saveError) {
      setConnectorError(errorMessage(saveError))
    } finally {
      setConnectorSaving(false)
    }
  }

  const testConnector = async (connector: VendorConnector) => {
    setTestFeedback(null)
    setTestError(null)
    try {
      const response = await api.post(`/vendor-connectors/${connector._id}/test`)
      const message =
        response.data?.message ??
        `${connector.name} test returned ${response.data?.status ?? 'success'}`
      setTestFeedback(message)
      connectorsState.refresh()
    } catch (testRequestError) {
      setTestError(errorMessage(testRequestError))
      connectorsState.refresh()
    }
  }

  const dispatchJob = async () => {
    setDispatching(true)
    setDispatchError(null)
    setDispatchSuccess(null)
    try {
      const overrides =
        dispatchForm.overridesJson.trim() === ''
          ? {}
          : (JSON.parse(dispatchForm.overridesJson) as Record<string, unknown>)
      const response = await api.post('/vendor-jobs', {
        connectorId: dispatchForm.connectorId,
        jobType: dispatchForm.jobType,
        orderId: dispatchForm.orderId || null,
        accessionId: dispatchForm.accessionId || null,
        sampleId: dispatchForm.sampleId || null,
        slideId: dispatchForm.slideId || null,
        overrides,
      })
      setDispatchSuccess(
        response.data?.simulated
          ? 'Job queued in simulation mode.'
          : 'Job dispatched to the connector.',
      )
      setDispatchForm((prev) => ({ ...prev, overridesJson: '{}' }))
      jobsState.refresh()
      connectorsState.refresh()
    } catch (requestError) {
      setDispatchError(errorMessage(requestError))
    } finally {
      setDispatching(false)
    }
  }

  const retryJob = async (job: VendorJob) => {
    setDispatchError(null)
    setDispatchSuccess(null)
    try {
      const response = await api.post(`/vendor-jobs/${job._id}/retry`)
      setDispatchSuccess(
        response.data?.simulated
          ? `Retry for ${job.jobType} stored in simulation mode.`
          : `Retry for ${job.jobType} sent successfully.`,
      )
      jobsState.refresh()
      connectorsState.refresh()
    } catch (requestError) {
      setDispatchError(errorMessage(requestError))
    }
  }

  const readyConnectors = connectorsState.data.filter((entry) => entry.status === 'ready' || entry.status === 'online').length
  const liveConnectors = connectorsState.data.filter((entry) => entry.liveMode).length
  const failedJobs = jobsState.data.filter((entry) => entry.status === 'failed').length
  const pendingEvents = eventsState.data.filter((entry) => entry.processingStatus !== 'processed').length

  return (
    <Stack spacing={3}>
      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' },
        }}
      >
        <MetricCard label="Ready connectors" value={String(readyConnectors)} helper="Configured and available for queueing." />
        <MetricCard label="Live mode" value={String(liveConnectors)} helper="Connectors that will attempt real outbound calls." />
        <MetricCard label="Failed jobs" value={String(failedJobs)} helper="Jobs needing retry or payload review." />
        <MetricCard label="Pending events" value={String(pendingEvents)} helper="Webhook events not fully processed." />
      </Box>

      <SectionCard
        title="Vendor connectors"
        description="Configure Leica tissue processor and stainer connectors, plus the Roche scanner gateway."
        action={
          <Button variant="contained" onClick={openCreateConnector}>
            Add connector
          </Button>
        }
      >
        <TablePlaceholder loading={connectorsState.loading} />
        {connectorsState.error ? <PageError message={connectorsState.error} /> : null}
        {testFeedback ? <Alert severity="success" sx={{ mb: 2 }}>{testFeedback}</Alert> : null}
        {testError ? <Alert severity="error" sx={{ mb: 2 }}>{testError}</Alert> : null}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Device</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Mode</TableCell>
                <TableCell>Webhook</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {connectorsState.data.map((connector) => (
                <TableRow key={connector._id}>
                  <TableCell>
                    <Stack spacing={0.5}>
                      <Typography fontWeight={700}>{connector.name}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {connector.baseUrl}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>{`${connector.vendor} / ${connector.deviceType}`}</TableCell>
                  <TableCell>
                    <Chip size="small" color={formatStatusTone(connector.status)} label={connector.status} />
                  </TableCell>
                  <TableCell>{connector.liveMode ? 'Live' : 'Simulation'}</TableCell>
                  <TableCell>{connector.webhookPath}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => openEditConnector(connector)}>
                        Edit
                      </Button>
                      <Button size="small" startIcon={<ScienceRoundedIcon />} onClick={() => void testConnector(connector)}>
                        Test
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <SectionCard title="Dispatch queue" description="Submit outbound case, stain, or scan jobs into the vendor integration layer.">
        <Stack spacing={2}>
          {dispatchError ? <Alert severity="error">{dispatchError}</Alert> : null}
          {dispatchSuccess ? <Alert severity="success">{dispatchSuccess}</Alert> : null}
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
            }}
          >
            <FormControl fullWidth>
              <InputLabel>Connector</InputLabel>
              <Select
                label="Connector"
                value={dispatchForm.connectorId}
                onChange={(event) =>
                  setDispatchForm((prev) => ({ ...prev, connectorId: String(event.target.value) }))
                }
              >
                {connectorOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Job type</InputLabel>
              <Select
                label="Job type"
                value={dispatchForm.jobType}
                onChange={(event) =>
                  setDispatchForm((prev) => ({ ...prev, jobType: event.target.value as VendorJobType }))
                }
              >
                {[
                  'case_sync',
                  'run_start',
                  'run_complete',
                  'stain_request',
                  'stain_complete',
                  'scan_request',
                  'scan_complete',
                  'status_poll',
                  'maintenance',
                ].map((jobType) => (
                  <MenuItem key={jobType} value={jobType}>
                    {jobType}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Order</InputLabel>
              <Select
                label="Order"
                value={dispatchForm.orderId}
                onChange={(event) =>
                  setDispatchForm((prev) => ({ ...prev, orderId: String(event.target.value) }))
                }
              >
                <MenuItem value="">None</MenuItem>
                {orderOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Accession</InputLabel>
              <Select
                label="Accession"
                value={dispatchForm.accessionId}
                onChange={(event) =>
                  setDispatchForm((prev) => ({ ...prev, accessionId: String(event.target.value) }))
                }
              >
                <MenuItem value="">None</MenuItem>
                {accessionOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Sample ID"
              value={dispatchForm.sampleId}
              onChange={(event) => setDispatchForm((prev) => ({ ...prev, sampleId: event.target.value }))}
              fullWidth
            />
            <TextField
              label="Slide ID"
              value={dispatchForm.slideId}
              onChange={(event) => setDispatchForm((prev) => ({ ...prev, slideId: event.target.value }))}
              fullWidth
            />
          </Box>
          <TextField
            label="Overrides JSON"
            value={dispatchForm.overridesJson}
            onChange={(event) => setDispatchForm((prev) => ({ ...prev, overridesJson: event.target.value }))}
            multiline
            minRows={5}
            fullWidth
          />
          {selectedConnector ? (
            <Alert severity="info">
              Dispatch target: {selectedConnector.name}. Webhook callback: {selectedConnector.webhookPath}
            </Alert>
          ) : null}
          <Box>
            <Button disabled={dispatching || !dispatchForm.connectorId} variant="contained" onClick={() => void dispatchJob()}>
              Queue job
            </Button>
          </Box>
        </Stack>
      </SectionCard>

      <SectionCard title="Recent jobs" description="Inspect outbound traffic, retry failures, and confirm which connector handled each request.">
        <TablePlaceholder loading={jobsState.loading} />
        {jobsState.error ? <PageError message={jobsState.error} /> : null}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Connector</TableCell>
                <TableCell>Job</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Context</TableCell>
                <TableCell>Requested</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {jobsState.data.slice(0, 12).map((job) => (
                <TableRow key={job._id}>
                  <TableCell>{connectorNameById.get(job.connectorId) ?? job.connectorId}</TableCell>
                  <TableCell>{job.jobType}</TableCell>
                  <TableCell>
                    <Chip size="small" color={formatStatusTone(job.status)} label={job.status} />
                  </TableCell>
                  <TableCell>{job.slideId ?? job.accessionId ?? job.orderId ?? '—'}</TableCell>
                  <TableCell>{formatDateTime(job.requestedAt)}</TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      startIcon={<ReplayRoundedIcon />}
                      onClick={() => void retryJob(job)}
                    >
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <SectionCard title="Webhook events" description="Track Leica and Roche callbacks as they move processing, staining, and digital slide workflows forward.">
        <TablePlaceholder loading={eventsState.loading} />
        {eventsState.error ? <PageError message={eventsState.error} /> : null}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Vendor</TableCell>
                <TableCell>Event</TableCell>
                <TableCell>State</TableCell>
                <TableCell>Traceability</TableCell>
                <TableCell>Received</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {eventsState.data.slice(0, 12).map((event) => (
                <TableRow key={event._id}>
                  <TableCell>{`${event.vendor} / ${event.deviceType}`}</TableCell>
                  <TableCell>{event.eventType}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={formatStatusTone(event.processingStatus)}
                      label={event.processingStatus}
                    />
                  </TableCell>
                  <TableCell>{event.slideId ?? event.accessionId ?? event.orderId ?? '—'}</TableCell>
                  <TableCell>{formatDateTime(event.receivedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={connectorDialogOpen} onClose={() => setConnectorDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingConnector ? 'Edit vendor connector' : 'Add vendor connector'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {connectorError ? <Alert severity="error">{connectorError}</Alert> : null}
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
              }}
            >
              <TextField
                label="Name"
                value={connectorForm.name}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, name: event.target.value }))}
                fullWidth
              />
              <FormControl fullWidth>
                <InputLabel>Vendor</InputLabel>
                <Select
                  label="Vendor"
                  value={connectorForm.vendor}
                  onChange={(event) => {
                    const vendor = event.target.value as VendorName
                    applyCatalogDefaults(vendor, connectorForm.deviceType)
                  }}
                >
                  <MenuItem value="leica">Leica</MenuItem>
                  <MenuItem value="roche">Roche</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Device type</InputLabel>
                <Select
                  label="Device type"
                  value={connectorForm.deviceType}
                  onChange={(event) => {
                    const deviceType = event.target.value as VendorDeviceType
                    applyCatalogDefaults(connectorForm.vendor, deviceType)
                  }}
                >
                  <MenuItem value="tissue_processor">Tissue processor</MenuItem>
                  <MenuItem value="stainer">Stainer</MenuItem>
                  <MenuItem value="scanner">Scanner</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select
                  label="Status"
                  value={connectorForm.status}
                  onChange={(event) =>
                    setConnectorForm((prev) => ({
                      ...prev,
                      status: event.target.value as VendorConnectorStatus,
                    }))
                  }
                >
                  <MenuItem value="draft">Draft</MenuItem>
                  <MenuItem value="ready">Ready</MenuItem>
                  <MenuItem value="online">Online</MenuItem>
                  <MenuItem value="offline">Offline</MenuItem>
                  <MenuItem value="error">Error</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="Base URL"
                value={connectorForm.baseUrl}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, baseUrl: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Dispatch path"
                value={connectorForm.dispatchPath}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, dispatchPath: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Health path"
                value={connectorForm.healthPath}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, healthPath: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Webhook path"
                value={connectorForm.webhookPath}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, webhookPath: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Instrument ID"
                value={connectorForm.instrumentId}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, instrumentId: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Integration ID"
                value={connectorForm.integrationId}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, integrationId: event.target.value }))}
                fullWidth
              />
              <TextField
                label="Site ID"
                value={connectorForm.siteId}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, siteId: event.target.value }))}
                fullWidth
              />
              <TextField
                label="External device ID"
                value={connectorForm.externalDeviceId}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, externalDeviceId: event.target.value }))}
                fullWidth
              />
              <FormControl fullWidth>
                <InputLabel>Auth type</InputLabel>
                <Select
                  label="Auth type"
                  value={connectorForm.authType}
                  onChange={(event) =>
                    setConnectorForm((prev) => ({
                      ...prev,
                      authType: event.target.value as VendorAuthType,
                    }))
                  }
                >
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="api_key">API key</MenuItem>
                  <MenuItem value="bearer">Bearer</MenuItem>
                  <MenuItem value="basic">Basic</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label="Token env var"
                value={connectorForm.authTokenEnvVar}
                onChange={(event) =>
                  setConnectorForm((prev) => ({ ...prev, authTokenEnvVar: event.target.value }))
                }
                fullWidth
              />
              <TextField
                label="Webhook secret env var"
                value={connectorForm.webhookSecretEnvVar}
                onChange={(event) =>
                  setConnectorForm((prev) => ({ ...prev, webhookSecretEnvVar: event.target.value }))
                }
                fullWidth
              />
              <TextField
                label="Capabilities"
                value={connectorForm.capabilities}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, capabilities: event.target.value }))}
                helperText="Comma-separated"
                fullWidth
              />
              <TextField
                label="API version"
                value={connectorForm.apiVersion}
                onChange={(event) => setConnectorForm((prev) => ({ ...prev, apiVersion: event.target.value }))}
                fullWidth
              />
            </Box>
            <TextField
              label="Metadata"
              value={connectorForm.metadata}
              onChange={(event) => setConnectorForm((prev) => ({ ...prev, metadata: event.target.value }))}
              multiline
              minRows={3}
              fullWidth
            />
            <Stack direction="row" spacing={3}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={connectorForm.enabled}
                    onChange={(event) => setConnectorForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                  />
                }
                label="Enabled"
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={connectorForm.liveMode}
                    onChange={(event) => setConnectorForm((prev) => ({ ...prev, liveMode: event.target.checked }))}
                  />
                }
                label="Live mode"
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConnectorDialogOpen(false)}>Cancel</Button>
          <Button disabled={connectorSaving} variant="contained" onClick={() => void saveConnector()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

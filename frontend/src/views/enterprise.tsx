import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded'
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

import { api } from '../api'
import {
  PageHeader,
  SectionCard,
  StatusChip,
} from '../components'
import type {
  AiAnalysisResult,
  AiModelRegistryRecord,
  AntibodyInventoryItem,
  ArchiveRecord,
  AuditEvent,
  BarcodeRecord,
  ChainOfCustodyEvent,
  CommunicationLog,
  CourierProviderEvent,
  CredentialAuditRecord,
  CytologyCase,
  CytologyQualityRecord,
  DigitalSlideRecord,
  DocumentRecord,
  ExternalIntegration,
  HistologyWorklistItem,
  HydratedOrder,
  InsuranceAuthorization,
  InstrumentConnection,
  InstrumentRunLog,
  Invoice,
  LabelTemplateRecord,
  ModuleAuditEntry,
  OrderAmendment,
  OcrIntakeJob,
  OrderCorrection,
  PricingRule,
  PreAnalyticsLog,
  QcThreshold,
  QualityEvent,
  ReagentInventoryItem,
  RecoveryRecord,
  ReferenceRange,
  RefundAdjustment,
  Report,
  ReportTemplateRecord,
  ResearchDataset,
  Sample,
  SampleDiscrepancyCase,
  SessionRecord,
  SpecialStainRequest,
  Site,
  SiteTransfer,
  TatAlert,
  TatSummary,
  TemperatureLogRecord,
  ValidationRule,
  WasteLog,
} from '../types'
import { formatDateTime, formatMoney } from '../utils'
import { errorMessage, PageError, TablePlaceholder, useLoadable } from './shared'
import { VendorIntegrationConsole } from './vendorIntegrations'

type FormValue = string | number | boolean | null

interface FieldOption {
  label: string
  value: string
}

interface FieldConfig {
  key: string
  label: string
  type: 'text' | 'number' | 'textarea' | 'select' | 'checkbox' | 'date'
  options?: FieldOption[]
}

interface ColumnConfig<T> {
  label: string
  render: (row: T) => ReactNode
}

interface RowAction<T> {
  label: string
  onClick: (row: T) => Promise<void>
  icon?: ReactNode
  color?: 'inherit' | 'primary' | 'secondary' | 'success' | 'error'
  disabled?: (row: T) => boolean
}

type GenericRecord = {
  _id: string
}

type TatDashboardResponse = {
  range: string
  from: string | null
  to: string | null
  averages: {
    totalMinutes: number
    preAnalyticalMinutes: number
  }
  counts: {
    onTrack: number
    risk: number
    breach: number
    complete: number
  }
  phaseBreakdown: Record<string, { count: number; averageMinutes: number }>
  entries: Array<{
    orderId: string
    orderNumber: string
    siteId: string | null
    status: string
    totalMinutes: number
    targetMinutes: number
    totalStatus: 'on_track' | 'risk' | 'breach' | 'complete'
    createdAt: string
    releasedAt: string | null
    clocks: Array<{
      phase: string
      startedAt: string | null
      endedAt: string | null
      durationMinutes: number | null
      targetMinutes: number
      status: 'on_track' | 'risk' | 'breach' | 'complete'
    }>
  }>
}

type AuditVerificationResponse = {
  valid: boolean
  checked: number
  latestHash: string | null
  latestSequence: number
  failures: Array<{
    eventId: string
    sequence: number
    reason: string
  }>
}

function formatFieldValue(value: unknown, field: FieldConfig): string | number | boolean {
  if (field.type === 'checkbox') {
    return Boolean(value)
  }
  if (field.type === 'number') {
    return Number(value ?? 0)
  }
  return String(value ?? '')
}

function printBarcodeLabel(row: BarcodeRecord) {
  const popup = window.open('', '_blank', 'width=420,height=520')
  if (!popup) return
  popup.document.write(`
    <html>
      <head>
        <title>XPath Label ${row.code}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 24px; }
          .label { border: 2px solid #111; border-radius: 12px; padding: 18px; width: 320px; }
          .brand { font-weight: 800; letter-spacing: .08em; }
          .code { font-family: monospace; font-size: 14px; word-break: break-all; margin-top: 12px; }
          .meta { margin-top: 10px; font-size: 12px; color: #333; }
          @media print { button { display: none; } }
        </style>
      </head>
      <body>
        <div class="label">
          <div class="brand">XPATH LIMS</div>
          <div class="code">${row.code}</div>
          <div class="meta">${row.entityType.toUpperCase()} · ${row.entityId ?? 'UNASSIGNED'}</div>
          <div class="meta">Status: ${row.status}</div>
        </div>
        <button onclick="window.print()">Print label</button>
      </body>
    </html>
  `)
  popup.document.close()
}

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: FieldConfig
  value: FormValue
  onChange: (value: FormValue) => void
}) {
  if (field.type === 'checkbox') {
    return (
      <FormControlLabel
        control={<Checkbox checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />}
        label={field.label}
      />
    )
  }

  if (field.type === 'select') {
    return (
      <FormControl fullWidth>
        <InputLabel>{field.label}</InputLabel>
        <Select
          label={field.label}
          value={String(value ?? '')}
          onChange={(event) => onChange(String(event.target.value))}
        >
          {(field.options ?? []).map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    )
  }

  return (
    <TextField
      label={field.label}
      type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
      value={field.type === 'number' ? Number(value ?? 0) : String(value ?? '')}
      onChange={(event) =>
        onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)
      }
      InputLabelProps={field.type === 'date' ? { shrink: true } : undefined}
      multiline={field.type === 'textarea'}
      minRows={field.type === 'textarea' ? 3 : undefined}
      fullWidth
    />
  )
}

function ResourceSection<T extends GenericRecord>({
  title,
  description,
  endpoint,
  columns,
  fields,
  initialValues,
  rowActions = [],
}: {
  title: string
  description: string
  endpoint: string
  columns: Array<ColumnConfig<T>>
  fields: FieldConfig[]
  initialValues: Record<string, FormValue>
  rowActions?: Array<RowAction<T>>
}) {
  const state = useLoadable<T[]>([], [endpoint], async () => {
    const response = await api.get<T[]>(endpoint)
    return response.data
  })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<T | null>(null)
  const [form, setForm] = useState<Record<string, FormValue>>(initialValues)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setForm(initialValues)
    setSubmitError(null)
    setDialogOpen(true)
  }

  const openEdit = (row: T) => {
    const source = row as Record<string, unknown>
    const nextForm = fields.reduce<Record<string, FormValue>>((acc, field) => {
      acc[field.key] = formatFieldValue(source[field.key], field) as FormValue
      return acc
    }, { ...initialValues })
    setEditing(row)
    setForm(nextForm)
    setSubmitError(null)
    setDialogOpen(true)
  }

  const save = async () => {
    setSubmitting(true)
    setSubmitError(null)
    try {
      if (editing) {
        await api.put(`${endpoint}/${editing._id}`, form)
      } else {
        await api.post(endpoint, form)
      }
      setDialogOpen(false)
      state.refresh()
    } catch (saveError) {
      setSubmitError(errorMessage(saveError))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <SectionCard
        title={title}
        description={description}
        action={
          <Button variant="contained" onClick={openCreate}>
            Add record
          </Button>
        }
      >
        <TablePlaceholder loading={state.loading} />
        {state.error ? <PageError message={state.error} /> : null}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                {columns.map((column) => (
                  <TableCell key={column.label}>{column.label}</TableCell>
                ))}
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.data.map((row) => (
                <TableRow key={row._id}>
                  {columns.map((column) => (
                    <TableCell key={column.label}>{column.render(row)}</TableCell>
                  ))}
                  <TableCell>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => openEdit(row)}>
                        Edit
                      </Button>
                      {rowActions.map((action) => (
                        <Button
                          key={action.label}
                          size="small"
                          color={action.color ?? 'primary'}
                          startIcon={action.icon}
                          disabled={action.disabled?.(row)}
                          onClick={async () => {
                            await action.onClick(row)
                            state.refresh()
                          }}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Edit ${title}` : `Add ${title}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {submitError ? <Alert severity="error">{submitError}</Alert> : null}
            {fields.map((field) => (
              <FieldEditor
                key={field.key}
                field={field}
                value={form[field.key]}
                onChange={(value) => setForm((prev) => ({ ...prev, [field.key]: value }))}
              />
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button disabled={submitting} variant="contained" onClick={save}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export function ModuleAuditPage() {
  const auditState = useLoadable<ModuleAuditEntry[]>([], [], async () => {
    const response = await api.get<ModuleAuditEntry[]>('/module-audit')
    return response.data
  })
  const [editingEntry, setEditingEntry] = useState<ModuleAuditEntry | null>(null)
  const [targetReleaseDate, setTargetReleaseDate] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const statusColor = (status: string) => {
    if (status === 'implemented') return 'success' as const
    if (status === 'partial') return 'warning' as const
    return 'default' as const
  }

  const openTargetEditor = (entry: ModuleAuditEntry) => {
    setEditingEntry(entry)
    setTargetReleaseDate(entry.targetReleaseDate ?? '')
  }

  const saveTargetReleaseDate = async () => {
    if (!editingEntry) return
    try {
      const response = await api.put<ModuleAuditEntry[]>(`/module-audit/${editingEntry.number}/target-release-date`, {
        targetReleaseDate: targetReleaseDate || null,
      })
      auditState.setData(response.data)
      setFeedback({ kind: 'success', message: `Target release date updated for module ${editingEntry.number}.` })
      setEditingEntry(null)
    } catch (saveError) {
      setFeedback({ kind: 'error', message: errorMessage(saveError) })
    }
  }

  if (auditState.loading) return <Typography>Loading module audit…</Typography>
  if (auditState.error) return <PageError message={auditState.error} />

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Module Audit"
        title="Requested LIMS scope review"
        description="This page tracks the 25-module brief against the current Postgres-backed app. It stays intentionally honest about what is working today versus what still needs production hardening."
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <SectionCard title="Coverage by module" description="Implemented means the feature works in the app. Partial means important production controls are still missing. Pending means the module is still mostly scaffolding.">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Module</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Production readiness</TableCell>
                <TableCell>Target milestone release date</TableCell>
                <TableCell>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {auditState.data.map((entry) => (
                <TableRow key={entry.number}>
                  <TableCell>{entry.number}</TableCell>
                  <TableCell>{entry.title}</TableCell>
                  <TableCell>
                    <Chip label={entry.status} color={statusColor(entry.status)} size="small" />
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={entry.productionReadiness ?? (entry.productionReady ? 'Code ready' : 'Code and external integration')}
                      color={
                        (entry.productionReadiness ?? '').toLowerCase().includes('external')
                          ? 'warning'
                          : entry.productionReady
                            ? 'success'
                            : 'info'
                      }
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="body2">{entry.targetReleaseDate || 'Not set'}</Typography>
                      <Button size="small" onClick={() => openTargetEditor(entry)}>Edit</Button>
                    </Stack>
                  </TableCell>
                  <TableCell>{entry.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
      <Dialog open={!!editingEntry} onClose={() => setEditingEntry(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Set target milestone release date</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Use the calendar picker or type the date manually as YYYY-MM-DD.
            </Typography>
            <TextField
              label="Target release date"
              type="date"
              value={targetReleaseDate}
              onChange={(event) => setTargetReleaseDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingEntry(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveTargetReleaseDate}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

function parseOcrJobPayload(job: OcrIntakeJob) {
  if (typeof job.parsedPayload === 'string') {
    try {
      return JSON.parse(job.parsedPayload) as {
        patient: {
          firstName: string
          lastName: string
          dateOfBirth: string
          gender: string
          phone: string
          email: string
          address: string
        }
        clinicalHistory: string
        testTypeIds: string[]
        matchedTestCodes: string[]
      }
    } catch {
      return null
    }
  }
  return job.parsedPayload
}

function parseOcrFieldConfidences(job: OcrIntakeJob) {
  if (typeof job.fieldConfidences === 'string') {
    try {
      return JSON.parse(job.fieldConfidences) as Record<string, number>
    } catch {
      return {}
    }
  }
  return job.fieldConfidences
}

function formatApprovalProgress(approvals?: Array<{ userName: string }>, required = 1) {
  return `${approvals?.length ?? 0}/${required}`
}

export function ClinicalOperationsPage() {
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const samplesState = useLoadable<{ data: Sample[] }>({ data: [] }, [], async () => {
    const response = await api.get('/samples')
    return response.data
  })
  const amendmentsState = useLoadable<OrderAmendment[]>([], [], async () => {
    const response = await api.get<OrderAmendment[]>('/order-amendments')
    return response.data
  })
  const ocrJobsState = useLoadable<OcrIntakeJob[]>([], [], async () => {
    const response = await api.get<OcrIntakeJob[]>('/intake/ocr/jobs')
    return response.data
  })
  const validationRulesState = useLoadable<ValidationRule[]>([], [], async () => {
    const response = await api.get<ValidationRule[]>('/validation-rules')
    return response.data
  })
  const discrepancyState = useLoadable<SampleDiscrepancyCase[]>([], [], async () => {
    const response = await api.get<SampleDiscrepancyCase[]>('/sample-discrepancies')
    return response.data
  })
  const courierTelemetryState = useLoadable<{ provider: string; dispatchConfigured: boolean; events: CourierProviderEvent[]; temperatureLogs: TemperatureLogRecord[] }>({ provider: '', dispatchConfigured: false, events: [], temperatureLogs: [] }, [], async () => {
    const response = await api.get('/integrations/courier/telemetry')
    return response.data
  })
  const [ocrText, setOcrText] = useState(
    'Name: Jane Doe\nDOB: 1989-05-14\nPhone: +254711222333\nEmail: jane@example.com\nAddress: Westlands Nairobi\nHistory: Persistent abnormal bleeding\nRequested tests: HE, IHC',
  )
  const [ocrFile, setOcrFile] = useState<File | null>(null)
  const [ocrVerifyJob, setOcrVerifyJob] = useState<OcrIntakeJob | null>(null)
  const [ocrVerifyText, setOcrVerifyText] = useState('')
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrSuccess, setOcrSuccess] = useState<string | null>(null)
  const [validationFeedback, setValidationFeedback] = useState<string | null>(null)
  const [ruleEditingId, setRuleEditingId] = useState<string | null>(null)
  const [ruleForm, setRuleForm] = useState({
    name: '',
    scope: 'order' as ValidationRule['scope'],
    severity: 'blocking' as ValidationRule['severity'],
    active: true,
    requiredFields: 'clinicalHistory',
    message: '',
  })
  const [amendOrderId, setAmendOrderId] = useState('')
  const [amendType, setAmendType] = useState<'amendment' | 'add_on' | 'cancellation'>('amendment')
  const [amendReason, setAmendReason] = useState('')
  const [amendDetails, setAmendDetails] = useState('')
  const [correctionOrderId, setCorrectionOrderId] = useState('')
  const [correctionReason, setCorrectionReason] = useState('')
  const [correctionNotes, setCorrectionNotes] = useState('')
  const [corrections, setCorrections] = useState<OrderCorrection[]>([])
  const [sampleRejectId, setSampleRejectId] = useState('')
  const [sampleRejectReason, setSampleRejectReason] = useState('')
  const [discrepancyType, setDiscrepancyType] = useState<SampleDiscrepancyCase['discrepancyType']>('identity_mismatch')
  const [discrepancySeverity, setDiscrepancySeverity] = useState<SampleDiscrepancyCase['severity']>('major')
  const [discrepancyAction, setDiscrepancyAction] = useState<SampleDiscrepancyCase['immediateAction']>('quarantine')

  const orderOptions = ordersState.data.data.map((order) => ({
    label: `${order.orderNumber} · ${order.patient.firstName} ${order.patient.lastName}`,
    value: order._id,
  }))
  const sampleOptions = samplesState.data.data.map((sample) => ({
    label: `${sample.label} · ${sample.status}`,
    value: sample._id,
  }))

  const submitOcrJob = async () => {
    setOcrError(null)
    setOcrSuccess(null)
    try {
      const formData = new FormData()
      if (ocrFile) formData.append('file', ocrFile)
      if (ocrText.trim()) formData.append('text', ocrText)
      await api.post('/intake/ocr/jobs', formData)
      setOcrSuccess('OCR verification job created. Review and verify it before converting to an order.')
      setOcrFile(null)
      ocrJobsState.refresh()
    } catch (parseError) {
      setOcrError(errorMessage(parseError))
    }
  }

  const openOcrVerifier = (job: OcrIntakeJob) => {
    const parsed = parseOcrJobPayload(job)
    setOcrVerifyJob(job)
    setOcrVerifyText(JSON.stringify(parsed, null, 2))
  }

  const verifyOcrJob = async () => {
    if (!ocrVerifyJob) return
    setOcrError(null)
    try {
      await api.post(`/intake/ocr/jobs/${ocrVerifyJob._id}/verify`, {
        parsedPayload: JSON.parse(ocrVerifyText),
        verificationNotes: 'Verified from clinical operations screen',
      })
      setOcrVerifyJob(null)
      setOcrSuccess('OCR job verified. It can now be converted into an order.')
      ocrJobsState.refresh()
    } catch (createError) {
      setOcrError(errorMessage(createError))
    }
  }

  const convertOcrJob = async (job: OcrIntakeJob) => {
    setOcrError(null)
    setOcrSuccess(null)
    try {
      await api.post(`/intake/ocr/jobs/${job._id}/convert-order`)
      setOcrSuccess('Verified OCR intake converted into a draft order.')
      ocrJobsState.refresh()
      ordersState.refresh()
    } catch (convertError) {
      setOcrError(errorMessage(convertError))
    }
  }

  const saveValidationRule = async () => {
    setValidationFeedback(null)
    try {
      const payload = {
        ...ruleForm,
        requiredFields: ruleForm.requiredFields
          .split(',')
          .map((field) => field.trim())
          .filter(Boolean),
      }
      if (ruleEditingId) {
        await api.put(`/validation-rules/${ruleEditingId}`, payload)
      } else {
        await api.post('/validation-rules', payload)
      }
      setRuleEditingId(null)
      setRuleForm({
        name: '',
        scope: 'order',
        severity: 'blocking',
        active: true,
        requiredFields: 'clinicalHistory',
        message: '',
      })
      setValidationFeedback('Validation rule saved.')
      validationRulesState.refresh()
    } catch (ruleError) {
      setValidationFeedback(errorMessage(ruleError))
    }
  }

  const editValidationRule = (rule: ValidationRule) => {
    setRuleEditingId(rule._id)
    setRuleForm({
      name: rule.name,
      scope: rule.scope,
      severity: rule.severity,
      active: rule.active,
      requiredFields: rule.requiredFields.join(', '),
      message: rule.message,
    })
  }

  const deleteValidationRule = async (rule: ValidationRule) => {
    await api.delete(`/validation-rules/${rule._id}`)
    validationRulesState.refresh()
  }

  const evaluateOrderRules = async (order: HydratedOrder) => {
    const response = await api.post(`/orders/${order._id}/validation/evaluate`)
    setValidationFeedback(
      response.data.valid
        ? `${order.orderNumber} passed all blocking validation rules.`
        : `${order.orderNumber} failed ${response.data.blockingCount} blocking validation rule(s).`,
    )
  }

  const lockOrder = async (order: HydratedOrder) => {
    const reason = window.prompt('Enter the controlled lock reason')
    if (!reason) return
    await api.post(`/orders/${order._id}/lock`, { reason })
    ordersState.refresh()
  }

  const unlockOrder = async (order: HydratedOrder) => {
    const reason = window.prompt('Enter the unlock reason')
    if (!reason) return
    await api.post(`/orders/${order._id}/unlock`, { reason })
    ordersState.refresh()
  }

  const submitCorrection = async () => {
    if (!correctionOrderId || !correctionReason) return
    await api.post(`/orders/${correctionOrderId}/corrections`, {
      reason: correctionReason,
      changes: { notes: correctionNotes },
    })
    setCorrectionReason('')
    setCorrectionNotes('')
    const response = await api.get<OrderCorrection[]>(`/orders/${correctionOrderId}/corrections`)
    setCorrections(response.data)
  }

  const loadCorrections = async (orderId: string) => {
    setCorrectionOrderId(orderId)
    if (!orderId) {
      setCorrections([])
      return
    }
    const response = await api.get<OrderCorrection[]>(`/orders/${orderId}/corrections`)
    setCorrections(response.data)
  }

  const submitAmendment = async () => {
    if (!amendOrderId) return
    await api.post(`/orders/${amendOrderId}/amend`, {
      type: amendType,
      reason: amendReason,
      details: amendDetails,
    })
    setAmendReason('')
    setAmendDetails('')
    amendmentsState.refresh()
    ordersState.refresh()
  }

  const rejectSample = async () => {
    if (!sampleRejectId) return
    await api.post(`/samples/${sampleRejectId}/discrepancies`, {
      discrepancyType,
      severity: discrepancySeverity,
      description: sampleRejectReason,
      immediateAction: discrepancyAction,
      correctiveAction: 'Awaiting approval and CAPA owner review',
    })
    setSampleRejectId('')
    setSampleRejectReason('')
    samplesState.refresh()
    discrepancyState.refresh()
  }

  const decideDiscrepancy = async (entry: SampleDiscrepancyCase, decision: 'approve' | 'reject') => {
    const comment = window.prompt(`${decision === 'approve' ? 'Approval' : 'Rejection'} comment`)
    if (!comment) return
    await api.post(`/sample-discrepancies/${entry._id}/decision`, { decision, comment })
    discrepancyState.refresh()
    samplesState.refresh()
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Modules 1–5"
        title="Clinical operations"
        description="Order intake, billing control, specimen traceability, barcode governance, and pre-analytical operations."
      />

      <SectionCard title="1. OCR / NLP intake verification" description="Upload an image requisition or paste extracted text. The system scores the OCR result and requires human verification before order creation.">
        <Stack spacing={2}>
          {ocrError ? <Alert severity="error">{ocrError}</Alert> : null}
          {ocrSuccess ? <Alert severity="success">{ocrSuccess}</Alert> : null}
          <Button component="label" variant="outlined">
            {ocrFile ? `Selected: ${ocrFile.name}` : 'Upload image requisition'}
            <input
              hidden
              type="file"
              accept="image/*,text/plain"
              onChange={(event) => setOcrFile(event.target.files?.[0] ?? null)}
            />
          </Button>
          <TextField label="Fallback or extracted requisition text" multiline minRows={6} value={ocrText} onChange={(event) => setOcrText(event.target.value)} />
          <Stack direction="row" spacing={2} flexWrap="wrap">
            <Button variant="contained" onClick={submitOcrJob}>
              Create verification job
            </Button>
            <Button variant="text" onClick={() => ocrJobsState.refresh()}>Refresh queue</Button>
          </Stack>
          <TablePlaceholder loading={ocrJobsState.loading} />
          {ocrJobsState.error ? <Alert severity="error">{ocrJobsState.error}</Alert> : null}
          <Stack spacing={1.5} sx={{ maxHeight: 460, overflow: 'auto', pr: 1 }}>
            {ocrJobsState.data.map((job) => {
              const parsed = parseOcrJobPayload(job)
              const fieldConfidences = parseOcrFieldConfidences(job)
              return (
                <Paper key={job._id} sx={{ p: 2 }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                    <Box>
                      <Typography fontWeight={700}>
                        {parsed?.patient.firstName} {parsed?.patient.lastName} · {job.confidence}% confidence
                      </Typography>
                      <Typography color="text.secondary">
                        {job.status} · Tests: {parsed?.matchedTestCodes?.join(', ') || 'Needs test verification'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Field confidence: {Object.entries(fieldConfidences).map(([field, score]) => `${field} ${score}%`).join(' · ')}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button size="small" onClick={() => openOcrVerifier(job)}>Review</Button>
                      <Button size="small" disabled={job.status !== 'verified'} onClick={() => convertOcrJob(job)}>
                        Convert to order
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={job.status === 'converted_to_order' || job.status === 'rejected'}
                        onClick={async () => {
                          await api.post(`/intake/ocr/jobs/${job._id}/reject`, { reason: 'Rejected from clinical operations queue' })
                          ocrJobsState.refresh()
                        }}
                      >
                        Reject
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              )
            })}
          </Stack>
        </Stack>
      </SectionCard>

      <SectionCard title="1. No-code validation rules" description="Create blocking, warning, or informational rules without code. Use dot paths such as patient.dateOfBirth, clinicalHistory, testTypeIds, or financialClearance.">
        <Stack spacing={2}>
          {validationFeedback ? <Alert severity={validationFeedback.includes('failed') || validationFeedback.includes('Invalid') ? 'warning' : 'success'}>{validationFeedback}</Alert> : null}
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr 0.8fr' } }}>
            <TextField label="Rule name" value={ruleForm.name} onChange={(event) => setRuleForm((prev) => ({ ...prev, name: event.target.value }))} />
            <FormControl>
              <InputLabel>Scope</InputLabel>
              <Select label="Scope" value={ruleForm.scope} onChange={(event) => setRuleForm((prev) => ({ ...prev, scope: event.target.value as ValidationRule['scope'] }))}>
                {['order', 'specimen', 'result', 'report', 'finance'].map((scope) => (
                  <MenuItem key={scope} value={scope}>{scope}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Severity</InputLabel>
              <Select label="Severity" value={ruleForm.severity} onChange={(event) => setRuleForm((prev) => ({ ...prev, severity: event.target.value as ValidationRule['severity'] }))}>
                <MenuItem value="info">Info</MenuItem>
                <MenuItem value="warning">Warning</MenuItem>
                <MenuItem value="blocking">Blocking</MenuItem>
              </Select>
            </FormControl>
          </Box>
          <TextField label="Required field paths (comma-separated)" value={ruleForm.requiredFields} onChange={(event) => setRuleForm((prev) => ({ ...prev, requiredFields: event.target.value }))} />
          <TextField label="Message shown when rule fails" value={ruleForm.message} onChange={(event) => setRuleForm((prev) => ({ ...prev, message: event.target.value }))} />
          <FormControlLabel
            control={<Checkbox checked={ruleForm.active} onChange={(event) => setRuleForm((prev) => ({ ...prev, active: event.target.checked }))} />}
            label="Rule is active"
          />
          <Stack direction="row" spacing={1.5}>
            <Button variant="contained" onClick={saveValidationRule}>{ruleEditingId ? 'Update rule' : 'Create rule'}</Button>
            {ruleEditingId ? <Button onClick={() => setRuleEditingId(null)}>Cancel edit</Button> : null}
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Scope</TableCell>
                  <TableCell>Severity</TableCell>
                  <TableCell>Fields</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {validationRulesState.data.map((rule) => (
                  <TableRow key={rule._id}>
                    <TableCell>{rule.name}</TableCell>
                    <TableCell>{rule.scope}</TableCell>
                    <TableCell><Chip size="small" label={rule.severity} color={rule.severity === 'blocking' ? 'error' : rule.severity === 'warning' ? 'warning' : 'default'} /></TableCell>
                    <TableCell>{rule.requiredFields.join(', ')}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" onClick={() => editValidationRule(rule)}>Edit</Button>
                        <Button size="small" color="error" onClick={() => deleteValidationRule(rule)}>Delete</Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </SectionCard>

      <SectionCard title="1. Order validation, financial clearance, and locks" description="Review intake quality, evaluate no-code rules, clear billing, lock orders, or cancel controlled workflows.">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Validation</TableCell>
                <TableCell>Financial</TableCell>
                <TableCell>Lock</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ordersState.data.data.map((order) => (
                <TableRow key={order._id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell><StatusChip status={order.status} /></TableCell>
                  <TableCell>{order.validationStatus ?? 'pending'}</TableCell>
                  <TableCell>{order.financialClearance ?? 'pending'}</TableCell>
                  <TableCell>
                    <Chip size="small" label={order.lockStatus ?? 'unlocked'} color={order.lockStatus === 'locked' ? 'warning' : 'default'} />
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} flexWrap="wrap">
                      <Button
                        size="small"
                        onClick={() => evaluateOrderRules(order)}
                      >
                        Evaluate
                      </Button>
                      <Button
                        size="small"
                        startIcon={<CheckCircleRoundedIcon />}
                        onClick={async () => {
                          await api.post(`/orders/${order._id}/validate`, {
                            validationStatus: 'validated',
                            validationNotes: 'Validated from clinical operations center',
                          })
                          ordersState.refresh()
                        }}
                      >
                        Validate
                      </Button>
                      <Button
                        size="small"
                        color="success"
                        onClick={async () => {
                          await api.post(`/orders/${order._id}/financial-clearance`, {
                            financialClearance: 'cleared',
                          })
                          ordersState.refresh()
                        }}
                      >
                        Clear billing
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<CloseRoundedIcon />}
                        disabled={order.status === 'cancelled'}
                        onClick={async () => {
                          await api.post(`/orders/${order._id}/cancel`, {
                            reason: 'Cancelled from clinical operations center',
                          })
                          ordersState.refresh()
                        }}
                      >
                        Cancel
                      </Button>
                      {order.lockStatus === 'locked' ? (
                        <Button size="small" onClick={() => unlockOrder(order)}>Unlock</Button>
                      ) : (
                        <Button size="small" onClick={() => lockOrder(order)}>Lock</Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <SectionCard title="1. Amendments and add-on billing" description="Log structured amendments, add-ons, and cancellations against an order.">
        <Stack spacing={2}>
          <FormControl>
            <InputLabel>Order</InputLabel>
            <Select label="Order" value={amendOrderId} onChange={(event) => setAmendOrderId(String(event.target.value))}>
              {orderOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <InputLabel>Action type</InputLabel>
            <Select label="Action type" value={amendType} onChange={(event) => setAmendType(event.target.value as typeof amendType)}>
              <MenuItem value="amendment">Amendment</MenuItem>
              <MenuItem value="add_on">Add-on</MenuItem>
              <MenuItem value="cancellation">Cancellation note</MenuItem>
            </Select>
          </FormControl>
          <TextField label="Reason" value={amendReason} onChange={(event) => setAmendReason(event.target.value)} />
          <TextField label="Details" multiline minRows={3} value={amendDetails} onChange={(event) => setAmendDetails(event.target.value)} />
          <Button variant="contained" onClick={submitAmendment}>
            Save amendment
          </Button>
          <Typography variant="subtitle2">Recent amendments</Typography>
          <Stack spacing={1.5}>
            {amendmentsState.data.map((entry) => (
              <Paper key={entry._id} sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1.5}>
                  <Box>
                    <Typography fontWeight={700}>{entry.type} · {entry.status ?? 'applied'}</Typography>
                    <Typography>{entry.reason}</Typography>
                    <Typography color="text.secondary">{entry.details}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Approvals {formatApprovalProgress(entry.approvals, entry.requiredApprovals ?? 1)} · Policy {entry.policyLevel ?? 'standard'}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button
                      size="small"
                      disabled={(entry.status ?? 'applied') === 'applied' || entry.status === 'rejected'}
                      onClick={async () => {
                        await api.post(`/order-amendments/${entry._id}/approve`)
                        amendmentsState.refresh()
                        ordersState.refresh()
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={(entry.status ?? 'applied') === 'applied' || entry.status === 'rejected'}
                      onClick={async () => {
                        const reason = window.prompt('Rejection reason')
                        if (!reason) return
                        await api.post(`/order-amendments/${entry._id}/reject`, { reason })
                        amendmentsState.refresh()
                      }}
                    >
                      Reject
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Stack>
      </SectionCard>

      <SectionCard title="1. Controlled correction workflow" description="For locked, completed, released, or legally sensitive orders, submit a correction request instead of direct editing.">
        <Stack spacing={2}>
          <FormControl>
            <InputLabel>Order</InputLabel>
            <Select label="Order" value={correctionOrderId} onChange={(event) => loadCorrections(String(event.target.value))}>
              {orderOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Correction reason" value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} />
          <TextField label="Corrected order notes" multiline minRows={3} value={correctionNotes} onChange={(event) => setCorrectionNotes(event.target.value)} />
          <Button variant="contained" onClick={submitCorrection}>Submit correction request</Button>
          <Stack spacing={1.5} sx={{ maxHeight: 360, overflow: 'auto', pr: 1 }}>
            {corrections.map((entry) => (
              <Paper key={entry._id} sx={{ p: 2 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} justifyContent="space-between">
                  <Box>
                    <Typography fontWeight={700}>{entry.reason}</Typography>
                    <Typography color="text.secondary">
                      {entry.status} · Approvals {formatApprovalProgress(entry.approvals, entry.requiredApprovals)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">{entry.changes}</Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      disabled={entry.status !== 'pending'}
                      onClick={async () => {
                        await api.post(`/orders/${entry.orderId}/corrections/${entry._id}/approve`)
                        await loadCorrections(entry.orderId)
                        ordersState.refresh()
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      disabled={entry.status !== 'pending'}
                      onClick={async () => {
                        const reason = window.prompt('Rejection reason')
                        if (!reason) return
                        await api.post(`/orders/${entry.orderId}/corrections/${entry._id}/reject`, { reason })
                        await loadCorrections(entry.orderId)
                      }}
                    >
                      Reject
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Stack>
      </SectionCard>

      <ResourceSection<InsuranceAuthorization>
        title="2. Insurance & pre-authorization"
        description="Manage insurance approvals, pre-auth codes, and approved amounts."
        endpoint="/insurance-authorizations"
        initialValues={{
          orderId: orderOptions[0]?.value ?? '',
          payerName: '',
          policyNumber: '',
          preAuthCode: '',
          status: 'pending',
          approvedAmount: 0,
          notes: '',
        }}
        fields={[
          { key: 'orderId', label: 'Order', type: 'select', options: orderOptions },
          { key: 'payerName', label: 'Payer', type: 'text' },
          { key: 'policyNumber', label: 'Policy number', type: 'text' },
          { key: 'preAuthCode', label: 'Pre-auth code', type: 'text' },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Pending', value: 'pending' },
              { label: 'Approved', value: 'approved' },
              { label: 'Denied', value: 'denied' },
            ],
          },
          { key: 'approvedAmount', label: 'Approved amount', type: 'number' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        columns={[
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Payer', render: (row) => row.payerName },
          { label: 'Status', render: (row) => row.status },
          { label: 'Approved', render: (row) => formatMoney(row.approvedAmount) },
        ]}
      />

      <ResourceSection<Invoice>
        title="2. Invoices"
        description="Issue invoices and track billing gateway decisions for each order."
        endpoint="/invoices"
        initialValues={{
          orderId: orderOptions[0]?.value ?? '',
          invoiceNumber: '',
          subtotal: 0,
          adjustmentAmount: 0,
          total: 0,
          status: 'draft',
          paymentGateway: 'cash',
          issuedAt: '2026-03-31',
        }}
        fields={[
          { key: 'orderId', label: 'Order', type: 'select', options: orderOptions },
          { key: 'invoiceNumber', label: 'Invoice number', type: 'text' },
          { key: 'subtotal', label: 'Subtotal', type: 'number' },
          { key: 'adjustmentAmount', label: 'Adjustment', type: 'number' },
          { key: 'total', label: 'Total', type: 'number' },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Issued', value: 'issued' },
              { label: 'Paid', value: 'paid' },
              { label: 'Refunded', value: 'refunded' },
            ],
          },
          {
            key: 'paymentGateway',
            label: 'Gateway',
            type: 'select',
            options: [
              { label: 'Cash', value: 'cash' },
              { label: 'Card', value: 'card' },
              { label: 'M-Pesa', value: 'mpesa' },
              { label: 'Maviance', value: 'maviance' },
              { label: 'Bank transfer', value: 'bank_transfer' },
              { label: 'Insurance', value: 'insurance' },
            ],
          },
          { key: 'issuedAt', label: 'Issued at', type: 'date' },
        ]}
        columns={[
          { label: 'Invoice', render: (row) => row.invoiceNumber },
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Status', render: (row) => row.status },
          { label: 'Total', render: (row) => formatMoney(row.total) },
        ]}
      />

      <ResourceSection<RefundAdjustment>
        title="2. Refunds and adjustments"
        description="Capture credits, refunds, and billing adjustments with approvals."
        endpoint="/refunds"
        initialValues={{
          orderId: orderOptions[0]?.value ?? '',
          invoiceId: '',
          type: 'refund',
          amount: 0,
          reason: '',
          status: 'pending',
        }}
        fields={[
          { key: 'orderId', label: 'Order', type: 'select', options: orderOptions },
          { key: 'invoiceId', label: 'Invoice ID', type: 'text' },
          {
            key: 'type',
            label: 'Type',
            type: 'select',
            options: [
              { label: 'Refund', value: 'refund' },
              { label: 'Adjustment', value: 'adjustment' },
            ],
          },
          { key: 'amount', label: 'Amount', type: 'number' },
          { key: 'reason', label: 'Reason', type: 'textarea' },
        ]}
        columns={[
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Type', render: (row) => row.type },
          { label: 'Amount', render: (row) => formatMoney(row.amount) },
          { label: 'Status', render: (row) => <Chip size="small" label={`${row.status} ${formatApprovalProgress(row.approvals, row.requiredApprovals ?? 2)}`} color={row.status === 'completed' ? 'success' : row.status === 'rejected' ? 'error' : 'warning'} /> },
        ]}
        rowActions={[
          {
            label: 'Approve',
            disabled: (row) => row.status !== 'pending',
            onClick: async (row) => {
              await api.post(`/refunds/${row._id}/approve`)
            },
          },
          {
            label: 'Complete',
            disabled: (row) => row.status !== 'approved',
            onClick: async (row) => {
              await api.post(`/refunds/${row._id}/complete`)
            },
          },
          {
            label: 'Reject',
            color: 'error',
            disabled: (row) => row.status !== 'pending',
            onClick: async (row) => {
              const reason = window.prompt('Rejection reason')
              if (!reason) return
              await api.post(`/refunds/${row._id}/reject`, { reason })
            },
          },
        ]}
      />

      <ResourceSection<BarcodeRecord>
        title="3–4. Barcode pool and traceability"
        description="Manage GS1 barcode allocation, lifecycle, and justified reprints."
        endpoint="/barcodes"
        initialValues={{
          code: '',
          symbology: 'gs1_128',
          entityType: 'specimen',
          entityId: sampleOptions[0]?.value ?? '',
          status: 'unassigned',
          templateId: '',
          justification: '',
          printedAt: '',
        }}
        fields={[
          { key: 'code', label: 'Barcode', type: 'text' },
          {
            key: 'symbology',
            label: 'Symbology',
            type: 'select',
            options: [
              { label: 'GS1-128', value: 'gs1_128' },
              { label: 'QR', value: 'qr' },
              { label: 'Code128', value: 'code128' },
            ],
          },
          {
            key: 'entityType',
            label: 'Entity type',
            type: 'select',
            options: [
              { label: 'Specimen', value: 'specimen' },
              { label: 'Block', value: 'block' },
              { label: 'Slide', value: 'slide' },
              { label: 'Case', value: 'case' },
            ],
          },
          { key: 'entityId', label: 'Entity ID', type: 'text' },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Unassigned', value: 'unassigned' },
              { label: 'Assigned', value: 'assigned' },
              { label: 'Printed', value: 'printed' },
              { label: 'Archived', value: 'archived' },
            ],
          },
          { key: 'templateId', label: 'Template ID', type: 'text' },
          { key: 'justification', label: 'Justification', type: 'textarea' },
        ]}
        columns={[
          { label: 'Code', render: (row) => row.code },
          { label: 'Entity', render: (row) => `${row.entityType} · ${row.entityId ?? '—'}` },
          { label: 'Status', render: (row) => row.status },
          { label: 'Symbology', render: (row) => row.symbology },
        ]}
        rowActions={[
          {
            label: 'Reprint',
            icon: <ReplayRoundedIcon />,
            onClick: async (row) => {
              await api.post(`/barcodes/${row._id}/reprint`, {
                justification: 'Reprinted from barcode governance center',
              })
            },
          },
          {
            label: 'Print',
            onClick: async (row) => {
              await api.post(`/barcodes/${row._id}/print`, {
                justification: 'Browser print from barcode governance center',
              })
              printBarcodeLabel(row)
            },
          },
          {
            label: 'Archive',
            color: 'error',
            disabled: (row) => row.status === 'archived',
            onClick: async (row) => {
              const justification = window.prompt('Archive justification')
              if (!justification) return
              await api.post(`/barcodes/${row._id}/archive`, { justification })
            },
          },
        ]}
      />

      <ResourceSection<LabelTemplateRecord>
        title="4. Label templates and printer rules"
        description="Configure printers, label templates, and scan-enforcement behavior."
        endpoint="/label-templates"
        initialValues={{
          name: '',
          printerName: '',
          templateType: 'specimen',
          scanEnforced: true,
          requireGs1: true,
        }}
        fields={[
          { key: 'name', label: 'Template name', type: 'text' },
          { key: 'printerName', label: 'Printer', type: 'text' },
          {
            key: 'templateType',
            label: 'Template type',
            type: 'select',
            options: [
              { label: 'Specimen', value: 'specimen' },
              { label: 'Block', value: 'block' },
              { label: 'Slide', value: 'slide' },
              { label: 'Case', value: 'case' },
            ],
          },
          { key: 'scanEnforced', label: 'Scan enforced', type: 'checkbox' },
          { key: 'requireGs1', label: 'Require GS1 Application Identifiers', type: 'checkbox' },
        ]}
        columns={[
          { label: 'Template', render: (row) => row.name },
          { label: 'Printer', render: (row) => row.printerName },
          { label: 'Type', render: (row) => row.templateType },
          { label: 'Scan rule', render: (row) => `${row.scanEnforced ? 'Enforced' : 'Optional'} · ${row.requireGs1 ? 'GS1' : 'Non-GS1 allowed'}` },
        ]}
      />

      <ResourceSection<ChainOfCustodyEvent>
        title="3. Chain of custody"
        description="Capture specimen hand-offs, conditions, and locations across the journey."
        endpoint="/chain-of-custody"
        initialValues={{
          specimenId: sampleOptions[0]?.value ?? '',
          eventType: 'collected',
          location: '',
          condition: '',
          actor: '',
          notes: '',
        }}
        fields={[
          { key: 'specimenId', label: 'Specimen', type: 'select', options: sampleOptions },
          {
            key: 'eventType',
            label: 'Event type',
            type: 'select',
            options: [
              { label: 'Collected', value: 'collected' },
              { label: 'Picked up', value: 'picked_up' },
              { label: 'Received', value: 'received' },
              { label: 'Aliquoted', value: 'aliquoted' },
              { label: 'Transferred', value: 'transferred' },
              { label: 'Rejected', value: 'rejected' },
            ],
          },
          { key: 'location', label: 'Location', type: 'text' },
          { key: 'condition', label: 'Condition', type: 'text' },
          { key: 'actor', label: 'Actor', type: 'text' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        columns={[
          { label: 'Specimen', render: (row) => row.specimenId },
          { label: 'Event', render: (row) => row.eventType },
          { label: 'Location', render: (row) => row.location },
          { label: 'At', render: (row) => formatDateTime(row.createdAt) },
        ]}
      />

      <SectionCard title="3. Sample rejection and discrepancy handling" description="Open controlled discrepancy cases with severity, required approvals, CAPA linkage, and chain-of-custody impact.">
        <Stack spacing={2}>
          <FormControl>
            <InputLabel>Sample</InputLabel>
            <Select label="Sample" value={sampleRejectId} onChange={(event) => setSampleRejectId(String(event.target.value))}>
              {sampleOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <InputLabel>Discrepancy type</InputLabel>
            <Select label="Discrepancy type" value={discrepancyType} onChange={(event) => setDiscrepancyType(String(event.target.value) as SampleDiscrepancyCase['discrepancyType'])}>
              {['identity_mismatch', 'unlabeled', 'leaking_container', 'insufficient_volume', 'temperature_excursion', 'transport_delay', 'wrong_container', 'missing_requisition', 'other'].map((value) => (
                <MenuItem key={value} value={value}>{value.replaceAll('_', ' ')}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl>
            <InputLabel>Severity</InputLabel>
            <Select label="Severity" value={discrepancySeverity} onChange={(event) => setDiscrepancySeverity(String(event.target.value) as SampleDiscrepancyCase['severity'])}>
              <MenuItem value="minor">Minor</MenuItem>
              <MenuItem value="major">Major</MenuItem>
              <MenuItem value="critical">Critical</MenuItem>
            </Select>
          </FormControl>
          <FormControl>
            <InputLabel>Immediate action</InputLabel>
            <Select label="Immediate action" value={discrepancyAction} onChange={(event) => setDiscrepancyAction(String(event.target.value) as SampleDiscrepancyCase['immediateAction'])}>
              <MenuItem value="quarantine">Quarantine</MenuItem>
              <MenuItem value="reject">Reject</MenuItem>
              <MenuItem value="accept_with_deviation">Accept with deviation</MenuItem>
              <MenuItem value="request_recollection">Request recollection</MenuItem>
            </Select>
          </FormControl>
          <TextField label="Discrepancy description" value={sampleRejectReason} onChange={(event) => setSampleRejectReason(event.target.value)} />
          <Button variant="contained" color="error" onClick={rejectSample}>
            Open discrepancy case
          </Button>
          {discrepancyState.data.length ? (
            <TableContainer sx={{ maxHeight: 360 }}>
              <Table stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Sample</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Severity</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Approvals</TableCell>
                    <TableCell>Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {discrepancyState.data.slice(0, 10).map((entry) => (
                    <TableRow key={entry._id}>
                      <TableCell>{entry.sampleId}</TableCell>
                      <TableCell>{entry.discrepancyType}</TableCell>
                      <TableCell>{entry.severity}</TableCell>
                      <TableCell>{entry.status}</TableCell>
                      <TableCell>{entry.approvals.length}/{entry.requiredApprovals}</TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={1}>
                          <Button size="small" disabled={entry.status !== 'awaiting_approval'} onClick={() => decideDiscrepancy(entry, 'approve')}>Approve</Button>
                          <Button size="small" color="error" disabled={entry.status !== 'awaiting_approval'} onClick={() => decideDiscrepancy(entry, 'reject')}>Reject</Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : null}
        </Stack>
      </SectionCard>

      <ResourceSection<PreAnalyticsLog>
        title="5. Pre-analytical tracking"
        description="Track collection, pickup, transport conditions, receipt validation, and pre-analytical turnaround."
        endpoint="/preanalytics/logs"
        initialValues={{
          orderId: orderOptions[0]?.value ?? '',
          specimenId: sampleOptions[0]?.value ?? '',
          collectionAt: '2026-03-31',
          pickupAt: '2026-03-31',
          receiptAt: '2026-03-31',
          transportTemperature: '',
          transportCondition: '',
          receiptValidated: true,
          tatMinutes: 0,
        }}
        fields={[
          { key: 'orderId', label: 'Order', type: 'select', options: orderOptions },
          { key: 'specimenId', label: 'Specimen', type: 'select', options: sampleOptions },
          { key: 'collectionAt', label: 'Collected at', type: 'date' },
          { key: 'pickupAt', label: 'Picked up at', type: 'date' },
          { key: 'receiptAt', label: 'Received at', type: 'date' },
          { key: 'transportTemperature', label: 'Temperature', type: 'text' },
          { key: 'transportCondition', label: 'Transport condition', type: 'text' },
          { key: 'receiptValidated', label: 'Receipt validated', type: 'checkbox' },
          { key: 'tatMinutes', label: 'TAT (minutes)', type: 'number' },
        ]}
        columns={[
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Specimen', render: (row) => row.specimenId ?? '—' },
          { label: 'Condition', render: (row) => row.transportCondition },
          { label: 'TAT', render: (row) => `${row.tatMinutes} min` },
        ]}
      />

      <SectionCard title="5. Courier provider and temperature telemetry" description="Live-provider dispatch and device-sourced temperature logs land here through integration webhooks. Lists are capped to keep the card scrollable.">
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">Provider</Typography>
            <Typography variant="h6">{courierTelemetryState.data.provider || 'generic_webhook'}</Typography>
            <Typography color="text.secondary">{courierTelemetryState.data.dispatchConfigured ? 'Dispatch endpoint configured' : 'Awaiting provider URL/API key'}</Typography>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">Courier events</Typography>
            <Typography variant="h6">{courierTelemetryState.data.events.length}</Typography>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">Temperature logs</Typography>
            <Typography variant="h6">{courierTelemetryState.data.temperatureLogs.length}</Typography>
          </Paper>
        </Box>
        <TableContainer sx={{ mt: 2, maxHeight: 340 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Type</TableCell>
                <TableCell>Order / sample</TableCell>
                <TableCell>Status / temp</TableCell>
                <TableCell>When</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {courierTelemetryState.data.events.slice(0, 10).map((event) => (
                <TableRow key={event._id}>
                  <TableCell>{event.eventType}</TableCell>
                  <TableCell>{event.orderId}</TableCell>
                  <TableCell>{event.status}</TableCell>
                  <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                </TableRow>
              ))}
              {courierTelemetryState.data.temperatureLogs.slice(0, 10).map((log) => (
                <TableRow key={log._id}>
                  <TableCell>temperature</TableCell>
                  <TableCell>{log.orderId ?? log.sampleId ?? '—'}</TableCell>
                  <TableCell>{log.temperatureCelsius}C · {log.withinRange ? 'within range' : 'excursion'}</TableCell>
                  <TableCell>{formatDateTime(log.recordedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={Boolean(ocrVerifyJob)} onClose={() => setOcrVerifyJob(null)} maxWidth="md" fullWidth>
        <DialogTitle>Human verification for OCR intake</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="info">
              Confirm and correct the parsed JSON before saving. The order conversion endpoint will not run until this verification is completed.
            </Alert>
            <TextField
              label="Verified parsed payload"
              multiline
              minRows={12}
              value={ocrVerifyText}
              onChange={(event) => setOcrVerifyText(event.target.value)}
            />
            {ocrVerifyJob ? (
              <TextField label="Raw OCR text" multiline minRows={6} value={ocrVerifyJob.rawText} InputProps={{ readOnly: true }} />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOcrVerifyJob(null)}>Cancel</Button>
          <Button variant="contained" onClick={verifyOcrJob}>Save human verification</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function AnalyticalOperationsPage() {
  const accessionsState = useLoadable<any[]>([], [], async () => {
    const response = await api.get('/accessions')
    return response.data
  })
  const cytologyCasesState = useLoadable<CytologyCase[]>([], [], async () => {
    const response = await api.get('/cytology/cases')
    return response.data
  })
  const digitalSlidesState = useLoadable<DigitalSlideRecord[]>([], [], async () => {
    const response = await api.get<DigitalSlideRecord[]>('/digital-slides')
    return response.data
  })
  const specialStainState = useLoadable<SpecialStainRequest[]>([], [], async () => {
    const response = await api.get<SpecialStainRequest[]>('/special-stains')
    return response.data
  })
  const aiModelsState = useLoadable<AiModelRegistryRecord[]>([], [], async () => {
    const response = await api.get<AiModelRegistryRecord[]>('/ai/models')
    return response.data
  })

  const accessionOptions = accessionsState.data.map((accession) => ({
    label: accession.accessionId,
    value: accession._id,
  }))
  const cytologyOptions = cytologyCasesState.data.map((entry) => ({
    label: entry.caseNumber,
    value: entry._id,
  }))
  const slideOptions = digitalSlidesState.data.map((entry) => ({
    label: entry.slideId,
    value: entry.slideId,
  }))

  const approveSpecialStain = async (request: SpecialStainRequest) => {
    await api.post(`/special-stains/${request._id}/approve`, { decision: 'approve', reason: 'Approved from analytical operations' })
    specialStainState.refresh()
  }

  const completeSpecialStain = async (request: SpecialStainRequest) => {
    await api.post(`/special-stains/${request._id}/complete`, {
      controlSlideStatus: 'pass',
      lotNumber: request.lotNumber ?? '',
      quantity: 1,
      scannedCode: request.slideId,
      qcNotes: 'Completed from analytical operations work queue',
    })
    specialStainState.refresh()
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Modules 6–11"
        title="Analytical laboratory modules"
        description="Histopathology, cytology, IHC, digital pathology, AI support, and analyzer integrations."
      />

      <ResourceSection<HistologyWorklistItem>
        title="6. Histology recuts, special stains, and worklists"
        description="Drive bench assignments for recuts and special stains beyond the main histology line."
        endpoint="/histology/worklist"
        initialValues={{
          accessionId: accessionOptions[0]?.value ?? '',
          taskType: 'special_stain',
          status: 'pending',
          assignedTo: '',
          notes: '',
        }}
        fields={[
          { key: 'accessionId', label: 'Accession', type: 'select', options: accessionOptions },
          {
            key: 'taskType',
            label: 'Task type',
            type: 'select',
            options: [
              { label: 'Grossing', value: 'grossing' },
              { label: 'Processing', value: 'processing' },
              { label: 'Embedding', value: 'embedding' },
              { label: 'Sectioning', value: 'sectioning' },
              { label: 'Staining', value: 'staining' },
              { label: 'Re-cut', value: 'recut' },
              { label: 'Special stain', value: 'special_stain' },
            ],
          },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Pending', value: 'pending' },
              { label: 'In progress', value: 'in_progress' },
              { label: 'Complete', value: 'complete' },
            ],
          },
          { key: 'assignedTo', label: 'Assigned to', type: 'text' },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        columns={[
          { label: 'Accession', render: (row) => row.accessionId },
          { label: 'Task', render: (row) => row.taskType },
          { label: 'Status', render: (row) => row.status },
          { label: 'Assigned', render: (row) => row.assignedTo ?? '—' },
        ]}
      />

      <SectionCard title="6 & 8. Controlled recuts and special stains" description="Requests require approval before completion, block on failed control slides, and draw down released inventory lots.">
        <TableContainer sx={{ maxHeight: 360 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Slide</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Stain</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Billing</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {specialStainState.data.slice(0, 10).map((request) => (
                <TableRow key={request._id}>
                  <TableCell>{request.slideId}</TableCell>
                  <TableCell>{request.requestType}</TableCell>
                  <TableCell>{request.stainName}</TableCell>
                  <TableCell>{request.status}</TableCell>
                  <TableCell>{request.billingReference ?? '—'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button size="small" disabled={request.status !== 'requested'} onClick={() => approveSpecialStain(request)}>Approve</Button>
                      <Button size="small" disabled={!['approved', 'requested'].includes(request.status)} onClick={() => completeSpecialStain(request)}>Complete</Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <ResourceSection<CytologyQualityRecord>
        title="7. Cytopathology routing and QC"
        description="Track GYN vs Non-GYN routing, preparation types, and cytology-specific QC decisions."
        endpoint="/cytology/qc"
        initialValues={{
          cytologyCaseId: cytologyOptions[0]?.value ?? '',
          routeType: 'gyn',
          preparationType: 'smear',
          qcStatus: 'pending',
          qcNotes: '',
        }}
        fields={[
          { key: 'cytologyCaseId', label: 'Cytology case', type: 'select', options: cytologyOptions },
          {
            key: 'routeType',
            label: 'Route',
            type: 'select',
            options: [
              { label: 'GYN', value: 'gyn' },
              { label: 'Non-GYN', value: 'non_gyn' },
            ],
          },
          {
            key: 'preparationType',
            label: 'Preparation',
            type: 'select',
            options: [
              { label: 'Smear', value: 'smear' },
              { label: 'Cell block', value: 'cell_block' },
              { label: 'Liquid based', value: 'liquid_based' },
            ],
          },
          {
            key: 'qcStatus',
            label: 'QC status',
            type: 'select',
            options: [
              { label: 'Pending', value: 'pending' },
              { label: 'Pass', value: 'pass' },
              { label: 'Fail', value: 'fail' },
            ],
          },
          { key: 'qcNotes', label: 'QC notes', type: 'textarea' },
        ]}
        columns={[
          { label: 'Case', render: (row) => row.cytologyCaseId },
          { label: 'Route', render: (row) => row.routeType },
          { label: 'Preparation', render: (row) => row.preparationType },
          { label: 'QC', render: (row) => row.qcStatus },
        ]}
      />

      <ResourceSection<AntibodyInventoryItem>
        title="8. IHC antibody inventory and QC"
        description="Manage antibody lots, expiries, control slides, and reagent usage metrics."
        endpoint="/ihc/inventory"
        initialValues={{
          antibody: '',
          clone: '',
          lotNumber: '',
          quantity: 0,
          unit: 'vials',
          expiresAt: '2026-12-31',
          controlSlideTracked: true,
          qcStatus: 'pass',
          usageCount: 0,
        }}
        fields={[
          { key: 'antibody', label: 'Antibody', type: 'text' },
          { key: 'clone', label: 'Clone', type: 'text' },
          { key: 'lotNumber', label: 'Lot number', type: 'text' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'unit', label: 'Unit', type: 'text' },
          { key: 'expiresAt', label: 'Expiry', type: 'date' },
          { key: 'controlSlideTracked', label: 'Control slide tracked', type: 'checkbox' },
          {
            key: 'qcStatus',
            label: 'QC status',
            type: 'select',
            options: [
              { label: 'Pass', value: 'pass' },
              { label: 'Hold', value: 'hold' },
              { label: 'Fail', value: 'fail' },
            ],
          },
          { key: 'usageCount', label: 'Usage count', type: 'number' },
        ]}
        columns={[
          { label: 'Antibody', render: (row) => `${row.antibody} (${row.clone})` },
          { label: 'Lot', render: (row) => row.lotNumber },
          { label: 'QC', render: (row) => row.qcStatus },
          { label: 'Usage', render: (row) => row.usageCount },
        ]}
      />

      <ResourceSection<DigitalSlideRecord>
        title="9. Digital pathology ownership and sign-out"
        description="Capture WSI metadata, viewer launch links, slide ownership, and digital sign-out state."
        endpoint="/digital-slides"
        initialValues={{
          orderId: '',
          slideId: slideOptions[0]?.value ?? '',
          scannerVendor: '',
          metadata: '',
          viewerUrl: '',
          ownerId: '',
          signOutStatus: 'pending',
        }}
        fields={[
          { key: 'orderId', label: 'Order ID', type: 'text' },
          { key: 'slideId', label: 'Slide ID', type: 'text' },
          { key: 'scannerVendor', label: 'Scanner vendor', type: 'text' },
          { key: 'metadata', label: 'Metadata', type: 'textarea' },
          { key: 'viewerUrl', label: 'Viewer URL', type: 'text' },
          { key: 'ownerId', label: 'Owner ID', type: 'text' },
          {
            key: 'signOutStatus',
            label: 'Sign-out',
            type: 'select',
            options: [
              { label: 'Pending', value: 'pending' },
              { label: 'Reviewed', value: 'reviewed' },
              { label: 'Signed out', value: 'signed_out' },
            ],
          },
        ]}
        columns={[
          { label: 'Slide', render: (row) => row.slideId },
          { label: 'Scanner', render: (row) => row.scannerVendor },
          { label: 'Owner', render: (row) => row.ownerId ?? '—' },
          { label: 'Status', render: (row) => row.signOutStatus },
        ]}
        rowActions={[
          {
            label: 'Claim',
            onClick: async (row) => {
              await api.post(`/digital-slides/${row._id}/claim`, { reason: 'Analytical operations ownership review' })
            },
          },
          {
            label: 'Lock sign-out',
            onClick: async (row) => {
              await api.post(`/digital-slides/${row._id}/signout-lock`, { reason: 'Analytical operations sign-out control' })
            },
          },
        ]}
      />

      <SectionCard title="10. AI model registry and clinical-use gate" description="Only models documented as clinically validated can be enabled for diagnostic use. Local free-mode AI remains QC/research only.">
        <TableContainer sx={{ maxHeight: 320 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Model</TableCell>
                <TableCell>Provider</TableCell>
                <TableCell>Validation</TableCell>
                <TableCell>Clinical use</TableCell>
                <TableCell>Notes</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {aiModelsState.data.slice(0, 10).map((model) => (
                <TableRow key={model._id}>
                  <TableCell>{model.name} v{model.version}</TableCell>
                  <TableCell>{model.provider}</TableCell>
                  <TableCell>{model.validationStatus}</TableCell>
                  <TableCell>{model.clinicalUseAllowed ? 'Allowed' : 'Blocked'}</TableCell>
                  <TableCell>{model.notes}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <ResourceSection<AiAnalysisResult>
        title="10. AI decision support"
        description="Log AI QC and quantitative analysis with versioning, explainability, and acceptance decisions."
        endpoint="/ai-results"
        initialValues={{
          slideId: slideOptions[0]?.value ?? '',
          analysisType: 'qc',
          version: 'v1.0.0',
          score: '',
          explainability: '',
          status: 'pending',
        }}
        fields={[
          { key: 'slideId', label: 'Slide', type: 'select', options: slideOptions },
          {
            key: 'analysisType',
            label: 'Analysis',
            type: 'select',
            options: [
              { label: 'QC', value: 'qc' },
              { label: 'Ki67', value: 'ki67' },
              { label: 'IHC scoring', value: 'ihc_scoring' },
              { label: 'Tumor detection', value: 'tumor_detection' },
            ],
          },
          { key: 'version', label: 'Model version', type: 'text' },
          { key: 'score', label: 'Score', type: 'text' },
          { key: 'explainability', label: 'Explainability', type: 'textarea' },
          {
            key: 'status',
            label: 'Decision',
            type: 'select',
            options: [
              { label: 'Pending', value: 'pending' },
              { label: 'Accepted', value: 'accepted' },
              { label: 'Rejected', value: 'rejected' },
            ],
          },
        ]}
        columns={[
          { label: 'Slide', render: (row) => row.slideId },
          { label: 'Type', render: (row) => row.analysisType },
          { label: 'Version', render: (row) => row.version },
          { label: 'Decision', render: (row) => row.status },
        ]}
      />

      <ResourceSection<InstrumentConnection>
        title="11. Instrument connectors"
        description="Register analyzer interfaces, protocols, status, and synchronization direction."
        endpoint="/instruments"
        initialValues={{
          name: '',
          protocol: 'HL7',
          status: 'online',
          lastSyncAt: '2026-03-31',
          bidirectional: true,
        }}
        fields={[
          { key: 'name', label: 'Instrument', type: 'text' },
          {
            key: 'protocol',
            label: 'Protocol',
            type: 'select',
            options: [
              { label: 'HL7', value: 'HL7' },
              { label: 'FHIR', value: 'FHIR' },
              { label: 'REST', value: 'REST' },
            ],
          },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Online', value: 'online' },
              { label: 'Offline', value: 'offline' },
              { label: 'Degraded', value: 'degraded' },
            ],
          },
          { key: 'lastSyncAt', label: 'Last sync', type: 'date' },
          { key: 'bidirectional', label: 'Bidirectional', type: 'checkbox' },
        ]}
        columns={[
          { label: 'Instrument', render: (row) => row.name },
          { label: 'Protocol', render: (row) => row.protocol },
          { label: 'Status', render: (row) => row.status },
          { label: 'Bi-directional', render: (row) => (row.bidirectional ? 'Yes' : 'No') },
        ]}
      />

      <ResourceSection<InstrumentRunLog>
        title="11. Analyzer run logs"
        description="Track run outcomes, analyzer QC, and downtime for instrument integrations."
        endpoint="/instrument-runs"
        initialValues={{
          instrumentId: '',
          runType: '',
          qcStatus: 'pass',
          downtimeMinutes: 0,
          errorMessage: '',
        }}
        fields={[
          { key: 'instrumentId', label: 'Instrument ID', type: 'text' },
          { key: 'runType', label: 'Run type', type: 'text' },
          {
            key: 'qcStatus',
            label: 'QC status',
            type: 'select',
            options: [
              { label: 'Pass', value: 'pass' },
              { label: 'Fail', value: 'fail' },
              { label: 'Warning', value: 'warning' },
            ],
          },
          { key: 'downtimeMinutes', label: 'Downtime (min)', type: 'number' },
          { key: 'errorMessage', label: 'Error log', type: 'textarea' },
        ]}
        columns={[
          { label: 'Instrument', render: (row) => row.instrumentId },
          { label: 'Run type', render: (row) => row.runType },
          { label: 'QC', render: (row) => row.qcStatus },
          { label: 'Downtime', render: (row) => `${row.downtimeMinutes} min` },
        ]}
      />
    </Stack>
  )
}

export function ResultsQualityPage() {
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const reportsState = useLoadable<Array<{ order: HydratedOrder; report: Report }>>([], [], async () => {
    const response = await api.get('/reports')
    return response.data
  })
  const tatSummaryState = useLoadable<TatSummary | null>(null, [], async () => {
    const response = await api.get<TatSummary>('/tat/summary')
    return response.data
  })

  const orderOptions = ordersState.data.data.map((order) => ({
    label: `${order.orderNumber} · ${order.patient.firstName} ${order.patient.lastName}`,
    value: order._id,
  }))

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Modules 12–15"
        title="Results, communication, and quality"
        description="Reporting, communications, QA/QC controls, and turnaround-time monitoring."
      />

      <SectionCard title="12. Report governance" description="Existing reporting remains live, with digital sign-out and addendum controls added here.">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Report status</TableCell>
                <TableCell>Signed</TableCell>
                <TableCell>Release rule</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reportsState.data.map((entry) => (
                <TableRow key={entry.order._id}>
                  <TableCell>{entry.order.orderNumber}</TableCell>
                  <TableCell>{entry.report.status}</TableCell>
                  <TableCell>{entry.report.signedBy ?? 'Not signed'}</TableCell>
                  <TableCell>{entry.report.releaseRuleStatus ?? 'pending'}</TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        startIcon={<SecurityRoundedIcon />}
                        onClick={async () => {
                          await api.post(`/reports/${entry.order._id}/sign`)
                          reportsState.refresh()
                        }}
                      >
                        Sign
                      </Button>
                      <Button
                        size="small"
                        onClick={async () => {
                          await api.post(`/reports/${entry.order._id}/addendum`, {
                            note: 'Addendum recorded from results governance page',
                          })
                          reportsState.refresh()
                        }}
                      >
                        Add addendum
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <ResourceSection<ReportTemplateRecord>
        title="12. Report templates"
        description="Maintain narrative and synoptic report templates for sign-out."
        endpoint="/report-templates"
        initialValues={{
          name: '',
          reportType: 'narrative',
          body: '',
          active: true,
        }}
        fields={[
          { key: 'name', label: 'Template name', type: 'text' },
          {
            key: 'reportType',
            label: 'Type',
            type: 'select',
            options: [
              { label: 'Narrative', value: 'narrative' },
              { label: 'Synoptic', value: 'synoptic' },
            ],
          },
          { key: 'body', label: 'Template body', type: 'textarea' },
          { key: 'active', label: 'Active', type: 'checkbox' },
        ]}
        columns={[
          { label: 'Name', render: (row) => row.name },
          { label: 'Type', render: (row) => row.reportType },
          { label: 'Active', render: (row) => (row.active ? 'Yes' : 'No') },
          { label: 'Updated', render: (row) => formatDateTime(row.updatedAt) },
        ]}
      />

      <ResourceSection<CommunicationLog>
        title="13. Communications and notifications"
        description="Track email, SMS, WhatsApp, portal messages, mandatory calls, and acknowledgments."
        endpoint="/communication-logs"
        initialValues={{
          orderId: orderOptions[0]?.value ?? '',
          channel: 'email',
          recipient: '',
          message: '',
          status: 'queued',
          mandatory: false,
        }}
        fields={[
          { key: 'orderId', label: 'Order', type: 'select', options: orderOptions },
          {
            key: 'channel',
            label: 'Channel',
            type: 'select',
            options: [
              { label: 'Email', value: 'email' },
              { label: 'SMS', value: 'sms' },
              { label: 'WhatsApp', value: 'whatsapp' },
              { label: 'Call', value: 'call' },
              { label: 'Portal', value: 'portal' },
            ],
          },
          { key: 'recipient', label: 'Recipient', type: 'text' },
          { key: 'message', label: 'Message', type: 'textarea' },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Queued', value: 'queued' },
              { label: 'Sent', value: 'sent' },
              { label: 'Delivered', value: 'delivered' },
              { label: 'Read', value: 'read' },
              { label: 'Acknowledged', value: 'acknowledged' },
            ],
          },
          { key: 'mandatory', label: 'Mandatory contact', type: 'checkbox' },
        ]}
        columns={[
          { label: 'Order', render: (row) => row.orderId },
          { label: 'Channel', render: (row) => row.channel },
          { label: 'Recipient', render: (row) => row.recipient },
          { label: 'Status', render: (row) => row.status },
        ]}
        rowActions={[
          {
            label: 'Ack',
            icon: <CheckCircleRoundedIcon />,
            onClick: async (row) => {
              await api.post(`/communication-logs/${row._id}/ack`, {
                status: 'acknowledged',
              })
            },
          },
        ]}
      />

      <ResourceSection<QualityEvent>
        title="14. QC / QA events"
        description="Log QC exceptions, CAPA, peer reviews, audits, and proficiency events."
        endpoint="/quality-events"
        initialValues={{
          module: '',
          eventType: 'qc',
          status: 'open',
          summary: '',
          owner: '',
        }}
        fields={[
          { key: 'module', label: 'Module', type: 'text' },
          {
            key: 'eventType',
            label: 'Event type',
            type: 'select',
            options: [
              { label: 'QC', value: 'qc' },
              { label: 'QA', value: 'qa' },
              { label: 'CAPA', value: 'capa' },
              { label: 'Peer review', value: 'peer_review' },
              { label: 'Audit', value: 'audit' },
              { label: 'Proficiency', value: 'proficiency' },
            ],
          },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Open', value: 'open' },
              { label: 'Investigating', value: 'investigating' },
              { label: 'Closed', value: 'closed' },
            ],
          },
          { key: 'summary', label: 'Summary', type: 'textarea' },
          { key: 'owner', label: 'Owner', type: 'text' },
        ]}
        columns={[
          { label: 'Module', render: (row) => row.module },
          { label: 'Type', render: (row) => row.eventType },
          { label: 'Owner', render: (row) => row.owner },
          { label: 'Status', render: (row) => row.status },
        ]}
      />

      <TatDashboardPanel summary={tatSummaryState.data} summaryError={tatSummaryState.error} />

      <ResourceSection<TatAlert>
        title="15. TAT alerts"
        description="Create and manage SLA alerts, risk flags, and breach notifications."
        endpoint="/tat-alerts"
        initialValues={{
          orderId: orderOptions[0]?.value ?? '',
          phase: '',
          slaMinutes: 0,
          actualMinutes: 0,
          status: 'on_track',
        }}
        fields={[
          { key: 'orderId', label: 'Order', type: 'select', options: orderOptions },
          { key: 'phase', label: 'Phase', type: 'text' },
          { key: 'slaMinutes', label: 'SLA minutes', type: 'number' },
          { key: 'actualMinutes', label: 'Actual minutes', type: 'number' },
          {
            key: 'status',
            label: 'Alert state',
            type: 'select',
            options: [
              { label: 'On track', value: 'on_track' },
              { label: 'Risk', value: 'risk' },
              { label: 'Breach', value: 'breach' },
            ],
          },
        ]}
        columns={[
          { label: 'Order', render: (row) => row.orderId ?? '—' },
          { label: 'Phase', render: (row) => row.phase },
          { label: 'SLA', render: (row) => `${row.slaMinutes} min` },
          { label: 'State', render: (row) => row.status },
        ]}
      />
    </Stack>
  )
}

export function GovernanceOperationsPage() {
  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Modules 16–20"
        title="Governance, compliance, and integration controls"
        description="Archive and inventory governance, DMS, audit trail, access controls, and integration management."
      />

      <ResourceSection<ArchiveRecord>
        title="16. Archive and storage"
        description="Track archived blocks, slides, cases, and retention/disposal scheduling."
        endpoint="/archive-records"
        initialValues={{
          entityType: 'slide',
          entityId: '',
          location: '',
          retentionUntil: '2030-01-01',
          status: 'active',
        }}
        fields={[
          {
            key: 'entityType',
            label: 'Entity type',
            type: 'select',
            options: [
              { label: 'Block', value: 'block' },
              { label: 'Slide', value: 'slide' },
              { label: 'Case', value: 'case' },
              { label: 'Sample', value: 'sample' },
            ],
          },
          { key: 'entityId', label: 'Entity ID', type: 'text' },
          { key: 'location', label: 'Location', type: 'text' },
          { key: 'retentionUntil', label: 'Retention until', type: 'date' },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Active', value: 'active' },
              { label: 'Scheduled disposal', value: 'scheduled_disposal' },
              { label: 'Disposed', value: 'disposed' },
            ],
          },
        ]}
        columns={[
          { label: 'Entity', render: (row) => `${row.entityType} · ${row.entityId}` },
          { label: 'Location', render: (row) => row.location },
          { label: 'Retention', render: (row) => row.retentionUntil },
          { label: 'Status', render: (row) => row.status },
        ]}
      />

      <ResourceSection<ReagentInventoryItem>
        title="16. Reagent inventory"
        description="Manage reagent stocks, lots, expiries, and reorder thresholds."
        endpoint="/reagent-inventory"
        initialValues={{
          name: '',
          category: '',
          quantity: 0,
          unit: '',
          reorderLevel: 0,
          lotNumber: '',
          expiresAt: '2026-12-31',
        }}
        fields={[
          { key: 'name', label: 'Name', type: 'text' },
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'unit', label: 'Unit', type: 'text' },
          { key: 'reorderLevel', label: 'Reorder level', type: 'number' },
          { key: 'lotNumber', label: 'Lot number', type: 'text' },
          { key: 'expiresAt', label: 'Expiry', type: 'date' },
        ]}
        columns={[
          { label: 'Reagent', render: (row) => row.name },
          { label: 'Category', render: (row) => row.category },
          { label: 'Quantity', render: (row) => `${row.quantity} ${row.unit}` },
          { label: 'Expiry', render: (row) => row.expiresAt },
        ]}
      />

      <ResourceSection<WasteLog>
        title="16. Waste management"
        description="Capture waste disposal categories, quantities, and disposal methods."
        endpoint="/waste-logs"
        initialValues={{
          category: '',
          quantity: 0,
          disposalMethod: '',
          disposedAt: '2026-03-31',
        }}
        fields={[
          { key: 'category', label: 'Category', type: 'text' },
          { key: 'quantity', label: 'Quantity', type: 'number' },
          { key: 'disposalMethod', label: 'Disposal method', type: 'text' },
          { key: 'disposedAt', label: 'Disposed at', type: 'date' },
        ]}
        columns={[
          { label: 'Category', render: (row) => row.category },
          { label: 'Quantity', render: (row) => row.quantity },
          { label: 'Method', render: (row) => row.disposalMethod },
          { label: 'Disposed', render: (row) => row.disposedAt },
        ]}
      />

      <DocumentManagementSection />

      <SectionCard title="18. Audit trail" description="Immutable-style event log for significant platform actions.">
        <AuditTable />
      </SectionCard>

      <SectionCard title="19. Session management" description="Review active sessions and revoke access tokens from the security console.">
        <SessionTable />
      </SectionCard>

      <SectionCard title="19. Credential audit" description="Review sign-ins and security-related credential events.">
        <CredentialAuditTable />
      </SectionCard>

      <ResourceSection<ExternalIntegration>
        title="20. Integration & API gateway"
        description="Manage external EMR/HIS/accounting/AI/webhook connectors."
        endpoint="/integrations"
        initialValues={{
          name: '',
          integrationType: 'emr',
          status: 'configured',
          endpoint: '',
          lastEventAt: '2026-03-31',
        }}
        fields={[
          { key: 'name', label: 'Name', type: 'text' },
          {
            key: 'integrationType',
            label: 'Type',
            type: 'select',
            options: [
              { label: 'EMR', value: 'emr' },
              { label: 'HIS', value: 'his' },
              { label: 'Accounting', value: 'accounting' },
              { label: 'AI', value: 'ai' },
              { label: 'Webhook', value: 'webhook' },
            ],
          },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Configured', value: 'configured' },
              { label: 'Active', value: 'active' },
              { label: 'Error', value: 'error' },
            ],
          },
          { key: 'endpoint', label: 'Endpoint', type: 'text' },
          { key: 'lastEventAt', label: 'Last event', type: 'date' },
        ]}
        columns={[
          { label: 'Integration', render: (row) => row.name },
          { label: 'Type', render: (row) => row.integrationType },
          { label: 'Status', render: (row) => row.status },
          { label: 'Endpoint', render: (row) => row.endpoint },
        ]}
      />

      <VendorIntegrationConsole />
    </Stack>
  )
}

function AuditTable() {
  const auditState = useLoadable<AuditEvent[]>([], [], async () => {
    const response = await api.get<AuditEvent[]>('/audit/events')
    return response.data
  })
  const verifyState = useLoadable<AuditVerificationResponse | null>(null, [], async () => {
    const response = await api.get<AuditVerificationResponse>('/audit/verify')
    return response.data
  })

  if (auditState.loading) return <Typography>Loading audit trail…</Typography>
  if (auditState.error) return <PageError message={auditState.error} />

  return (
    <Stack spacing={2}>
      {verifyState.data ? (
        <Alert severity={verifyState.data.valid ? 'success' : 'error'}>
          {verifyState.data.valid
            ? `Audit chain verified successfully. ${verifyState.data.checked} events checked through sequence ${verifyState.data.latestSequence}.`
            : `Audit verification failed for ${verifyState.data.failures.length} event(s).`}
        </Alert>
      ) : null}
      {verifyState.error ? <PageError message={verifyState.error} /> : null}
      <TableContainer sx={{ maxHeight: 420 }}>
        <Table stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>At</TableCell>
            <TableCell>Module</TableCell>
            <TableCell>Action</TableCell>
            <TableCell>Actor</TableCell>
            <TableCell>Order</TableCell>
            <TableCell>Summary</TableCell>
            <TableCell>Hash</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {auditState.data.map((entry) => (
            <TableRow key={entry._id}>
              <TableCell>{entry.sequence}</TableCell>
              <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
              <TableCell>{entry.module}</TableCell>
              <TableCell>{entry.action}</TableCell>
              <TableCell>{entry.actor}</TableCell>
              <TableCell>{entry.orderId ?? '—'}</TableCell>
              <TableCell>{entry.summary}</TableCell>
              <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.hash.slice(0, 12)}…</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </TableContainer>
    </Stack>
  )
}

function TatDashboardPanel({
  summary,
  summaryError,
}: {
  summary: TatSummary | null
  summaryError: string | null
}) {
  const [range, setRange] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('monthly')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const dashboardState = useLoadable<TatDashboardResponse | null>(null, [range, from, to], async () => {
    const response = await api.get<TatDashboardResponse>('/tat/dashboard', {
      params: {
        range,
        from: range === 'custom' ? from : undefined,
        to: range === 'custom' ? to : undefined,
      },
    })
    return response.data
  })

  return (
    <SectionCard title="15. TAT and KPI monitoring" description="Track phase clocks, identify risk/breach cases, and review current turnaround performance.">
      {summaryError ? <PageError message={summaryError} /> : null}
      {dashboardState.error ? <PageError message={dashboardState.error} /> : null}
      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <FormControl sx={{ minWidth: 180 }}>
            <InputLabel>Range</InputLabel>
            <Select label="Range" value={range} onChange={(event) => setRange(event.target.value as typeof range)}>
              <MenuItem value="daily">Daily</MenuItem>
              <MenuItem value="weekly">Weekly</MenuItem>
              <MenuItem value="monthly">Monthly</MenuItem>
              <MenuItem value="custom">Custom</MenuItem>
            </Select>
          </FormControl>
          {range === 'custom' ? (
            <>
              <TextField
                label="From"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="To"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                InputLabelProps={{ shrink: true }}
              />
            </>
          ) : null}
        </Stack>

        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">Average pre-analytical TAT</Typography>
            <Typography variant="h4">{summary?.averagePreAnalyticsMinutes ?? dashboardState.data?.averages.preAnalyticalMinutes ?? 0} min</Typography>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">Average total TAT</Typography>
            <Typography variant="h4">{dashboardState.data?.averages.totalMinutes ?? 0} min</Typography>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">At risk</Typography>
            <Typography variant="h4">{summary?.riskCount ?? dashboardState.data?.counts.risk ?? 0}</Typography>
          </Paper>
          <Paper sx={{ p: 2 }}>
            <Typography variant="overline">Breached</Typography>
            <Typography variant="h4">{summary?.breachCount ?? dashboardState.data?.counts.breach ?? 0}</Typography>
          </Paper>
        </Box>

        <TableContainer sx={{ maxHeight: 360 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Phase</TableCell>
                <TableCell>Average</TableCell>
                <TableCell>Cases</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(dashboardState.data?.phaseBreakdown ?? {}).map(([phase, detail]) => (
                <TableRow key={phase}>
                  <TableCell>{phase.replace(/_/g, ' ')}</TableCell>
                  <TableCell>{detail.averageMinutes} min</TableCell>
                  <TableCell>{detail.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <TableContainer sx={{ maxHeight: 420 }}>
          <Table stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>Order</TableCell>
                <TableCell>Total TAT</TableCell>
                <TableCell>Target</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(dashboardState.data?.entries ?? []).slice(0, 20).map((entry) => (
                <TableRow key={entry.orderId}>
                  <TableCell>{entry.orderNumber}</TableCell>
                  <TableCell>{entry.totalMinutes} min</TableCell>
                  <TableCell>{entry.targetMinutes} min</TableCell>
                  <TableCell>{entry.totalStatus}</TableCell>
                  <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Stack>
    </SectionCard>
  )
}

function DocumentManagementSection() {
  const documentsState = useLoadable<DocumentRecord[]>([], [], async () => {
    const response = await api.get<DocumentRecord[]>('/documents')
    return response.data
  })
  const [form, setForm] = useState({
    title: '',
    category: '',
    version: '1.0',
    owner: '',
    accessLevel: 'controlled' as DocumentRecord['accessLevel'],
    trainingDueAt: '',
  })
  const [file, setFile] = useState<File | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [replaceTarget, setReplaceTarget] = useState<DocumentRecord | null>(null)
  const [replaceVersion, setReplaceVersion] = useState('')
  const [replaceFile, setReplaceFile] = useState<File | null>(null)

  const uploadDocument = async () => {
    if (!file) {
      setFeedback({ kind: 'error', message: 'Choose a file before uploading.' })
      return
    }
    setSubmitting(true)
    setFeedback(null)
    try {
      const payload = new FormData()
      payload.append('title', form.title)
      payload.append('category', form.category)
      payload.append('version', form.version)
      payload.append('owner', form.owner)
      payload.append('accessLevel', form.accessLevel)
      payload.append('trainingDueAt', form.trainingDueAt || '')
      payload.append('file', file)
      await api.post('/documents/upload', payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setForm({
        title: '',
        category: '',
        version: '1.0',
        owner: '',
        accessLevel: 'controlled',
        trainingDueAt: '',
      })
      setFile(null)
      setFeedback({ kind: 'success', message: 'Document uploaded successfully.' })
      documentsState.refresh()
    } catch (uploadError) {
      setFeedback({ kind: 'error', message: errorMessage(uploadError) })
    } finally {
      setSubmitting(false)
    }
  }

  const downloadDocument = async (record: DocumentRecord) => {
    const response = await api.get(`/documents/${record._id}/file`, {
      responseType: 'blob',
    })
    const blobUrl = window.URL.createObjectURL(response.data)
    const anchor = window.document.createElement('a')
    anchor.href = blobUrl
    anchor.download = record.originalFilename ?? `${record.title}.bin`
    window.document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.URL.revokeObjectURL(blobUrl)
  }

  const replaceDocumentFile = async () => {
    if (!replaceTarget || !replaceFile) {
      setFeedback({ kind: 'error', message: 'Choose a replacement file first.' })
      return
    }
    try {
      const payload = new FormData()
      payload.append('version', replaceVersion || replaceTarget.version)
      payload.append('file', replaceFile)
      await api.post(`/documents/${replaceTarget._id}/file`, payload, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setFeedback({ kind: 'success', message: 'Document file replaced successfully.' })
      setReplaceTarget(null)
      setReplaceVersion('')
      setReplaceFile(null)
      documentsState.refresh()
    } catch (replaceError) {
      setFeedback({ kind: 'error', message: errorMessage(replaceError) })
    }
  }

  return (
    <>
      <SectionCard title="17. Document management" description="Store SOPs, accreditation records, policies, and training files with versioned binaries.">
        {feedback ? <Alert severity={feedback.kind} sx={{ mb: 2 }}>{feedback.message}</Alert> : null}
        <Stack spacing={2}>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
            <TextField label="Title" value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} />
            <TextField label="Category" value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))} />
            <TextField label="Owner" value={form.owner} onChange={(event) => setForm((prev) => ({ ...prev, owner: event.target.value }))} />
            <TextField label="Version" value={form.version} onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))} />
            <FormControl>
              <InputLabel>Access level</InputLabel>
              <Select
                label="Access level"
                value={form.accessLevel}
                onChange={(event) => setForm((prev) => ({ ...prev, accessLevel: event.target.value as DocumentRecord['accessLevel'] }))}
              >
                <MenuItem value="controlled">Controlled</MenuItem>
                <MenuItem value="training">Training</MenuItem>
                <MenuItem value="public">Public</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Training due"
              type="date"
              value={form.trainingDueAt}
              onChange={(event) => setForm((prev) => ({ ...prev, trainingDueAt: event.target.value }))}
              InputLabelProps={{ shrink: true }}
            />
          </Box>
          <Button component="label" variant="outlined">
            {file ? `Selected: ${file.name}` : 'Choose file'}
            <input hidden type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </Button>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Button
              variant="contained"
              disabled={submitting || !form.title.trim() || !form.category.trim() || !form.owner.trim() || !file}
              onClick={() => void uploadDocument()}
            >
              Upload document
            </Button>
            <Typography color="text.secondary" variant="body2">
              Supported uploads include PDF, DOCX, DOC, TXT, PNG, and JPG.
            </Typography>
          </Stack>

          <TableContainer sx={{ maxHeight: 420 }}>
            <Table stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Document</TableCell>
                  <TableCell>Version</TableCell>
                  <TableCell>File</TableCell>
                  <TableCell>Checksum</TableCell>
                  <TableCell>Updated</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {documentsState.data.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell>
                      <Typography fontWeight={700}>{row.title}</Typography>
                      <Typography variant="body2" color="text.secondary">{row.category} · {row.accessLevel}</Typography>
                    </TableCell>
                    <TableCell>{row.version}</TableCell>
                    <TableCell>{row.originalFilename ?? 'Metadata only'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {row.checksumSha256 ? `${row.checksumSha256.slice(0, 12)}…` : '—'}
                    </TableCell>
                    <TableCell>{formatDateTime(row.updatedAt)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={1}>
                        <Button size="small" disabled={!row.storagePath} onClick={() => void downloadDocument(row)}>
                          Download
                        </Button>
                        <Button size="small" onClick={() => { setReplaceTarget(row); setReplaceVersion(row.version) }}>
                          Replace file
                        </Button>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Stack>
      </SectionCard>

      <Dialog open={Boolean(replaceTarget)} onClose={() => setReplaceTarget(null)} fullWidth maxWidth="sm">
        <DialogTitle>Replace document file</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Version" value={replaceVersion} onChange={(event) => setReplaceVersion(event.target.value)} />
            <Button component="label" variant="outlined">
              {replaceFile ? `Selected: ${replaceFile.name}` : 'Choose replacement file'}
              <input hidden type="file" onChange={(event) => setReplaceFile(event.target.files?.[0] ?? null)} />
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReplaceTarget(null)}>Cancel</Button>
          <Button variant="contained" onClick={() => void replaceDocumentFile()} disabled={!replaceFile}>
            Replace
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

function SessionTable() {
  const sessionState = useLoadable<SessionRecord[]>([], [], async () => {
    const response = await api.get<SessionRecord[]>('/security/sessions')
    return response.data
  })

  if (sessionState.loading) return <Typography>Loading sessions…</Typography>
  if (sessionState.error) return <PageError message={sessionState.error} />

  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>Email</TableCell>
            <TableCell>Role</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Created</TableCell>
            <TableCell>Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {sessionState.data.map((entry) => (
            <TableRow key={entry._id}>
              <TableCell>{entry.email}</TableCell>
              <TableCell>{entry.role}</TableCell>
              <TableCell>{entry.status}</TableCell>
              <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
              <TableCell>
                <Button
                  size="small"
                  color="error"
                  onClick={async () => {
                    await api.post(`/security/sessions/${entry._id}/revoke`)
                    sessionState.refresh()
                  }}
                >
                  Revoke
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

function CredentialAuditTable() {
  const credentialState = useLoadable<CredentialAuditRecord[]>([], [], async () => {
    const response = await api.get<CredentialAuditRecord[]>('/security/credential-audits')
    return response.data
  })

  if (credentialState.loading) return <Typography>Loading credential audit…</Typography>
  if (credentialState.error) return <PageError message={credentialState.error} />

  return (
    <TableContainer>
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>User</TableCell>
            <TableCell>Action</TableCell>
            <TableCell>Outcome</TableCell>
            <TableCell>At</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {credentialState.data.map((entry) => (
            <TableRow key={entry._id}>
              <TableCell>{entry.userId}</TableCell>
              <TableCell>{entry.action}</TableCell>
              <TableCell>{entry.outcome}</TableCell>
              <TableCell>{formatDateTime(entry.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

export function EnterpriseAdminPage() {
  const analyticsState = useLoadable<{
    totalOrders: number
    validatedOrders: number
    completedReports: number
    openQualityEvents: number
    activeIntegrations: number
    multiSiteTransfers: number
    deidentifiedExports: number
  } | null>(null, [], async () => {
    const response = await api.get('/analytics/operational-summary')
    return response.data
  })

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Modules 21–25"
        title="Enterprise configuration and intelligence"
        description="Master data, research analytics, business continuity, and multi-site management."
      />

      <SectionCard title="22. Operational analytics">
        {analyticsState.error ? <PageError message={analyticsState.error} /> : null}
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
          {[
            ['Orders', analyticsState.data?.totalOrders ?? 0],
            ['Validated', analyticsState.data?.validatedOrders ?? 0],
            ['Reports', analyticsState.data?.completedReports ?? 0],
            ['Open quality', analyticsState.data?.openQualityEvents ?? 0],
          ].map(([label, value]) => (
            <Paper key={String(label)} sx={{ p: 2 }}>
              <Typography variant="overline">{label}</Typography>
              <Typography variant="h4">{value}</Typography>
            </Paper>
          ))}
        </Box>
      </SectionCard>

      <ResourceSection<PricingRule>
        title="21. Pricing rules"
        description="Configure pricing surcharges, discounts, and financial master rules."
        endpoint="/pricing-rules"
        initialValues={{
          name: '',
          target: '',
          adjustmentType: 'fixed',
          adjustmentValue: 0,
          active: true,
        }}
        fields={[
          { key: 'name', label: 'Rule name', type: 'text' },
          { key: 'target', label: 'Target', type: 'text' },
          {
            key: 'adjustmentType',
            label: 'Adjustment type',
            type: 'select',
            options: [
              { label: 'Fixed', value: 'fixed' },
              { label: 'Percent', value: 'percent' },
            ],
          },
          { key: 'adjustmentValue', label: 'Adjustment value', type: 'number' },
          { key: 'active', label: 'Active', type: 'checkbox' },
        ]}
        columns={[
          { label: 'Rule', render: (row) => row.name },
          { label: 'Target', render: (row) => row.target },
          { label: 'Type', render: (row) => row.adjustmentType },
          { label: 'Value', render: (row) => row.adjustmentValue },
        ]}
      />

      <ResourceSection<ReferenceRange>
        title="21. Reference ranges"
        description="Maintain reference ranges per test code and population."
        endpoint="/reference-ranges"
        initialValues={{
          testCode: '',
          population: '',
          range: '',
          units: '',
        }}
        fields={[
          { key: 'testCode', label: 'Test code', type: 'text' },
          { key: 'population', label: 'Population', type: 'text' },
          { key: 'range', label: 'Range', type: 'textarea' },
          { key: 'units', label: 'Units', type: 'text' },
        ]}
        columns={[
          { label: 'Test', render: (row) => row.testCode },
          { label: 'Population', render: (row) => row.population },
          { label: 'Range', render: (row) => row.range },
          { label: 'Units', render: (row) => row.units },
        ]}
      />

      <ResourceSection<QcThreshold>
        title="21. QC thresholds"
        description="Configure warning and critical thresholds across lab modules."
        endpoint="/qc-thresholds"
        initialValues={{
          module: '',
          metric: '',
          warning: 0,
          critical: 0,
        }}
        fields={[
          { key: 'module', label: 'Module', type: 'text' },
          { key: 'metric', label: 'Metric', type: 'text' },
          { key: 'warning', label: 'Warning', type: 'number' },
          { key: 'critical', label: 'Critical', type: 'number' },
        ]}
        columns={[
          { label: 'Module', render: (row) => row.module },
          { label: 'Metric', render: (row) => row.metric },
          { label: 'Warning', render: (row) => row.warning },
          { label: 'Critical', render: (row) => row.critical },
        ]}
      />

      <ResourceSection<ResearchDataset>
        title="22. Research datasets"
        description="Manage research exports, de-identified datasets, and AI training pipeline readiness."
        endpoint="/research-datasets"
        initialValues={{
          name: '',
          description: '',
          deIdentified: true,
          recordCount: 0,
          pipelineStatus: 'draft',
        }}
        fields={[
          { key: 'name', label: 'Dataset name', type: 'text' },
          { key: 'description', label: 'Description', type: 'textarea' },
          { key: 'deIdentified', label: 'De-identified', type: 'checkbox' },
          { key: 'recordCount', label: 'Record count', type: 'number' },
          {
            key: 'pipelineStatus',
            label: 'Pipeline status',
            type: 'select',
            options: [
              { label: 'Draft', value: 'draft' },
              { label: 'Ready', value: 'ready' },
              { label: 'Exported', value: 'exported' },
            ],
          },
        ]}
        columns={[
          { label: 'Dataset', render: (row) => row.name },
          { label: 'Records', render: (row) => row.recordCount },
          { label: 'De-ID', render: (row) => (row.deIdentified ? 'Yes' : 'No') },
          { label: 'Pipeline', render: (row) => row.pipelineStatus },
        ]}
      />

      <ResourceSection<RecoveryRecord>
        title="23. Recovery and continuity"
        description="Track backups, restores, drills, offline synchronization, and business continuity checks."
        endpoint="/recovery-records"
        initialValues={{
          recordType: 'backup',
          status: 'scheduled',
          notes: '',
        }}
        fields={[
          {
            key: 'recordType',
            label: 'Record type',
            type: 'select',
            options: [
              { label: 'Backup', value: 'backup' },
              { label: 'Restore', value: 'restore' },
              { label: 'DR drill', value: 'drill' },
              { label: 'Sync', value: 'sync' },
            ],
          },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Scheduled', value: 'scheduled' },
              { label: 'Success', value: 'success' },
              { label: 'Failure', value: 'failure' },
            ],
          },
          { key: 'notes', label: 'Notes', type: 'textarea' },
        ]}
        columns={[
          { label: 'Type', render: (row) => row.recordType },
          { label: 'Status', render: (row) => row.status },
          { label: 'Notes', render: (row) => row.notes },
          { label: 'Updated', render: (row) => formatDateTime(row.updatedAt) },
        ]}
      />

      <ResourceSection<Site>
        title="25. Sites and labs"
        description="Configure site-specific workflows, hub/spoke structure, and active collection or lab sites."
        endpoint="/sites"
        initialValues={{
          code: '',
          name: '',
          siteType: 'lab',
          active: true,
        }}
        fields={[
          { key: 'code', label: 'Code', type: 'text' },
          { key: 'name', label: 'Name', type: 'text' },
          {
            key: 'siteType',
            label: 'Type',
            type: 'select',
            options: [
              { label: 'Hub', value: 'hub' },
              { label: 'Spoke', value: 'spoke' },
              { label: 'Collection', value: 'collection' },
              { label: 'Lab', value: 'lab' },
            ],
          },
          { key: 'active', label: 'Active', type: 'checkbox' },
        ]}
        columns={[
          { label: 'Code', render: (row) => row.code },
          { label: 'Name', render: (row) => row.name },
          { label: 'Type', render: (row) => row.siteType },
          { label: 'Active', render: (row) => (row.active ? 'Yes' : 'No') },
        ]}
      />

      <ResourceSection<SiteTransfer>
        title="25. Inter-site specimen transfers"
        description="Track specimen movement between sites and labs with transfer statuses."
        endpoint="/site-transfers"
        initialValues={{
          orderId: '',
          fromSiteId: '',
          toSiteId: '',
          status: 'requested',
        }}
        fields={[
          { key: 'orderId', label: 'Order ID', type: 'text' },
          { key: 'fromSiteId', label: 'From site', type: 'text' },
          { key: 'toSiteId', label: 'To site', type: 'text' },
          {
            key: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Requested', value: 'requested' },
              { label: 'In transit', value: 'in_transit' },
              { label: 'Received', value: 'received' },
            ],
          },
        ]}
        columns={[
          { label: 'Order', render: (row) => row.orderId },
          { label: 'From', render: (row) => row.fromSiteId },
          { label: 'To', render: (row) => row.toSiteId },
          { label: 'Status', render: (row) => row.status },
        ]}
      />
    </Stack>
  )
}

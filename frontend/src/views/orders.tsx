import AddRoundedIcon from '@mui/icons-material/AddRounded'

import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
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

import { useEffect, useState } from 'react'

import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api'
import { useAuth } from '../auth'
import { OcrOrderUpload } from '../components/OcrOrderUpload'

import {
  LoadingPanel,
  PageHeader,
  PriorityChip,
  SectionCard,
  StatusChip,
} from '../components'

import { errorMessage, PageError, TablePlaceholder, useActionLock, useLoadable } from './shared'

import type {
  Doctor,
  HydratedOrder,
  Patient,
  Payment,
  TestType,
} from '../types'

import { downloadPathologyReportPdf, formatDate, formatDateTime, formatMoney, paymentMethodLabel } from '../utils'

export function OrdersPage() {
  const { user } = useAuth()
  const [status, setStatus] = useState('')
  const ordersState = useLoadable<{ data: HydratedOrder[]; total: number }>(
    { data: [], total: 0 },
    [status],
    async () => {
      const response = await api.get('/orders', { params: status ? { status } : undefined })
      return response.data
    },
  )
  const canCreateOrder = user ? ['super_admin', 'admin', 'receptionist'].includes(user.role) : false

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Orders"
        action={canCreateOrder ? (
          <Button component={RouterLink} to="/orders/create" variant="contained" startIcon={<AddRoundedIcon />}>
            Create order
          </Button>
        ) : undefined}
      />
      <SectionCard>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl sx={{ minWidth: 220 }}>
            <InputLabel>Status</InputLabel>
            <Select label="Status" value={status} onChange={(event) => setStatus(String(event.target.value))}>
              <MenuItem value="">All statuses</MenuItem>
              <MenuItem value="draft">Draft</MenuItem>
              <MenuItem value="received">Received</MenuItem>
              <MenuItem value="in_progress">In progress</MenuItem>
              <MenuItem value="review">Review</MenuItem>
              <MenuItem value="completed">Completed</MenuItem>
            </Select>
          </FormControl>
        </Stack>
        <TablePlaceholder loading={ordersState.loading} />
        {ordersState.error ? <PageError message={ordersState.error} /> : null}
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Order #</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Priority</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ordersState.data.data.map((order) => (
                <TableRow key={order._id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.patient.firstName} {order.patient.lastName}</TableCell>
                  <TableCell><StatusChip status={order.status} /></TableCell>
                  <TableCell><PriorityChip priority={order.priority} /></TableCell>
                  <TableCell>{formatDate(order.createdAt)}</TableCell>
                  <TableCell>
                    <Button component={RouterLink} to={`/orders/${order._id}`}>
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

export function CreateOrderPage() {
  const actionLock = useActionLock()
  const navigate = useNavigate()
  const patientsState = useLoadable<{ data: Patient[] }>({ data: [] }, [], async () => {
    const response = await api.get('/patients')
    return response.data
  })
  const testTypesState = useLoadable<TestType[]>([], [], async () => {
    const response = await api.get<TestType[]>('/test-types')
    return response.data
  })
  const doctorsState = useLoadable<Doctor[]>([], [], async () => {
    const response = await api.get<Doctor[]>('/doctors')
    return response.data
  })
  const [patientId, setPatientId] = useState('')
  const [testTypeIds, setTestTypeIds] = useState<string[]>([])
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [doctorId, setDoctorId] = useState<string>('')
  const [doctorText, setDoctorText] = useState('')
  const [notes, setNotes] = useState('')
  const [openPatientDialog, setOpenPatientDialog] = useState(false)
  const [patientDraft, setPatientDraft] = useState({
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    gender: 'male',
    phone: '',
    email: '',
    address: '',
    nationalId: '',
  })
  const [error, setError] = useState<string | null>(null)

  const createPatient = async () => {
    await actionLock.runLocked('create-patient', async () => {
      try {
        const response = await api.post<Patient>('/patients', patientDraft)
        patientsState.setData((prev) => ({ data: [response.data, ...prev.data] }))
        setPatientId(response.data._id)
        setPatientDraft({
          firstName: '',
          lastName: '',
          dateOfBirth: '',
          gender: 'male',
          phone: '',
          email: '',
          address: '',
          nationalId: '',
        })
        setOpenPatientDialog(false)
      } catch (createError) {
        setError(errorMessage(createError))
      }
    })
  }

  const createOrder = async () => {
    await actionLock.runLocked('create-order', async () => {
      try {
        const response = await api.post<HydratedOrder>('/orders', {
          patientId,
          testTypeIds,
          priority,
          referringDoctorId: doctorId || null,
          referringDoctorName: doctorText || null,
          orderSource: 'walk_in',
          notes,
        })
        navigate(`/orders/${response.data._id}`)
      } catch (createError) {
        setError(errorMessage(createError))
      }
    })
  }

  const selectedPatient = patientsState.data.data.find((item) => item._id === patientId)
  const selectedDoctor = doctorsState.data.find((item) => item._id === doctorId)

  if (patientsState.loading || testTypesState.loading || doctorsState.loading) {
    return <LoadingPanel label="Loading order form…" />
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Create order" />
      <SectionCard>
        <Stack spacing={2.5}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Autocomplete
            options={patientsState.data.data}
            getOptionLabel={(option) => `${option.firstName} ${option.lastName}`}
            value={patientsState.data.data.find((item) => item._id === patientId) ?? null}
            onChange={(_event, value) => setPatientId(value?._id ?? '')}
            renderInput={(params) => <TextField {...params} label="Patient" />}
          />
          <Button variant="outlined" onClick={() => setOpenPatientDialog(true)}>
            Register new patient
          </Button>
          <Typography variant="subtitle2">Test types</Typography>
          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
            {testTypesState.data.map((test) => (
              <Paper key={test._id} sx={{ p: 2 }}>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={testTypeIds.includes(test._id)}
                      onChange={(event) => {
                        setTestTypeIds((prev) =>
                          event.target.checked ? [...prev, test._id] : prev.filter((item) => item !== test._id),
                        )
                      }}
                    />
                  }
                  label={`${test.code} — ${test.name}`}
                />
              </Paper>
            ))}
          </Box>
          <FormControl>
            <InputLabel>Priority</InputLabel>
            <Select label="Priority" value={priority} onChange={(event) => setPriority(String(event.target.value) as 'normal' | 'urgent')}>
              <MenuItem value="normal">Normal</MenuItem>
              <MenuItem value="urgent">Urgent</MenuItem>
            </Select>
          </FormControl>
          <Autocomplete
            options={doctorsState.data}
            getOptionLabel={(option) => option.name}
            value={doctorsState.data.find((item) => item._id === doctorId) ?? null}
            onChange={(_event, value) => setDoctorId(value?._id ?? '')}
            renderInput={(params) => <TextField {...params} label="Referring doctor / clinic" />}
          />
          <TextField label="Referring doctor (free text if not in list)" value={doctorText} onChange={(event) => setDoctorText(event.target.value)} />
          <TextField label="Notes" multiline minRows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          <OcrOrderUpload
            title="Scan requisition"
            buildCorrections={() => ({
              source: 'walk_in',
              patientId: patientId || undefined,
              patient: selectedPatient ? {
                firstName: selectedPatient.firstName,
                lastName: selectedPatient.lastName,
                dateOfBirth: selectedPatient.dateOfBirth,
                phone: selectedPatient.phone,
                email: selectedPatient.email,
              } : undefined,
              testCodes: testTypeIds,
              clinicianId: doctorId || undefined,
              clinician: doctorText ? { name: doctorText } : selectedDoctor ? {
                name: selectedDoctor.name,
                email: selectedDoctor.email,
                phone: selectedDoctor.phone,
              } : undefined,
              clinicalNotes: notes,
            })}
            onOrderCreated={(order) => navigate(`/orders/${order._id}`)}
          />
          <Stack direction="row" spacing={2}>
            <Button variant="contained" disabled={actionLock.isPending('create-order')} onClick={createOrder}>
              Create order
            </Button>
            <Button component={RouterLink} to="/orders" variant="outlined">
              Cancel
            </Button>
          </Stack>
        </Stack>
      </SectionCard>

      <Dialog open={openPatientDialog} onClose={() => setOpenPatientDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Register new patient</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
              <TextField label="First name" value={patientDraft.firstName} onChange={(event) => setPatientDraft((prev) => ({ ...prev, firstName: event.target.value }))} />
              <TextField label="Last name" value={patientDraft.lastName} onChange={(event) => setPatientDraft((prev) => ({ ...prev, lastName: event.target.value }))} />
              <TextField label="Date of birth" type="date" InputLabelProps={{ shrink: true }} value={patientDraft.dateOfBirth} onChange={(event) => setPatientDraft((prev) => ({ ...prev, dateOfBirth: event.target.value }))} />
              <FormControl>
                <InputLabel>Gender</InputLabel>
                <Select label="Gender" value={patientDraft.gender} onChange={(event) => setPatientDraft((prev) => ({ ...prev, gender: String(event.target.value) }))}>
                  <MenuItem value="male">Male</MenuItem>
                  <MenuItem value="female">Female</MenuItem>
                  <MenuItem value="other">Other</MenuItem>
                </Select>
              </FormControl>
              <TextField label="Phone" value={patientDraft.phone} onChange={(event) => setPatientDraft((prev) => ({ ...prev, phone: event.target.value }))} />
              <TextField label="Email" value={patientDraft.email} onChange={(event) => setPatientDraft((prev) => ({ ...prev, email: event.target.value }))} />
            </Box>
            <TextField label="Address" value={patientDraft.address} onChange={(event) => setPatientDraft((prev) => ({ ...prev, address: event.target.value }))} />
            <TextField label="National ID" value={patientDraft.nationalId} onChange={(event) => setPatientDraft((prev) => ({ ...prev, nationalId: event.target.value }))} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenPatientDialog(false)}>Cancel</Button>
          <Button variant="contained" disabled={actionLock.isPending('create-patient')} onClick={createPatient}>
            Save patient
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function OrderDetailPage() {
  const actionLock = useActionLock()
  const { user } = useAuth()
  const { orderId = '' } = useParams()
  const detailState = useLoadable<any>(null, [orderId], async () => {
    const response = await api.get(`/orders/${orderId}`)
    return response.data
  })
  const [editOpen, setEditOpen] = useState(false)
  const [editPriority, setEditPriority] = useState<'normal' | 'urgent'>('normal')
  const [editNotes, setEditNotes] = useState('')
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [paymentForm, setPaymentForm] = useState<{
    amount: number
    method: 'cash' | 'card' | 'mobile_money' | 'bank_transfer'
    status: 'pending' | 'completed' | 'failed'
  }>({
    amount: 0,
    method: 'cash',
    status: 'completed',
  })
  const [reportForm, setReportForm] = useState({
    diagnosis: '',
    microscopicDescription: '',
    grossDescription: '',
    comment: '',
  })
  const [addendum, setAddendum] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const canEditOrder = user ? ['super_admin', 'admin', 'receptionist'].includes(user.role) : false
  const canRecordPayment = user ? ['super_admin', 'admin', 'finance'].includes(user.role) : false
  const canManageReport = user ? ['super_admin', 'admin', 'pathologist'].includes(user.role) : false

  useEffect(() => {
    if (detailState.data) {
      setEditPriority(detailState.data.priority)
      setEditNotes(detailState.data.notes ?? '')
      setPaymentForm((prev) => ({
        ...prev,
        amount: Math.max(0, detailState.data.totalAmount - detailState.data.paidAmount),
      }))
      setReportForm({
        diagnosis: detailState.data.report?.diagnosis ?? '',
        microscopicDescription: detailState.data.report?.microscopicDescription ?? '',
        grossDescription: detailState.data.report?.grossDescription ?? '',
        comment: detailState.data.report?.comment ?? '',
      })
    }
  }, [detailState.data])

  const save = async () => {
    await actionLock.runLocked('save-order', async () => {
      try {
        await api.put(`/orders/${orderId}`, {
          priority: editPriority,
          notes: editNotes,
        })
        setEditOpen(false)
        setFeedback({ kind: 'success', message: 'Order details updated.' })
        detailState.refresh()
      } catch (saveError) {
        setFeedback({ kind: 'error', message: errorMessage(saveError) })
      }
    })
  }

  if (detailState.loading) return <LoadingPanel label="Loading order…" />
  if (detailState.error || !detailState.data) return <PageError message={detailState.error ?? 'Order not found'} />

  const detail = detailState.data
  const outstandingBalance = Math.max(0, detail.totalAmount - detail.paidAmount)
  const backTo =
    user?.role === 'finance'
      ? '/financial'
      : user?.role === 'courier'
        ? '/courier'
        : user?.role === 'doctor'
          ? '/doctor-portal'
          : user?.role === 'pathologist'
            ? '/pathologist/workflow'
            : '/orders'

  const saveReportDraft = async () => {
    await actionLock.runLocked('save-report', async () => {
      try {
        await api.post(`/reports/${orderId}/save`, reportForm)
        setFeedback({ kind: 'success', message: 'Report draft saved.' })
        detailState.refresh()
      } catch (saveError) {
        setFeedback({ kind: 'error', message: errorMessage(saveError) })
      }
    })
  }

  const completeReport = async () => {
    if (!window.confirm('Complete sign-out for this case?')) {
      return
    }
    await actionLock.runLocked('complete-report', async () => {
      try {
        await api.post(`/reports/${orderId}/save`, reportForm)
        await api.post(`/reports/${orderId}/lock`)
        await api.post(`/reports/${orderId}/sign`)
        setFeedback({ kind: 'success', message: 'Report completed and digitally signed.' })
        detailState.refresh()
      } catch (completeError) {
        setFeedback({ kind: 'error', message: errorMessage(completeError) })
      }
    })
  }

  const releaseReport = async () => {
    if (!window.confirm('Release this final result to the client and portals?')) {
      return
    }
    await actionLock.runLocked('release-report', async () => {
      try {
        await api.post(`/reports/${orderId}/email`)
        setFeedback({ kind: 'success', message: 'Result released and queued for delivery.' })
        detailState.refresh()
      } catch (releaseError) {
        setFeedback({ kind: 'error', message: errorMessage(releaseError) })
      }
    })
  }

  const addReportAddendum = async () => {
    if (!addendum.trim()) {
      setFeedback({ kind: 'error', message: 'Enter an addendum note before saving.' })
      return
    }
    await actionLock.runLocked('addendum', async () => {
      try {
        await api.post(`/reports/${orderId}/addendum`, { note: addendum })
        setAddendum('')
        setFeedback({ kind: 'success', message: 'Addendum added to the report.' })
        detailState.refresh()
      } catch (addendumError) {
        setFeedback({ kind: 'error', message: errorMessage(addendumError) })
      }
    })
  }

  const savePayment = async () => {
    if (!window.confirm('Record this payment for the order?')) {
      return
    }
    await actionLock.runLocked('save-payment', async () => {
      try {
        await api.post(`/orders/${orderId}/payment`, paymentForm)
        setPaymentOpen(false)
        setPaymentForm((prev) => ({ ...prev, amount: 0 }))
        setFeedback({ kind: 'success', message: 'Payment recorded for this order.' })
        detailState.refresh()
      } catch (paymentError) {
        setFeedback({ kind: 'error', message: errorMessage(paymentError) })
      }
    })
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title={`Order ${detail.orderNumber}`}
        action={
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Button component={RouterLink} to={backTo}>Back</Button>
            <Button
              startIcon={<DownloadRoundedIcon />}
              onClick={() => {
                void downloadPathologyReportPdf(`report-${detail.orderNumber}.pdf`, detail)
              }}
            >
              Download report PDF
            </Button>
            {canRecordPayment ? (
              <Button variant="outlined" onClick={() => setPaymentOpen(true)}>
                Record payment
              </Button>
            ) : null}
            {canEditOrder ? (
              <Button variant="contained" onClick={() => setEditOpen(true)}>
                Edit order
              </Button>
            ) : null}
          </Stack>
        }
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '1.1fr 0.9fr' } }}>
        <SectionCard title="Status & priority">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5}>
              <StatusChip status={detail.status} />
              <PriorityChip priority={detail.priority} />
            </Stack>
            <Typography>Referring: {detail.referringDoctor ?? '—'}</Typography>
            <Typography color="text.secondary">Financial clearance: {detail.financialClearance ?? 'pending'}</Typography>
          </Stack>
        </SectionCard>
        <SectionCard title="Patient">
          <Typography variant="h6">{detail.patient.firstName} {detail.patient.lastName}</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>{detail.patient.phone}</Typography>
          <Typography color="text.secondary">{detail.patient.email}</Typography>
        </SectionCard>
      </Box>
      <SectionCard title="Test types">
        <Stack spacing={1}>
          {detail.testTypes.map((test: TestType) => (
            <Typography key={test._id}>{test.code} — {test.name}</Typography>
          ))}
        </Stack>
      </SectionCard>
      <SectionCard title="Workflow route">
        <Typography color="text.secondary">{detail.workflowPlan.summary}</Typography>
        <Stack spacing={1.25} sx={{ mt: 2 }}>
          {detail.workflowPlan.stages.map((stage: any) => (
            <Paper key={stage.id} sx={{ p: 2 }}>
              <Typography fontWeight={700}>
                {stage.label} {stage.status === 'current' ? '• Current' : stage.status === 'complete' ? '• Done' : '• Pending'}
              </Typography>
              <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                {stage.description}
              </Typography>
            </Paper>
          ))}
        </Stack>
      </SectionCard>
      <SectionCard
        title="Payments"
        action={canRecordPayment ? <Button onClick={() => setPaymentOpen(true)}>Record payment</Button> : undefined}
      >
        <Typography>Order total: {formatMoney(detail.totalAmount)}</Typography>
        <Typography>Paid: {formatMoney(detail.paidAmount)}</Typography>
        <Typography>Balance: {formatMoney(outstandingBalance)}</Typography>
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          {detail.payments.map((payment: Payment) => (
            <Paper key={payment._id} sx={{ p: 2 }}>
              <Typography>{formatMoney(payment.amount)} — {paymentMethodLabel(payment.method)} ({payment.status})</Typography>
              <Typography color="text.secondary">{formatDateTime(payment.createdAt)}</Typography>
              {payment.gatewayReference ? <Typography color="text.secondary">Reference: {payment.gatewayReference}</Typography> : null}
            </Paper>
          ))}
          {!detail.payments.length ? (
            <Typography color="text.secondary">No payments have been recorded for this order yet.</Typography>
          ) : null}
        </Stack>
      </SectionCard>
      <SectionCard title={canManageReport ? 'Report workspace' : 'Report summary'}>
        {canManageReport ? (
          <Stack spacing={2}>
            <TextField
              label="Diagnosis"
              multiline
              minRows={3}
              value={reportForm.diagnosis}
              onChange={(event) => setReportForm((prev) => ({ ...prev, diagnosis: event.target.value }))}
            />
            <TextField
              label="Microscopic description"
              multiline
              minRows={4}
              value={reportForm.microscopicDescription}
              onChange={(event) => setReportForm((prev) => ({ ...prev, microscopicDescription: event.target.value }))}
            />
            <TextField
              label="Gross description"
              multiline
              minRows={3}
              value={reportForm.grossDescription}
              onChange={(event) => setReportForm((prev) => ({ ...prev, grossDescription: event.target.value }))}
            />
            <TextField
              label="Comment / summary"
              multiline
              minRows={3}
              value={reportForm.comment}
              onChange={(event) => setReportForm((prev) => ({ ...prev, comment: event.target.value }))}
            />
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <Button variant="contained" disabled={actionLock.isPending('save-report')} onClick={saveReportDraft}>
                Save draft
              </Button>
              <Button disabled={actionLock.isPending('complete-report')} onClick={completeReport}>
                Complete sign-out
              </Button>
              <Button disabled={detail.report?.status !== 'complete' || actionLock.isPending('release-report')} onClick={releaseReport}>
                Release result
              </Button>
            </Stack>
            <Typography color="text.secondary">
              Report status: {detail.report?.status ?? 'draft'} · Signed by {detail.report?.signedBy ?? 'Not yet signed'}
            </Typography>
            {detail.report?.status === 'complete' ? (
              <Stack spacing={1.5} sx={{ pt: 1 }}>
                <TextField
                  label="Addendum"
                  multiline
                  minRows={3}
                  value={addendum}
                  onChange={(event) => setAddendum(event.target.value)}
                />
                <Button disabled={actionLock.isPending('addendum')} onClick={addReportAddendum}>Add addendum</Button>
              </Stack>
            ) : null}
          </Stack>
        ) : (
          <Stack spacing={1.25}>
            <Typography fontWeight={700}>{detail.report?.diagnosis || 'Diagnosis pending.'}</Typography>
            <Typography color="text.secondary">{detail.report?.microscopicDescription || 'Microscopic description pending.'}</Typography>
            <Typography>{detail.report?.comment || 'No report summary available yet.'}</Typography>
            <Typography color="text.secondary">
              Signed by {detail.report?.signedBy ?? 'Not yet signed'} · Released {detail.releasedAt ? formatDateTime(detail.releasedAt) : 'No'}
            </Typography>
          </Stack>
        )}
      </SectionCard>
      {detail.report?.versions?.length ? (
        <SectionCard title="Report history">
          <Stack spacing={1.5}>
            {detail.report.versions.map((version: any) => (
              <Paper key={`${version.version}-${version.createdAt}`} sx={{ p: 2 }}>
                <Typography fontWeight={700}>Version {version.version}</Typography>
                <Typography color="text.secondary">{formatDateTime(version.createdAt)}</Typography>
                <Typography sx={{ mt: 1 }}>{version.diagnosis || 'No diagnosis recorded.'}</Typography>
              </Paper>
            ))}
          </Stack>
        </SectionCard>
      ) : null}
      {detail.report?.addenda?.length ? (
        <SectionCard title="Addenda">
          <Stack spacing={1.5}>
            {detail.report.addenda.map((entry: any) => (
              <Paper key={entry._id} sx={{ p: 2 }}>
                <Typography>{entry.note}</Typography>
                <Typography color="text.secondary" sx={{ mt: 0.75 }}>{formatDateTime(entry.createdAt)}</Typography>
              </Paper>
            ))}
          </Stack>
        </SectionCard>
      ) : null}
      <SectionCard title="Lab progress">
        <Stack spacing={1}>
          <Typography>Accession: {detail.accession?.accessionId ?? 'Not yet accessioned'}</Typography>
          <Typography>Sample: {detail.sample?.label ?? 'Not yet synced to inventory'}</Typography>
          <Typography>Assigned technician: {detail.assignedTechnician?.name ?? 'Unassigned'}</Typography>
          <Typography>Assigned pathologist: {detail.assignedPathologist?.name ?? 'Unassigned'}</Typography>
        </Stack>
      </SectionCard>
      <SectionCard title="Timeline">
        <Stack spacing={1.5}>
          {detail.timeline.map((item: any) => (
            <Paper key={`${item.label}-${item.at}`} sx={{ p: 2 }}>
              <Typography fontWeight={700}>{item.label}</Typography>
              <Typography color="text.secondary">{formatDateTime(item.at)}</Typography>
            </Paper>
          ))}
        </Stack>
      </SectionCard>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit order</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl>
              <InputLabel>Priority</InputLabel>
              <Select label="Priority" value={editPriority} onChange={(event) => setEditPriority(String(event.target.value) as 'normal' | 'urgent')}>
                <MenuItem value="normal">Normal</MenuItem>
                <MenuItem value="urgent">Urgent</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Notes" multiline minRows={4} value={editNotes} onChange={(event) => setEditNotes(event.target.value)} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={actionLock.isPending('save-order')} onClick={save}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={paymentOpen} onClose={() => setPaymentOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Record payment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography color="text.secondary">
              Total {formatMoney(detail.totalAmount)} · Paid {formatMoney(detail.paidAmount)} · Balance {formatMoney(outstandingBalance)}
            </Typography>
            <TextField
              label="Amount"
              type="number"
              value={paymentForm.amount}
              onChange={(event) => setPaymentForm((prev) => ({ ...prev, amount: Number(event.target.value) }))}
            />
            <FormControl>
              <InputLabel>Method</InputLabel>
              <Select
                label="Method"
                value={paymentForm.method}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, method: String(event.target.value) as 'cash' | 'card' | 'mobile_money' | 'bank_transfer' }))}
              >
                <MenuItem value="cash">Cash</MenuItem>
                <MenuItem value="card">Card</MenuItem>
                <MenuItem value="mobile_money">Mobile money</MenuItem>
                <MenuItem value="bank_transfer">Bank transfer</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={paymentForm.status}
                onChange={(event) => setPaymentForm((prev) => ({ ...prev, status: String(event.target.value) as 'pending' | 'completed' | 'failed' }))}
              >
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentOpen(false)}>Cancel</Button>
          <Button disabled={paymentForm.amount <= 0 || actionLock.isPending('save-payment')} variant="contained" onClick={savePayment}>
            Save payment
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

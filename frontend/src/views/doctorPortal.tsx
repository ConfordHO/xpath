import AssignmentTurnedInOutlinedIcon from '@mui/icons-material/AssignmentTurnedInOutlined'
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
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
import { Link as RouterLink } from 'react-router-dom'

import { api } from '../api'
import { OcrOrderUpload } from '../components/OcrOrderUpload'
import {
  EmptyState,
  LoadingPanel,
  MetricCard,
  PageHeader,
  SectionCard,
} from '../components'
import type { HydratedOrder, Patient, TestType } from '../types'
import { formatDateTime, formatMoney } from '../utils'
import { errorMessage, useLoadable } from './shared'

type ClinicianProfile = {
  _id: string
  name: string
  email: string
  phone: string
  code: string
}

type ClinicianOrder = HydratedOrder & {
  invoice?: {
    _id: string
    invoiceNumber: string
    total: number
    status: string
  } | null
  reportReleased?: boolean
  report?: {
    _id: string
    status: string
    diagnosis: string
    microscopicDescription: string
    grossDescription: string
    comment: string
    emailedAt?: string | null
  } | null
}

type PortalData = {
  profile: ClinicianProfile
  stats: {
    totalOrders: number
    completedOrders: number
    reviewOrders: number
  }
  patients: Patient[]
  orders: ClinicianOrder[]
  services: TestType[]
}

type PatientDraft = {
  firstName: string
  lastName: string
  dateOfBirth: string
  gender: 'male' | 'female' | 'other'
  phone: string
  email: string
  address: string
  externalPatientId: string
}

const emptyPatient: PatientDraft = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  gender: 'other',
  phone: '',
  email: '',
  address: '',
  externalPatientId: '',
}

const payerOptions = [
  { value: 'patient', label: 'Patient' },
  { value: 'clinician', label: 'Clinician' },
  { value: 'corporate', label: 'Corporate' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'lab_policy', label: 'Lab policy' },
] as const

function selectedOrderTests(order: ClinicianOrder) {
  return order.testTypes.map((test) => test.code).join(', ')
}

export function DoctorPortalPage() {
  const portalState = useLoadable<PortalData | null>(null, [], async () => {
    const [profileResponse, statsResponse, patientsResponse, ordersResponse, servicesResponse] = await Promise.all([
      api.get('/doctors/me/profile'),
      api.get('/doctors/me/stats'),
      api.get('/doctors/me/patients'),
      api.get('/doctors/me/orders'),
      api.get('/public/services'),
    ])
    return {
      profile: profileResponse.data,
      stats: statsResponse.data,
      patients: patientsResponse.data.data,
      orders: ordersResponse.data.data,
      services: servicesResponse.data,
    }
  })
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [patient, setPatient] = useState(emptyPatient)
  const [testTypeIds, setTestTypeIds] = useState<string[]>([])
  const [priority, setPriority] = useState<'normal' | 'urgent'>('normal')
  const [clinicalHistory, setClinicalHistory] = useState('')
  const [notes, setNotes] = useState('')
  const [payerType, setPayerType] = useState<(typeof payerOptions)[number]['value']>('patient')
  const [billingAccountName, setBillingAccountName] = useState('')
  const [billingInstructions, setBillingInstructions] = useState('')
  const [creating, setCreating] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const data = portalState.data
  const selectedPatient = useMemo(
    () => data?.patients.find((entry) => entry._id === selectedPatientId) ?? null,
    [data?.patients, selectedPatientId],
  )
  const releasedOrders = data?.orders.filter((order) => order.reportReleased).length ?? 0
  const pendingBilling = data?.orders.filter((order) => order.financialClearance !== 'cleared').length ?? 0

  const createPatient = async () => {
    setMessage(null)
    try {
      const response = await api.post<Patient>('/doctors/me/patients', {
        ...patient,
        externalPatientId: patient.externalPatientId || null,
      })
      setSelectedPatientId(response.data._id)
      setPatient(emptyPatient)
      portalState.refresh()
      setMessage({ kind: 'success', text: 'Patient saved.' })
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    }
  }

  const createOrder = async () => {
    setMessage(null)
    if (!selectedPatientId && (!patient.firstName || !patient.lastName)) {
      setMessage({ kind: 'error', text: 'Create or select a patient first.' })
      return
    }
    if (!testTypeIds.length) {
      setMessage({ kind: 'error', text: 'Select at least one test.' })
      return
    }
    setCreating(true)
    try {
      const response = await api.post<HydratedOrder>('/doctors/me/orders', {
        patientId: selectedPatientId || null,
        patient: selectedPatientId
          ? undefined
          : {
              ...patient,
              externalPatientId: patient.externalPatientId || null,
            },
        testTypeIds,
        priority,
        clinicalHistory,
        notes,
        payerType,
        billingAccountName: billingAccountName || null,
        billingInstructions: billingInstructions || null,
      })
      setMessage({ kind: 'success', text: `Order ${response.data.orderNumber} created.` })
      setSelectedPatientId('')
      setPatient(emptyPatient)
      setTestTypeIds([])
      setClinicalHistory('')
      setNotes('')
      setBillingAccountName('')
      setBillingInstructions('')
      portalState.refresh()
    } catch (error) {
      setMessage({ kind: 'error', text: errorMessage(error) })
    } finally {
      setCreating(false)
    }
  }

  if (portalState.loading) return <LoadingPanel label="Loading clinician portal..." />
  if (portalState.error || !data) {
    return (
      <EmptyState
        title="External clinician portal"
        body="Your account is not linked to an active referring clinician profile."
      />
    )
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="External clinician"
        title="Clinician portal"
        description={`${data.profile.name} | ${data.profile.code}`}
        action={<Chip label={data.profile.email} />}
      />
      {message ? <Alert severity={message.kind}>{message.text}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
        <MetricCard label="Referral cases" value={String(data.stats.totalOrders)} />
        <MetricCard label="In review" value={String(data.stats.reviewOrders)} />
        <MetricCard label="Released reports" value={String(releasedOrders)} />
        <MetricCard label="Billing pending" value={String(pendingBilling)} />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '390px 1fr' } }}>
        <Stack spacing={2}>
          <SectionCard title="Authorized patient">
            <Stack spacing={1.5}>
              <TextField
                select
                label="Select patient"
                value={selectedPatientId}
                onChange={(event) => setSelectedPatientId(event.target.value)}
                fullWidth
              >
                <MenuItem value="">New patient</MenuItem>
                {data.patients.map((entry) => (
                  <MenuItem key={entry._id} value={entry._id}>
                    {entry.firstName} {entry.lastName} | {entry.dateOfBirth}
                  </MenuItem>
                ))}
              </TextField>
              {selectedPatient ? (
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  <Typography fontWeight={700}>
                    {selectedPatient.firstName} {selectedPatient.lastName}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {selectedPatient.email} | {selectedPatient.phone}
                  </Typography>
                </Paper>
              ) : (
                <Stack spacing={1.25}>
                  <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: '1fr 1fr' }}>
                    <TextField label="First name" value={patient.firstName} onChange={(event) => setPatient((current) => ({ ...current, firstName: event.target.value }))} />
                    <TextField label="Last name" value={patient.lastName} onChange={(event) => setPatient((current) => ({ ...current, lastName: event.target.value }))} />
                  </Box>
                  <TextField label="Date of birth" type="date" InputLabelProps={{ shrink: true }} value={patient.dateOfBirth} onChange={(event) => setPatient((current) => ({ ...current, dateOfBirth: event.target.value }))} />
                  <TextField select label="Gender" value={patient.gender} onChange={(event) => setPatient((current) => ({ ...current, gender: event.target.value as 'male' | 'female' | 'other' }))}>
                    <MenuItem value="female">Female</MenuItem>
                    <MenuItem value="male">Male</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </TextField>
                  <TextField label="Phone" value={patient.phone} onChange={(event) => setPatient((current) => ({ ...current, phone: event.target.value }))} />
                  <TextField label="Email" value={patient.email} onChange={(event) => setPatient((current) => ({ ...current, email: event.target.value }))} />
                  <TextField label="Address" value={patient.address} onChange={(event) => setPatient((current) => ({ ...current, address: event.target.value }))} />
                  <TextField label="Patient reference" value={patient.externalPatientId} onChange={(event) => setPatient((current) => ({ ...current, externalPatientId: event.target.value }))} />
                  <Button variant="outlined" onClick={createPatient}>
                    Save patient
                  </Button>
                </Stack>
              )}
            </Stack>
          </SectionCard>

          <SectionCard title="OCR requisition">
            <OcrOrderUpload
              endpoint="/doctors/me/orders/ocr"
              title="Upload requisition"
              buttonLabel="Create referral order"
              buildCorrections={() => ({
                source: 'clinician_portal',
                patient: selectedPatient ?? patient,
                patientId: selectedPatientId || undefined,
                testTypeIds,
                clinicalHistory,
                priority,
                payerType,
                billingAccountName,
                billingInstructions,
              })}
              onOrderCreated={() => portalState.refresh()}
            />
          </SectionCard>
        </Stack>

        <Stack spacing={2}>
          <SectionCard title="Referral order">
            <Stack spacing={2}>
              <Box sx={{ display: 'grid', gap: 1.25, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
                {data.services.map((test) => (
                  <Paper key={test._id} variant="outlined" sx={{ p: 1.25 }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={testTypeIds.includes(test._id)}
                          onChange={(event) =>
                            setTestTypeIds((current) =>
                              event.target.checked
                                ? [...current, test._id]
                                : current.filter((entry) => entry !== test._id),
                            )
                          }
                        />
                      }
                      label={`${test.code} | ${test.name} (${formatMoney(test.price)})`}
                    />
                  </Paper>
                ))}
              </Box>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
                <TextField select label="Priority" value={priority} onChange={(event) => setPriority(event.target.value as 'normal' | 'urgent')}>
                  <MenuItem value="normal">Normal</MenuItem>
                  <MenuItem value="urgent">Urgent</MenuItem>
                </TextField>
                <TextField select label="Payer" value={payerType} onChange={(event) => setPayerType(event.target.value as typeof payerType)}>
                  {payerOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField label="Billing account" value={billingAccountName} onChange={(event) => setBillingAccountName(event.target.value)} />
              </Box>
              <TextField label="Clinical history" value={clinicalHistory} onChange={(event) => setClinicalHistory(event.target.value)} multiline minRows={3} />
              <TextField label="Billing notes" value={billingInstructions} onChange={(event) => setBillingInstructions(event.target.value)} multiline minRows={2} />
              <TextField label="Order notes" value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={2} />
              <Button variant="contained" startIcon={<AssignmentTurnedInOutlinedIcon />} disabled={creating} onClick={createOrder}>
                Submit referral order
              </Button>
            </Stack>
          </SectionCard>

          <SectionCard title="Referral cases">
            {data.orders.length ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Order</TableCell>
                      <TableCell>Patient</TableCell>
                      <TableCell>Tests</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Billing</TableCell>
                      <TableCell>Report</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.orders.map((order) => (
                      <TableRow key={order._id}>
                        <TableCell>
                          <Button component={RouterLink} to={`/orders/${order._id}`} size="small">
                            {order.orderNumber}
                          </Button>
                          <Typography variant="caption" display="block" color="text.secondary">
                            {formatDateTime(order.createdAt)}
                          </Typography>
                        </TableCell>
                        <TableCell>{order.patient.firstName} {order.patient.lastName}</TableCell>
                        <TableCell>{selectedOrderTests(order)}</TableCell>
                        <TableCell>
                          <Chip size="small" label={order.status} />
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={order.financialClearance ?? 'pending'} color={order.financialClearance === 'cleared' ? 'success' : 'warning'} />
                        </TableCell>
                        <TableCell>
                          {order.reportReleased ? (
                            <Button
                              component={RouterLink}
                              to={`/orders/${order._id}`}
                              size="small"
                              startIcon={<PictureAsPdfOutlinedIcon />}
                            >
                              Released
                            </Button>
                          ) : (
                            <Chip size="small" label="Pending" variant="outlined" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <EmptyState title="No referral cases" body="Submitted referral orders will appear here." />
            )}
          </SectionCard>

          {data.orders.some((order) => order.reportReleased && order.report) ? (
            <SectionCard title="Released reports">
              <Stack spacing={1.5} divider={<Divider flexItem />}>
                {data.orders
                  .filter((order) => order.reportReleased && order.report)
                  .slice(0, 5)
                  .map((order) => (
                    <Box key={order._id}>
                      <Typography fontWeight={700}>{order.orderNumber} | {order.patient.firstName} {order.patient.lastName}</Typography>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {order.report?.diagnosis || order.report?.comment || 'Released report available.'}
                      </Typography>
                    </Box>
                  ))}
              </Stack>
            </SectionCard>
          ) : null}
        </Stack>
      </Box>
    </Stack>
  )
}

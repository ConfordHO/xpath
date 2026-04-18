import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'

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
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Tabs,
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

import { Link as RouterLink, useSearchParams } from 'react-router-dom'

import { api } from '../api'

import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusChip,
} from '../components'

import { useActionLock, useLoadable } from './shared'

import type {
  Accession,
  AiModelRegistryRecord,
  CytologyCase,
  DigitalSlideRecord,
  HydratedOrder,
  OrderWorkflowStageId,
  SafeUser,
  Slide,
  WorkflowHistoryEntry,
  WorkflowTemplate,
} from '../types'

import { formatDateTime } from '../utils'
import { errorMessage } from './shared'

function isHistologyStage(stageId: OrderWorkflowStageId | null) {
  return ['accessioning', 'grossing', 'processing', 'embedding', 'sectioning', 'staining'].includes(stageId ?? '')
}

function nextWorkflowActionLabel(order: HydratedOrder) {
  switch (order.workflowPlan.nextStageId) {
    case 'accessioning':
      return 'Start histology case'
    case 'cytology_case':
      return 'Initialize cytology case'
    case 'cytology_screening':
      return 'Open cytology screening'
    case 'cytology_qc':
      return 'Open cytology QC'
    case 'ihc':
      return 'Record IHC'
    case 'analyzer_run':
      return 'Complete analyzer run'
    case 'molecular_sendout':
      return 'Mark molecular send-out'
    case 'pathologist_review':
      return 'Send to pathologist'
    case 'report_signout':
      return 'Await sign-out'
    case 'result_release':
      return 'Await release'
    default:
      return 'View order'
  }
}

export function ReceptionistWorkflowPage() {
  const actionLock = useActionLock()
  const [tab, setTab] = useState(0)
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const usersState = useLoadable<SafeUser[]>([], [], async () => {
    const response = await api.get<SafeUser[]>('/users')
    return response.data
  })

  const technicians = usersState.data.filter((user) => user.role === 'technician')
  const receiveOrders = ordersState.data.data.filter((order) => !order.receivedAt && order.status !== 'cancelled')
  const paymentOrders = ordersState.data.data.filter(
    (order) =>
      Boolean(order.receivedAt) &&
      order.status !== 'cancelled' &&
      order.financialClearance !== 'cleared',
  )
  const courierOrders = ordersState.data.data.filter(
    (order) => order.orderSource === 'online' || Boolean(order.courierStatus),
  )
  const assignOrders = ordersState.data.data.filter(
    (order) => Boolean(order.receivedAt) && order.status !== 'cancelled' && !['completed', 'released'].includes(order.status),
  )
  const resultOrders = ordersState.data.data.filter((order) => ['completed', 'released'].includes(order.status))

  const [paymentDialog, setPaymentDialog] = useState<{
    orderId: string
    amount: number
    method: 'cash' | 'card' | 'mobile_money' | 'bank_transfer' | 'mtn_mobile_money' | 'orange_money' | 'transfer' | 'other'
    status: 'pending' | 'completed' | 'failed'
    gatewayReference: string
  } | null>(null)
  const [intakeDialog, setIntakeDialog] = useState<{
    orderId: string
    paymentCollectionStatus: HydratedOrder['paymentCollectionStatus']
    paymentCollectionMethod: HydratedOrder['paymentCollectionMethod']
    paymentCollectionAmount: number
    paymentCollectionReference: string
    transportTemperature: string
    transportCondition: string
    sampleCondition: string
    scannedCode: string
  } | null>(null)
  const [promptDialog, setPromptDialog] = useState<{
    orderId: string
    amount: number
    method: 'mtn_mobile_money' | 'orange_money' | 'cash' | 'card' | 'transfer' | 'other'
    phone: string
    email: string
    note: string
  } | null>(null)
  const [releaseDialog, setReleaseDialog] = useState<{ orderId: string; technicianId: string }>({ orderId: '', technicianId: '' })
  const [assignment, setAssignment] = useState<Record<string, string>>({})
  const [blockerDialog, setBlockerDialog] = useState<{ orderNumber: string; blockers: HydratedOrder['blockers'] } | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const visible = [receiveOrders, paymentOrders, courierOrders, assignOrders, resultOrders][tab]

  const refreshAll = () => {
    ordersState.refresh()
    usersState.refresh()
  }

  const runOrderAction = async (key: string, handler: () => Promise<void>, successMessage: string) => {
    await actionLock.runLocked(key, async () => {
      try {
        await handler()
        setFeedback({ kind: 'success', message: successMessage })
        refreshAll()
      } catch (actionError) {
        setFeedback({ kind: 'error', message: errorMessage(actionError) })
      }
    })
  }

  const openIntakeDialog = (order: HydratedOrder) => {
    setIntakeDialog({
      orderId: order._id,
      paymentCollectionStatus: order.paymentCollectionStatus ?? 'unpaid',
      paymentCollectionMethod: order.paymentCollectionMethod ?? 'cash',
      paymentCollectionAmount: order.paymentCollectionAmount ?? Math.max(0, order.testTypes.reduce((sum, item) => sum + item.price, 0)),
      paymentCollectionReference: order.paymentCollectionReference ?? '',
      transportTemperature: 'ambient',
      transportCondition: 'stable',
      sampleCondition: 'Received intact at reception',
      scannedCode: order.orderNumber,
    })
  }

  const blockerListForRelease = (order: HydratedOrder, technicianId?: string) =>
    order.blockers.filter((blocker) => {
      if (blocker.code === 'workflow_release_pending') return false
      if (blocker.code === 'technician_assignment_pending' && technicianId) return false
      return true
    })

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Receptionist workflow"
        description="Receive orders, reconcile payment, coordinate courier collection and delivery, then release each test to its correct workflow only when every prerequisite has been satisfied."
        action={<Button component={RouterLink} to="/orders/create" variant="contained">Create order</Button>}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable" allowScrollButtonsMobile>
        {['Receive', 'Payment', 'Courier', 'Route case', 'Results'].map((label) => (
          <Tab key={label} label={label.toUpperCase()} />
        ))}
      </Tabs>
      <SectionCard>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Order #</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Tests</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Next step</TableCell>
                <TableCell>Blockers</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((order) => (
                <TableRow key={order._id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.patient.firstName} {order.patient.lastName}</TableCell>
                  <TableCell>{order.testTypes.map((item) => item.code).join(', ')}</TableCell>
                  <TableCell><StatusChip status={order.status} /></TableCell>
                  <TableCell>{order.workflowPlan.nextStageLabel ?? 'Completed'}</TableCell>
                  <TableCell>{order.blockers.length ? `${order.blockers.length} open` : 'Clear'}</TableCell>
                  <TableCell>
                    {tab === 0 ? (
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                        <Button
                          disabled={actionLock.isPending(`receive-${order._id}`)}
                          onClick={() => openIntakeDialog(order)}
                        >
                          Confirm sample receipt
                        </Button>
                        <Button component={RouterLink} to={`/orders/${order._id}`}>
                          View order
                        </Button>
                      </Stack>
                    ) : null}
                    {tab === 1 ? (
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                        <Button
                          onClick={() => setPaymentDialog({
                            orderId: order._id,
                            amount: order.testTypes.reduce((sum, item) => sum + item.price, 0),
                            method: 'cash',
                            status: 'completed',
                            gatewayReference: order.paymentCollectionReference ?? '',
                          })}
                        >
                          Process payment
                        </Button>
                        <Button
                          onClick={() => setPromptDialog({
                            orderId: order._id,
                            amount: Math.max(0, order.testTypes.reduce((sum, item) => sum + item.price, 0)),
                            method: 'mtn_mobile_money',
                            phone: order.requesterNotificationPhone ?? order.patient.phone,
                            email: order.requesterNotificationEmail ?? order.patient.email,
                            note: 'Please complete payment so the lab can continue processing your sample.',
                          })}
                        >
                          Send payment prompt
                        </Button>
                        <Button component={RouterLink} to={`/orders/${order._id}`}>
                          View order
                        </Button>
                      </Stack>
                    ) : null}
                    {tab === 2 ? (
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                        {!order.courierStatus ? (
                          <Button
                            disabled={actionLock.isPending(`courier-${order._id}`)}
                            onClick={() => runOrderAction(`courier-${order._id}`, () => api.post(`/orders/${order._id}/check-in-courier`), `${order.orderNumber} added to the courier queue.`)}
                          >
                            Activate courier
                          </Button>
                        ) : null}
                        <Button component={RouterLink} to="/courier">
                          Open courier board
                        </Button>
                        <Button onClick={() => setBlockerDialog({ orderNumber: order.orderNumber, blockers: order.blockers })}>
                          View blockers
                        </Button>
                      </Stack>
                    ) : null}
                    {tab === 3 ? (
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          {order.workflowRoutes.map((route) => `${route.testCode}: ${route.stages.join(' → ')}`).join(' | ')}
                        </Typography>
                        {order.workflowPlan.requiresTechnician ? (
                          <Stack direction="row" spacing={1}>
                            <FormControl size="small" sx={{ minWidth: 180 }}>
                              <Select
                                value={assignment[order._id] ?? (releaseDialog.orderId === order._id ? releaseDialog.technicianId : '')}
                                displayEmpty
                                onChange={(event) => {
                                  const value = String(event.target.value)
                                  setAssignment((prev) => ({ ...prev, [order._id]: value }))
                                  setReleaseDialog((prev) => ({ ...prev, orderId: order._id, technicianId: value }))
                                }}
                              >
                                <MenuItem value="">Select technician</MenuItem>
                                {technicians.map((tech) => (
                                  <MenuItem key={tech._id} value={tech._id}>{tech.name}</MenuItem>
                                ))}
                              </Select>
                            </FormControl>
                            <Button
                              disabled={actionLock.isPending(`release-${order._id}`)}
                              onClick={async () => {
                                const technicianId = assignment[order._id] ?? releaseDialog.technicianId
                                const blockers = blockerListForRelease(order, technicianId)
                                if (blockers.length) {
                                  setBlockerDialog({ orderNumber: order.orderNumber, blockers })
                                  return
                                }
                                await runOrderAction(
                                  `release-${order._id}`,
                                  () => api.post(`/orders/${order._id}/release-to-lab`, { technicianId: technicianId || null, scannedCode: order.orderNumber }),
                                  `${order.orderNumber} released to the lab workflow.`,
                                )
                                setAssignment((prev) => ({ ...prev, [order._id]: '' }))
                                setReleaseDialog({ orderId: '', technicianId: '' })
                              }}
                            >
                              Release to lab
                            </Button>
                          </Stack>
                        ) : (
                          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                            <Button
                              disabled={actionLock.isPending(`release-${order._id}`)}
                              onClick={async () => {
                                const blockers = blockerListForRelease(order)
                                if (blockers.length) {
                                  setBlockerDialog({ orderNumber: order.orderNumber, blockers })
                                  return
                                }
                                await runOrderAction(
                                  `release-${order._id}`,
                                  () => api.post(`/orders/${order._id}/release-to-lab`, { scannedCode: order.orderNumber }),
                                  `${order.orderNumber} released to the lab workflow.`,
                                )
                              }}
                            >
                              Release to pathologist workflow
                            </Button>
                            <Button onClick={() => setBlockerDialog({ orderNumber: order.orderNumber, blockers: order.blockers })}>
                              Review blockers
                            </Button>
                          </Stack>
                        )}
                      </Stack>
                    ) : null}
                    {tab === 4 ? (
                      <Button component={RouterLink} to={`/orders/${order._id}`}>
                        View result
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              {!visible.length ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <Typography color="text.secondary">No orders in this queue right now.</Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={!!intakeDialog} onClose={() => setIntakeDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Confirm reception intake</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Payment collection status</InputLabel>
              <Select
                label="Payment collection status"
                value={intakeDialog?.paymentCollectionStatus ?? 'unpaid'}
                onChange={(event) =>
                  setIntakeDialog((prev) =>
                    prev
                      ? {
                          ...prev,
                          paymentCollectionStatus: String(event.target.value) as NonNullable<HydratedOrder['paymentCollectionStatus']>,
                        }
                      : null,
                  )
                }
              >
                <MenuItem value="unpaid">Unpaid</MenuItem>
                <MenuItem value="cash_with_courier">Cash with courier</MenuItem>
                <MenuItem value="paid_online">Paid online</MenuItem>
                <MenuItem value="payment_prompt_sent">Payment prompt already sent</MenuItem>
                <MenuItem value="cash_received_at_reception">Cash received at reception</MenuItem>
                <MenuItem value="reconciled">Already reconciled</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Payment method</InputLabel>
              <Select
                label="Payment method"
                value={intakeDialog?.paymentCollectionMethod ?? 'cash'}
                onChange={(event) =>
                  setIntakeDialog((prev) =>
                    prev
                      ? {
                          ...prev,
                          paymentCollectionMethod: String(event.target.value) as NonNullable<HydratedOrder['paymentCollectionMethod']>,
                        }
                      : null,
                  )
                }
              >
                <MenuItem value="cash">Cash</MenuItem>
                <MenuItem value="card">Card</MenuItem>
                <MenuItem value="mobile_money">Mobile money</MenuItem>
                <MenuItem value="mtn_mobile_money">MTN Mobile Money</MenuItem>
                <MenuItem value="orange_money">Orange Money</MenuItem>
                <MenuItem value="bank_transfer">Bank transfer</MenuItem>
                <MenuItem value="transfer">Transfer</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Amount collected / expected"
              type="number"
              value={intakeDialog?.paymentCollectionAmount ?? 0}
              onChange={(event) =>
                setIntakeDialog((prev) => (prev ? { ...prev, paymentCollectionAmount: Number(event.target.value) } : null))
              }
            />
            <TextField
              label="Reference"
              value={intakeDialog?.paymentCollectionReference ?? ''}
              onChange={(event) =>
                setIntakeDialog((prev) => (prev ? { ...prev, paymentCollectionReference: event.target.value } : null))
              }
            />
            <TextField
              label="Scan order/case barcode"
              value={intakeDialog?.scannedCode ?? ''}
              helperText="Required before receipt can be confirmed."
              onChange={(event) =>
                setIntakeDialog((prev) => (prev ? { ...prev, scannedCode: event.target.value } : null))
              }
            />
            <TextField
              label="Transport temperature"
              value={intakeDialog?.transportTemperature ?? ''}
              onChange={(event) =>
                setIntakeDialog((prev) => (prev ? { ...prev, transportTemperature: event.target.value } : null))
              }
            />
            <TextField
              label="Transport condition"
              value={intakeDialog?.transportCondition ?? ''}
              onChange={(event) =>
                setIntakeDialog((prev) => (prev ? { ...prev, transportCondition: event.target.value } : null))
              }
            />
            <TextField
              label="Sample condition at reception"
              value={intakeDialog?.sampleCondition ?? ''}
              onChange={(event) =>
                setIntakeDialog((prev) => (prev ? { ...prev, sampleCondition: event.target.value } : null))
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIntakeDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!intakeDialog || actionLock.isPending(`receive-${intakeDialog.orderId}`)}
            onClick={async () => {
              if (!intakeDialog) return
              await runOrderAction(
                `receive-${intakeDialog.orderId}`,
                () => api.post(`/orders/${intakeDialog.orderId}/reception-intake`, intakeDialog),
                'Reception intake saved.',
              )
              setIntakeDialog(null)
            }}
          >
            Save intake
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!paymentDialog} onClose={() => setPaymentDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Process payment</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Amount"
              type="number"
              fullWidth
              value={paymentDialog?.amount ?? 0}
              onChange={(event) => setPaymentDialog((prev) => (prev ? { ...prev, amount: Number(event.target.value) } : null))}
            />
            <FormControl fullWidth>
              <InputLabel>Method</InputLabel>
              <Select
                label="Method"
                value={paymentDialog?.method ?? 'cash'}
                onChange={(event) =>
                  setPaymentDialog((prev) =>
                    prev
                      ? { ...prev, method: String(event.target.value) as NonNullable<typeof prev.method> }
                      : null,
                  )
                }
              >
                <MenuItem value="cash">Cash</MenuItem>
                <MenuItem value="card">Card</MenuItem>
                <MenuItem value="mobile_money">Mobile money</MenuItem>
                <MenuItem value="mtn_mobile_money">MTN Mobile Money</MenuItem>
                <MenuItem value="orange_money">Orange Money</MenuItem>
                <MenuItem value="bank_transfer">Bank transfer</MenuItem>
                <MenuItem value="transfer">Transfer</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={paymentDialog?.status ?? 'completed'}
                onChange={(event) => setPaymentDialog((prev) => (prev ? { ...prev, status: String(event.target.value) as 'pending' | 'completed' | 'failed' } : null))}
              >
                <MenuItem value="completed">Completed</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="failed">Failed</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Gateway / transaction reference"
              value={paymentDialog?.gatewayReference ?? ''}
              onChange={(event) =>
                setPaymentDialog((prev) => (prev ? { ...prev, gatewayReference: event.target.value } : null))
              }
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPaymentDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!paymentDialog) return
              await runOrderAction(
                `payment-${paymentDialog.orderId}`,
                () => api.post(`/orders/${paymentDialog.orderId}/payment`, paymentDialog),
                'Payment recorded for the selected order.',
              )
              setPaymentDialog(null)
            }}
            disabled={!paymentDialog || actionLock.isPending(`payment-${paymentDialog.orderId}`)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!promptDialog} onClose={() => setPromptDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Send payment prompt</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Amount"
              type="number"
              value={promptDialog?.amount ?? 0}
              onChange={(event) =>
                setPromptDialog((prev) => (prev ? { ...prev, amount: Number(event.target.value) } : null))
              }
            />
            <FormControl fullWidth>
              <InputLabel>Method</InputLabel>
              <Select
                label="Method"
                value={promptDialog?.method ?? 'mtn_mobile_money'}
                onChange={(event) =>
                  setPromptDialog((prev) =>
                    prev
                      ? {
                          ...prev,
                          method: String(event.target.value) as 'mtn_mobile_money' | 'orange_money' | 'cash' | 'card' | 'transfer' | 'other',
                        }
                      : null,
                  )
                }
              >
                <MenuItem value="mtn_mobile_money">MTN Mobile Money</MenuItem>
                <MenuItem value="orange_money">Orange Money</MenuItem>
                <MenuItem value="cash">Cash</MenuItem>
                <MenuItem value="card">Card</MenuItem>
                <MenuItem value="transfer">Transfer</MenuItem>
                <MenuItem value="other">Other</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Phone"
              value={promptDialog?.phone ?? ''}
              onChange={(event) => setPromptDialog((prev) => (prev ? { ...prev, phone: event.target.value } : null))}
            />
            <TextField
              label="Email"
              value={promptDialog?.email ?? ''}
              onChange={(event) => setPromptDialog((prev) => (prev ? { ...prev, email: event.target.value } : null))}
            />
            <TextField
              label="Note"
              multiline
              minRows={3}
              value={promptDialog?.note ?? ''}
              onChange={(event) => setPromptDialog((prev) => (prev ? { ...prev, note: event.target.value } : null))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPromptDialog(null)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!promptDialog || actionLock.isPending(`payment-prompt-${promptDialog.orderId}`)}
            onClick={async () => {
              if (!promptDialog) return
              await runOrderAction(
                `payment-prompt-${promptDialog.orderId}`,
                () => api.post(`/orders/${promptDialog.orderId}/send-payment-prompt`, promptDialog),
                'Payment prompt sent to the requester.',
              )
              setPromptDialog(null)
            }}
          >
            Send prompt
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!blockerDialog} onClose={() => setBlockerDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Skipped step reminder</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography>
              {blockerDialog?.orderNumber} still has prerequisite steps that must be completed before this action can continue.
            </Typography>
            {blockerDialog?.blockers.map((blocker) => (
              <Paper key={blocker.code} variant="outlined" sx={{ p: 2 }}>
                <Typography fontWeight={700}>{blocker.title}</Typography>
                <Typography color="text.secondary">Owner: {blocker.ownerRole}</Typography>
                <Typography sx={{ mt: 0.75 }}>{blocker.message}</Typography>
              </Paper>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBlockerDialog(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function TechnicianWorkflowPage() {
  const actionLock = useActionLock()
  const [tab, setTab] = useState(0)
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const accessionsState = useLoadable<Accession[]>([], [], async () => {
    const response = await api.get<Accession[]>('/accessions')
    return response.data
  })
  const usersState = useLoadable<SafeUser[]>([], [], async () => {
    const response = await api.get<SafeUser[]>('/users')
    return response.data
  })
  const pathologists = usersState.data.filter((user) => user.role === 'pathologist')
  const [reviewDialog, setReviewDialog] = useState<{ orderId: string; pathologistId: string }>({ orderId: '', pathologistId: '' })
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const technicalOrders = ordersState.data.data.filter((order) => order.workflowPlan.requiresTechnician)
  const visible = technicalOrders.filter((order) => {
    if (tab === 1) return order.status === 'received'
    if (tab === 2) return order.status === 'in_progress'
    if (tab === 3) return order.status === 'review'
    return true
  })
  const accessionByOrderId = new Map(accessionsState.data.map((entry) => [entry.orderId, entry]))

  const refreshAll = () => {
    ordersState.refresh()
    usersState.refresh()
    accessionsState.refresh()
  }

  const runOrderAction = async (key: string, handler: () => Promise<void>, successMessage: string) => {
    await actionLock.runLocked(key, async () => {
      try {
        await handler()
        setFeedback({ kind: 'success', message: successMessage })
        refreshAll()
      } catch (actionError) {
        setFeedback({ kind: 'error', message: errorMessage(actionError) })
      }
    })
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Technician workflow"
        description="Each case follows its own route automatically. Tissue cases flow to histology, cytology cases to cytology QC, and analyzer / molecular orders stay out of the tissue queue."
        action={<Button component={RouterLink} to="/histology">Open histology</Button>}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Tabs value={tab} onChange={(_event, value) => setTab(value)}>
        {['All', 'Pending', 'In progress', 'Completed'].map((label) => (
          <Tab key={label} label={label.toUpperCase()} />
        ))}
      </Tabs>
      <SectionCard>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Order #</TableCell>
                <TableCell>Patient</TableCell>
                <TableCell>Route</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Next step</TableCell>
                <TableCell>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((order) => (
                <TableRow key={order._id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.patient.firstName} {order.patient.lastName}</TableCell>
                  <TableCell>{order.workflowPlan.summary}</TableCell>
                  <TableCell><StatusChip status={order.status} /></TableCell>
                  <TableCell>{order.workflowPlan.nextStageLabel ?? 'Completed'}</TableCell>
                  <TableCell>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                      {order.workflowPlan.nextStageId === 'accessioning' || order.workflowPlan.nextStageId === 'cytology_case' ? (
                        <Button
                          disabled={actionLock.isPending(`start-${order._id}`)}
                          onClick={() => runOrderAction(
                            `start-${order._id}`,
                            () => api.post(`/orders/${order._id}/start-processing`, { scannedCode: order.orderNumber }),
                            order.workflowPlan.nextStageId === 'cytology_case'
                              ? `${order.orderNumber} initialized in the cytology queue.`
                              : `${order.orderNumber} accessioned and moved to histology.`,
                          )}
                        >
                          {nextWorkflowActionLabel(order)}
                        </Button>
                      ) : null}
                      {order.workflowPlan.nextStageId === 'analyzer_run' || order.workflowPlan.nextStageId === 'molecular_sendout' ? (
                        <Button
                          disabled={actionLock.isPending(`technical-${order._id}`)}
                          onClick={() =>
                            runOrderAction(
                              `technical-${order._id}`,
                              () =>
                                api.post(`/orders/${order._id}/complete-technical-step`, {
                                  stageId: order.workflowPlan.nextStageId,
                                  scannedCode: accessionByOrderId.get(order._id)?.accessionId ?? order.orderNumber,
                                }),
                              `${order.orderNumber} completed ${order.workflowPlan.nextStageLabel?.toLowerCase() ?? 'the technical step'}.`,
                            )
                          }
                        >
                          {nextWorkflowActionLabel(order)}
                        </Button>
                      ) : null}
                      {isHistologyStage(order.workflowPlan.nextStageId) && accessionByOrderId.get(order._id) ? (
                        <Button
                          component={RouterLink}
                          to={`/histology?accession=${encodeURIComponent(accessionByOrderId.get(order._id)?.accessionId ?? '')}`}
                        >
                          Continue histology
                        </Button>
                      ) : null}
                      {order.workflowPlan.nextStageId === 'ihc' && accessionByOrderId.get(order._id) ? (
                        <Button
                          component={RouterLink}
                          to={`/ihc?accession=${encodeURIComponent(accessionByOrderId.get(order._id)?.accessionId ?? '')}`}
                        >
                          Record IHC
                        </Button>
                      ) : null}
                      {order.workflowPlan.nextStageId === 'cytology_screening' || order.workflowPlan.nextStageId === 'cytology_qc' ? (
                        <Button component={RouterLink} to={`/cytology/cases?order=${encodeURIComponent(order._id)}`}>
                          {order.workflowPlan.nextStageId === 'cytology_screening' ? 'Open cytology screening' : 'Open cytology QC'}
                        </Button>
                      ) : null}
                      {order.workflowPlan.reviewReady ? (
                        <Button
                          onClick={() => setReviewDialog({ orderId: order._id, pathologistId: order.assignedPathologist?._id ?? '' })}
                        >
                          Send to pathologist
                        </Button>
                      ) : null}
                      <Button component={RouterLink} to={`/orders/${order._id}`}>
                        View order
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

      <Dialog open={!!reviewDialog.orderId} onClose={() => setReviewDialog({ orderId: '', pathologistId: '' })} maxWidth="xs" fullWidth>
        <DialogTitle>Assign pathologist</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Pathologist</InputLabel>
            <Select label="Pathologist" value={reviewDialog.pathologistId} onChange={(event) => setReviewDialog((prev) => ({ ...prev, pathologistId: String(event.target.value) }))}>
              <MenuItem value="">Unassigned</MenuItem>
              {pathologists.map((user) => (
                <MenuItem key={user._id} value={user._id}>{user.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReviewDialog({ orderId: '', pathologistId: '' })}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              await runOrderAction(
                `review-${reviewDialog.orderId}`,
                () => {
                  const accession = accessionByOrderId.get(reviewDialog.orderId)
                  const order = ordersState.data.data.find((entry) => entry._id === reviewDialog.orderId)
                  return api.post(`/orders/${reviewDialog.orderId}/ready-for-review`, {
                    pathologistId: reviewDialog.pathologistId || null,
                    scannedCode: accession?.accessionId ?? order?.orderNumber ?? '',
                  })
                },
                'Case sent to pathologist review queue.',
              )
              setReviewDialog({ orderId: '', pathologistId: '' })
            }}
            disabled={!reviewDialog.orderId || actionLock.isPending(`review-${reviewDialog.orderId}`)}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function PathologistWorkflowPage() {
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders', { params: { status: 'review' } })
    return response.data
  })
  return (
    <Stack spacing={3}>
      <PageHeader
        title="Pathologist workflow"
        description="Open the case workspace to review accession context, write the report, complete sign-out, and release the final result."
        action={<Button component={RouterLink} to="/reports">Open released reports</Button>}
      />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
        <Paper sx={{ p: 3 }}><Typography variant="overline">Review queue</Typography><Typography variant="h4">{ordersState.data.data.length}</Typography></Paper>
        <Paper sx={{ p: 3 }}><Typography variant="overline">Urgent review</Typography><Typography variant="h4">{ordersState.data.data.filter((order) => order.priority === 'urgent').length}</Typography></Paper>
        <Paper sx={{ p: 3 }}><Typography variant="overline">Assigned</Typography><Typography variant="h4">{ordersState.data.data.filter((order) => order.assignedPathologist?._id).length}</Typography></Paper>
      </Box>
      <SectionCard>
        {ordersState.data.data.length ? (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Order #</TableCell>
                  <TableCell>Patient</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Assigned pathologist</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ordersState.data.data.map((order) => (
                  <TableRow key={order._id}>
                    <TableCell>{order.orderNumber}</TableCell>
                    <TableCell>{order.patient.firstName} {order.patient.lastName}</TableCell>
                    <TableCell><StatusChip status={order.status} /></TableCell>
                    <TableCell>{order.assignedPathologist?.name ?? 'Unassigned'}</TableCell>
                    <TableCell>
                      <Button component={RouterLink} to={`/orders/${order._id}`}>
                        Review & report
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState title="No cases are awaiting review." body="Once technicians complete staining and submit for review, cases will appear here." />
        )}
      </SectionCard>
    </Stack>
  )
}

export function HistologyPage() {
  const actionLock = useActionLock()
  const [searchParams] = useSearchParams()
  const accessionsState = useLoadable<Accession[]>([], [], async () => {
    const response = await api.get<Accession[]>('/accessions')
    return response.data
  })
  const [accessionId, setAccessionId] = useState('')
  const [selected, setSelected] = useState<any>(null)
  const [grossDescription, setGrossDescription] = useState('')
  const [blockCount, setBlockCount] = useState(1)
  const [processingNotes, setProcessingNotes] = useState('')
  const [blockId, setBlockId] = useState('')
  const [slideId, setSlideId] = useState('')
  const [slideCount, setSlideCount] = useState(1)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const search = async (targetAccessionId = accessionId) => {
    if (!targetAccessionId.trim()) {
      setFeedback({ kind: 'error', message: 'Enter an accession ID to continue.' })
      return
    }
    try {
      const response = await api.get(`/accessions/search/${targetAccessionId}`)
      setSelected(response.data)
      setGrossDescription(response.data.accession.grossDescription ?? '')
      setBlockCount(response.data.accession.numberOfBlocks || response.data.accession.blocks.length || 1)
      setProcessingNotes(response.data.accession.processingNotes ?? '')
      setBlockId(response.data.accession.blocks[0]?.blockId ?? '')
      setSlideId(response.data.accession.blocks[0]?.slides[0]?.slideId ?? '')
      setFeedback(null)
    } catch (searchError) {
      setFeedback({ kind: 'error', message: errorMessage(searchError) })
    }
  }

  useEffect(() => {
    const requestedAccessionId = searchParams.get('accession')
    if (!requestedAccessionId) {
      return
    }
    setAccessionId(requestedAccessionId)
    void search(requestedAccessionId)
  }, [searchParams])

  const runHistologyAction = async (key: string, handler: () => Promise<void>, successMessage: string) => {
    await actionLock.runLocked(key, async () => {
      try {
        await handler()
        await search(selected?.accession.accessionId ?? accessionId)
        accessionsState.refresh()
        setFeedback({ kind: 'success', message: successMessage })
      } catch (actionError) {
        setFeedback({ kind: 'error', message: errorMessage(actionError) })
      }
    })
  }

  
  const selectedBlock = selected?.accession.blocks.find((block: any) => block.blockId === blockId)
  const selectedSlides = selected?.accession.blocks.flatMap((block: any) => block.slides) ?? []

  return (
    <Stack spacing={3}>
      <PageHeader title="Histology" description="Grossing → Processing → Embedding → Sectioning → Staining. Use Accession ID for grossing and processing; use Block ID for embedding and sectioning; use Slide ID for staining. QR codes are shown for each ID — scan them or click to fill the form." />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, 1fr)' } }}>
        <SectionCard title="Grossing">
          <Stack spacing={2}>
            <TextField label="Accession ID" value={accessionId} onChange={(event) => setAccessionId(event.target.value)} />
            <Button onClick={() => void search()}>Search / Look up</Button>
            <TextField label="Gross description (required)" multiline minRows={3} value={grossDescription} onChange={(event) => setGrossDescription(event.target.value)} />
            <TextField label="Number of blocks" type="number" value={blockCount} onChange={(event) => setBlockCount(Number(event.target.value))} />
            <Button
              disabled={!selected || !grossDescription.trim() || blockCount <= 0 || actionLock.isPending(`grossing-${selected?.accession._id ?? ''}`)}
              variant="contained"
              onClick={() => runHistologyAction(
                `grossing-${selected.accession._id}`,
                () => api.post(`/accessions/${selected.accession._id}/grossing`, {
                  grossDescription,
                  numberOfBlocks: blockCount,
                  scannedCode: accessionId,
                }),
                'Grossing saved and case moved to processing.',
              )}
            >
              Save grossing
            </Button>
          </Stack>
        </SectionCard>
        <SectionCard title="Pending grossing" description="Accessions whose order is not yet grossed. After you save grossing, the order moves to the next step and leaves this list.">
          <Stack spacing={1.5}>
            {accessionsState.data.filter((item) => !item.grossedAt).map((item) => (
              <Paper key={item._id} sx={{ p: 2 }}>
                <Typography fontWeight={700}>{item.accessionId}</Typography>
                <Button
                  sx={{ mt: 1.5 }}
                  onClick={() => {
                    setAccessionId(item.accessionId)
                    void search(item.accessionId)
                  }}
                >
                  Open accession
                </Button>
              </Paper>
            ))}
          </Stack>
        </SectionCard>
      </Box>
      {selected ? (
        <Stack spacing={2}>
          <SectionCard title="Selected accession">
            <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' } }}>
              <Paper sx={{ p: 2 }}><Typography variant="overline">Accession</Typography><Typography variant="h6">{selected.accession.accessionId}</Typography></Paper>
              <Paper sx={{ p: 2 }}><Typography variant="overline">Grossing</Typography><Typography variant="h6">{selected.accession.grossedAt ? 'Done' : 'Pending'}</Typography></Paper>
              <Paper sx={{ p: 2 }}><Typography variant="overline">Processing</Typography><Typography variant="h6">{selected.accession.processedAt ? 'Done' : 'Pending'}</Typography></Paper>
              <Paper sx={{ p: 2 }}><Typography variant="overline">Staining</Typography><Typography variant="h6">{selected.accession.stainedAt ? 'Done' : 'Pending'}</Typography></Paper>
            </Box>
          </SectionCard>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, 1fr)' } }}>
            <SectionCard title="Processing">
              <Stack spacing={2}>
                <TextField label="Processing notes" value={processingNotes} onChange={(event) => setProcessingNotes(event.target.value)} />
                <Button
                  disabled={!selected.accession.grossedAt || actionLock.isPending(`processing-${selected.accession._id}`)}
                  variant="contained"
                  onClick={() => runHistologyAction(
                    `processing-${selected.accession._id}`,
                    () => api.post(`/accessions/${selected.accession._id}/processing`, {
                      processingNotes,
                      scannedCode: accessionId,
                    }),
                    'Processing notes saved.',
                  )}
                >
                  Save processing
                </Button>
              </Stack>
            </SectionCard>
            <SectionCard title="Embedding">
              <Stack spacing={2}>
                <FormControl>
                  <InputLabel>Block ID</InputLabel>
                  <Select label="Block ID" value={blockId} onChange={(event) => setBlockId(String(event.target.value))}>
                    {selected.accession.blocks.map((block: any) => (
                      <MenuItem key={block.blockId} value={block.blockId}>{block.blockId}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary">
                  Choose a histology block to embed and later section into slides.
                </Typography>
                <Button
                  disabled={!selected.accession.processedAt || !blockId || actionLock.isPending(`embedding-${selected.accession._id}-${blockId}`)}
                  variant="contained"
                  onClick={() => runHistologyAction(
                    `embedding-${selected.accession._id}-${blockId}`,
                    () => api.post(`/accessions/${selected.accession._id}/embedding`, {
                      blockId,
                      scannedCode: blockId,
                    }),
                    `${blockId} embedded successfully.`,
                  )}
                >
                  Save embedding
                </Button>
              </Stack>
            </SectionCard>
            <SectionCard title="Sectioning">
              <Stack spacing={2}>
                <TextField label="Slide count" type="number" value={slideCount} onChange={(event) => setSlideCount(Number(event.target.value))} />
                <Typography variant="body2" color="text.secondary">
                  Selected block: {selectedBlock?.blockId ?? 'Choose a block'}.
                </Typography>
                <Button
                  disabled={!selectedBlock?.embeddedAt || slideCount <= 0 || actionLock.isPending(`section-${selected.accession._id}-${blockId}`)}
                  variant="contained"
                  onClick={() => runHistologyAction(
                    `section-${selected.accession._id}-${blockId}`,
                    () => api.post(`/accessions/${selected.accession._id}/sectioning`, {
                      blockId,
                      slideCount,
                      scannedCode: blockId,
                    }),
                    `${slideCount} slide(s) created from ${blockId}.`,
                  )}
                >
                  Save sectioning
                </Button>
              </Stack>
            </SectionCard>
            <SectionCard title="Staining">
              <Stack spacing={2}>
                <FormControl>
                  <InputLabel>Slide ID</InputLabel>
                  <Select label="Slide ID" value={slideId} onChange={(event) => setSlideId(String(event.target.value))}>
                    {selectedSlides.map((slide: Slide) => (
                      <MenuItem key={slide.slideId} value={slide.slideId}>{slide.slideId}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary">
                  Slides become eligible here after sectioning is complete.
                </Typography>
                <Button
                  disabled={!slideId || actionLock.isPending(`stain-${selected.accession._id}-${slideId}`)}
                  variant="contained"
                  onClick={() => runHistologyAction(
                    `stain-${selected.accession._id}-${slideId}`,
                    () => api.post(`/accessions/${selected.accession._id}/staining`, {
                      slideId,
                      stainType: 'H&E',
                      scannedCode: slideId,
                    }),
                    `${slideId} stained and ready for digital/review workflows.`,
                  )}
                >
                  Save staining
                </Button>
              </Stack>
            </SectionCard>
          </Box>
        </Stack>
      ) : null}
    </Stack>
  )
}

export function IhcPage() {
  const actionLock = useActionLock()
  const [searchParams] = useSearchParams()
  const [accessionId, setAccessionId] = useState('')
  const [result, setResult] = useState<{ accession: Accession; slides: Slide[] } | null>(null)
  const [slideId, setSlideId] = useState('')
  const [form, setForm] = useState({
    antibody: '',
    clone: '',
    antigenRetrieval: '',
    detection: '',
    counterstain: '',
    lotNumber: '',
    controlSlideStatus: 'pass' as 'pass' | 'pending' | 'fail',
    quantity: 1,
    qcNotes: '',
  })
  const [specialForm, setSpecialForm] = useState({
    requestType: 'special_stain' as 'recut' | 'special_stain' | 'ihc',
    stainName: 'PAS',
    reason: '',
    lotNumber: '',
    billingReference: '',
  })
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  const search = async () => {
    if (!accessionId.trim()) {
      setFeedback({ kind: 'error', message: 'Enter an accession ID to continue.' })
      return
    }
    try {
      const response = await api.get(`/ihc/search/${accessionId}`)
      setResult(response.data)
      setSlideId(response.data.slides[0]?.slideId ?? '')
      setFeedback(null)
    } catch (searchError) {
      setFeedback({ kind: 'error', message: errorMessage(searchError) })
    }
  }

  const selectedSlide = result?.slides.find((slide) => slide.slideId === slideId)

  useEffect(() => {
    const requestedAccessionId = searchParams.get('accession')
    if (!requestedAccessionId) {
      return
    }
    setAccessionId(requestedAccessionId)
    void (async () => {
      try {
        const response = await api.get(`/ihc/search/${requestedAccessionId}`)
        setResult(response.data)
        setSlideId(response.data.slides[0]?.slideId ?? '')
        setFeedback(null)
      } catch (searchError) {
        setFeedback({ kind: 'error', message: errorMessage(searchError) })
      }
    })()
  }, [searchParams])

  return (
    <Stack spacing={3}>
      <PageHeader title="IHC (Immunohistochemistry)" description="Look up an accession to see blocks and slides from Histology. Select a slide and record IHC stains (antibody, clone, antigen retrieval, detection, counterstain, QC)." />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <SectionCard title="Look up accession">
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField label="Accession ID" value={accessionId} onChange={(event) => setAccessionId(event.target.value)} />
          <Button onClick={search}>Search</Button>
        </Stack>
      </SectionCard>
      <SectionCard title="Record IHC stain">
        {result ? (
          <Stack spacing={2}>
            <FormControl>
              <InputLabel>Slide</InputLabel>
              <Select label="Slide" value={slideId} onChange={(event) => setSlideId(String(event.target.value))}>
                {result.slides.map((slide) => (
                  <MenuItem key={slide.slideId} value={slide.slideId}>{slide.slideId}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField label="Antibody" value={form.antibody} onChange={(event) => setForm((prev) => ({ ...prev, antibody: event.target.value }))} />
            <TextField label="Clone" value={form.clone} onChange={(event) => setForm((prev) => ({ ...prev, clone: event.target.value }))} />
            <TextField label="Antigen retrieval" value={form.antigenRetrieval} onChange={(event) => setForm((prev) => ({ ...prev, antigenRetrieval: event.target.value }))} />
            <TextField label="Detection" value={form.detection} onChange={(event) => setForm((prev) => ({ ...prev, detection: event.target.value }))} />
            <TextField label="Counterstain" value={form.counterstain} onChange={(event) => setForm((prev) => ({ ...prev, counterstain: event.target.value }))} />
            <TextField label="Antibody lot number" value={form.lotNumber} onChange={(event) => setForm((prev) => ({ ...prev, lotNumber: event.target.value }))} />
            <FormControl>
              <InputLabel>Control slide result</InputLabel>
              <Select label="Control slide result" value={form.controlSlideStatus} onChange={(event) => setForm((prev) => ({ ...prev, controlSlideStatus: String(event.target.value) as 'pass' | 'pending' | 'fail' }))}>
                <MenuItem value="pass">Pass</MenuItem>
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="fail">Fail</MenuItem>
              </Select>
            </FormControl>
            <TextField label="Inventory quantity used" type="number" value={form.quantity} onChange={(event) => setForm((prev) => ({ ...prev, quantity: Number(event.target.value) }))} />
            <TextField label="QC notes" multiline minRows={3} value={form.qcNotes} onChange={(event) => setForm((prev) => ({ ...prev, qcNotes: event.target.value }))} />
            <Button
              disabled={!slideId || !form.antibody.trim() || !form.clone.trim() || actionLock.isPending(`ihc-${slideId}`)}
              variant="contained"
              onClick={async () => {
                await actionLock.runLocked(`ihc-${slideId}`, async () => {
                  try {
                    await api.post(`/slides/${slideId}/ihc`, {
                      ...form,
                      scannedCode: slideId,
                    })
                    setForm({
                      antibody: '',
                      clone: '',
                      antigenRetrieval: '',
                      detection: '',
                      counterstain: '',
                      lotNumber: '',
                      controlSlideStatus: 'pass',
                      quantity: 1,
                      qcNotes: '',
                    })
                    setFeedback({ kind: 'success', message: `IHC stain recorded for ${slideId}.` })
                    await search()
                  } catch (saveError) {
                    setFeedback({ kind: 'error', message: errorMessage(saveError) })
                  }
                })
              }}
            >
              Record IHC stain
            </Button>
            <SectionCard title="Existing entries">
              {selectedSlide?.ihcEntries.length ? (
                <Stack spacing={1.5}>
                  {selectedSlide.ihcEntries.map((entry) => (
                    <Paper key={entry._id} sx={{ p: 2 }}>
                      <Typography fontWeight={700}>{entry.antibody} / {entry.clone}</Typography>
                      <Typography color="text.secondary">{entry.detection} · {entry.counterstain}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        {entry.qcNotes || 'No QC notes recorded.'}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <EmptyState title="No IHC entries yet." body="Record the first IHC result for the selected slide above." />
              )}
            </SectionCard>
            <SectionCard title="Request recut or special stain" description="Creates a controlled request with approval, billing reference, worklist, and inventory drawdown when completed.">
              <Stack spacing={2}>
                <FormControl>
                  <InputLabel>Request type</InputLabel>
                  <Select label="Request type" value={specialForm.requestType} onChange={(event) => setSpecialForm((prev) => ({ ...prev, requestType: String(event.target.value) as 'recut' | 'special_stain' | 'ihc' }))}>
                    <MenuItem value="recut">Re-cut</MenuItem>
                    <MenuItem value="special_stain">Special stain</MenuItem>
                    <MenuItem value="ihc">IHC add-on</MenuItem>
                  </Select>
                </FormControl>
                <TextField label="Stain / recut name" value={specialForm.stainName} onChange={(event) => setSpecialForm((prev) => ({ ...prev, stainName: event.target.value }))} />
                <TextField label="Reason / approval note" multiline minRows={2} value={specialForm.reason} onChange={(event) => setSpecialForm((prev) => ({ ...prev, reason: event.target.value }))} />
                <TextField label="Lot number" value={specialForm.lotNumber} onChange={(event) => setSpecialForm((prev) => ({ ...prev, lotNumber: event.target.value }))} />
                <TextField label="Billing reference" value={specialForm.billingReference} onChange={(event) => setSpecialForm((prev) => ({ ...prev, billingReference: event.target.value }))} />
                <Button
                  variant="outlined"
                  disabled={!slideId || !specialForm.stainName.trim() || !specialForm.reason.trim() || actionLock.isPending(`special-${slideId}`)}
                  onClick={async () => {
                    await actionLock.runLocked(`special-${slideId}`, async () => {
                      try {
                        await api.post(`/slides/${slideId}/special-stains`, specialForm)
                        setSpecialForm({ requestType: 'special_stain', stainName: 'PAS', reason: '', lotNumber: '', billingReference: '' })
                        setFeedback({ kind: 'success', message: `Controlled stain request created for ${slideId}.` })
                      } catch (saveError) {
                        setFeedback({ kind: 'error', message: errorMessage(saveError) })
                      }
                    })
                  }}
                >
                  Create controlled request
                </Button>
              </Stack>
            </SectionCard>
          </Stack>
        ) : (
          <EmptyState title="Record IHC stain" body="Select a slide from the list to record an IHC stain." />
        )}
      </SectionCard>
    </Stack>
  )
}

export function CytologyCasesPage() {
  const actionLock = useActionLock()
  const [searchParams] = useSearchParams()
  const casesState = useLoadable<CytologyCase[]>([], [], async () => {
    const response = await api.get('/cytology/cases')
    return response.data
  })
  const ordersState = useLoadable<{ data: HydratedOrder[] }>({ data: [] }, [], async () => {
    const response = await api.get('/orders')
    return response.data
  })
  const [orderId, setOrderId] = useState('')
  const [specimenType, setSpecimenType] = useState('Cervical smear')
  const [remarks, setRemarks] = useState('')
  const [editing, setEditing] = useState<CytologyCase | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const orderMap = new Map(ordersState.data.data.map((order) => [order._id, order]))
  const cytologyOrders = ordersState.data.data.filter((order) =>
    order.workflowPlan.stages.some((stage) => stage.module === 'cytology'),
  )

  useEffect(() => {
    const requestedOrderId = searchParams.get('order')
    if (!requestedOrderId) {
      return
    }
    setOrderId(requestedOrderId)
    const existing = casesState.data.find((entry) => entry.orderId === requestedOrderId)
    if (existing) {
      setEditing(existing)
    }
  }, [casesState.data, searchParams])

  const createCase = async () => {
    if (!orderId) {
      setFeedback({ kind: 'error', message: 'Choose an order before creating a cytology case.' })
      return
    }
    await actionLock.runLocked(`cytology-${orderId}`, async () => {
      try {
        await api.post('/cytology/cases', { orderId, specimenType, remarks })
        casesState.refresh()
        ordersState.refresh()
        setFeedback({ kind: 'success', message: 'Cytology case created successfully.' })
        setOrderId('')
        setSpecimenType('Cervical smear')
        setRemarks('')
      } catch (createError) {
        setFeedback({ kind: 'error', message: errorMessage(createError) })
      }
    })
  }

  const saveEdit = async () => {
    if (!editing) {
      return
    }
    try {
      await api.put(`/cytology/cases/${editing._id}`, {
        specimenType: editing.specimenType,
        status: editing.status,
        remarks: editing.remarks,
        routeType: editing.routeType,
        preparationType: editing.preparationType,
        qcStatus: editing.qcStatus,
        qcNotes: editing.qcNotes,
      })
      setFeedback({ kind: 'success', message: `${editing.caseNumber} updated.` })
      setEditing(null)
      casesState.refresh()
      ordersState.refresh()
    } catch (saveError) {
      setFeedback({ kind: 'error', message: errorMessage(saveError) })
    }
  }

  const saveScreening = async () => {
    if (!editing) return
    try {
      await api.post(`/cytology/cases/${editing._id}/screening`, {
        scannedCode: editing.caseNumber,
        adequacyStatus: editing.adequacyStatus && editing.adequacyStatus !== 'pending' ? editing.adequacyStatus : 'satisfactory',
        adequacyCriteriaMet: editing.adequacyCriteriaMet ?? [],
        adequacyExceptions: editing.adequacyExceptions ?? [],
        bethesdaCategory: editing.bethesdaCategory ?? '',
        screeningNotes: editing.screeningNotes ?? editing.remarks ?? 'Screening completed.',
      })
      setFeedback({ kind: 'success', message: `${editing.caseNumber} screening saved.` })
      setEditing(null)
      casesState.refresh()
      ordersState.refresh()
    } catch (saveError) {
      setFeedback({ kind: 'error', message: errorMessage(saveError) })
    }
  }

  const saveQualityGate = async () => {
    if (!editing) return
    try {
      await api.post(`/cytology/cases/${editing._id}/quality-gate`, {
        qcStatus: editing.qcStatus && editing.qcStatus !== 'pending' ? editing.qcStatus : 'pass',
        qcNotes: editing.qcNotes ?? 'QC gate completed.',
        adequacyScore: editing.adequacyStatus === 'unsatisfactory' ? 0 : 95,
        unsatisfactoryReason: editing.adequacyStatus === 'unsatisfactory' ? (editing.screeningNotes ?? 'Unsatisfactory adequacy') : '',
      })
      setFeedback({ kind: 'success', message: `${editing.caseNumber} QC gate saved.` })
      setEditing(null)
      casesState.refresh()
      ordersState.refresh()
    } catch (saveError) {
      setFeedback({ kind: 'error', message: errorMessage(saveError) })
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Cytology" description="Only cytology-routed orders appear here. Capture preparation details and QC so the case can move to review safely." />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <SectionCard title="Create cytology case">
        <Stack spacing={2}>
          <FormControl>
            <InputLabel>Order</InputLabel>
            <Select label="Order" value={orderId} onChange={(event) => setOrderId(String(event.target.value))}>
              {cytologyOrders.map((order) => (
                <MenuItem key={order._id} value={order._id}>{order.orderNumber}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Specimen type" value={specimenType} onChange={(event) => setSpecimenType(event.target.value)} />
          <TextField label="Remarks" multiline minRows={3} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
          <Button disabled={!orderId || !specimenType.trim() || actionLock.isPending(`cytology-${orderId}`)} variant="contained" onClick={createCase}>
            Create case
          </Button>
        </Stack>
      </SectionCard>
      <SectionCard title="Cases">
        {casesState.data.length ? (
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Case #</TableCell>
                  <TableCell>Order</TableCell>
                  <TableCell>Specimen type</TableCell>
                  <TableCell>Route</TableCell>
                  <TableCell>QC</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {casesState.data.map((entry) => (
                  <TableRow key={entry._id}>
                    <TableCell>{entry.caseNumber}</TableCell>
                    <TableCell>{orderMap.get(entry.orderId)?.orderNumber ?? '—'}</TableCell>
                    <TableCell>{entry.specimenType}</TableCell>
                    <TableCell>{entry.routeType ?? '—'} / {entry.preparationType ?? '—'}</TableCell>
                    <TableCell>{entry.qcStatus ?? 'pending'}</TableCell>
                    <TableCell>{entry.status}</TableCell>
                    <TableCell>
                      <Button onClick={() => setEditing(entry)}>Edit case</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          <EmptyState title="No cytology cases yet." body="Create one from an order above." />
        )}
      </SectionCard>

      <Dialog open={!!editing} onClose={() => setEditing(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit cytology case</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Specimen type"
              value={editing?.specimenType ?? ''}
              onChange={(event) => setEditing((prev) => (prev ? { ...prev, specimenType: event.target.value } : prev))}
            />
            <FormControl>
              <InputLabel>Status</InputLabel>
              <Select
                label="Status"
                value={editing?.status ?? 'open'}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, status: String(event.target.value) as CytologyCase['status'] } : prev))}
              >
                <MenuItem value="open">Open</MenuItem>
                <MenuItem value="screening">Screening</MenuItem>
                <MenuItem value="review">Review</MenuItem>
                <MenuItem value="escalated">Escalated</MenuItem>
                <MenuItem value="complete">Complete</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Adequacy</InputLabel>
              <Select
                label="Adequacy"
                value={editing?.adequacyStatus ?? 'pending'}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, adequacyStatus: String(event.target.value) as CytologyCase['adequacyStatus'] } : prev))}
              >
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="satisfactory">Satisfactory</MenuItem>
                <MenuItem value="limited">Limited but acceptable</MenuItem>
                <MenuItem value="unsatisfactory">Unsatisfactory</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Bethesda / cytology category"
              value={editing?.bethesdaCategory ?? ''}
              onChange={(event) => setEditing((prev) => (prev ? { ...prev, bethesdaCategory: event.target.value } : prev))}
            />
            <TextField
              label="Adequacy criteria met (comma-separated)"
              value={(editing?.adequacyCriteriaMet ?? []).join(', ')}
              onChange={(event) =>
                setEditing((prev) => (prev ? { ...prev, adequacyCriteriaMet: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } : prev))
              }
            />
            <TextField
              label="Adequacy exceptions (comma-separated)"
              value={(editing?.adequacyExceptions ?? []).join(', ')}
              onChange={(event) =>
                setEditing((prev) => (prev ? { ...prev, adequacyExceptions: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) } : prev))
              }
            />
            <TextField
              label="Cytotechnologist screening notes"
              multiline
              minRows={3}
              value={editing?.screeningNotes ?? ''}
              onChange={(event) => setEditing((prev) => (prev ? { ...prev, screeningNotes: event.target.value } : prev))}
            />
            <FormControl>
              <InputLabel>Route type</InputLabel>
              <Select
                label="Route type"
                value={editing?.routeType ?? 'non_gyn'}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, routeType: String(event.target.value) as CytologyCase['routeType'] } : prev))}
              >
                <MenuItem value="gyn">GYN</MenuItem>
                <MenuItem value="non_gyn">Non-GYN</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>Preparation type</InputLabel>
              <Select
                label="Preparation type"
                value={editing?.preparationType ?? 'smear'}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, preparationType: String(event.target.value) as CytologyCase['preparationType'] } : prev))}
              >
                <MenuItem value="smear">Smear</MenuItem>
                <MenuItem value="cell_block">Cell block</MenuItem>
                <MenuItem value="liquid_based">Liquid-based</MenuItem>
              </Select>
            </FormControl>
            <FormControl>
              <InputLabel>QC status</InputLabel>
              <Select
                label="QC status"
                value={editing?.qcStatus ?? 'pending'}
                onChange={(event) => setEditing((prev) => (prev ? { ...prev, qcStatus: String(event.target.value) as CytologyCase['qcStatus'] } : prev))}
              >
                <MenuItem value="pending">Pending</MenuItem>
                <MenuItem value="pass">Pass</MenuItem>
                <MenuItem value="fail">Fail</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="QC notes"
              multiline
              minRows={3}
              value={editing?.qcNotes ?? ''}
              onChange={(event) => setEditing((prev) => (prev ? { ...prev, qcNotes: event.target.value } : prev))}
            />
            <TextField
              label="Remarks"
              multiline
              minRows={4}
              value={editing?.remarks ?? ''}
              onChange={(event) => setEditing((prev) => (prev ? { ...prev, remarks: event.target.value } : prev))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button onClick={saveScreening}>Save screening</Button>
          <Button onClick={saveQualityGate}>Save QC gate</Button>
          <Button variant="contained" onClick={saveEdit}>Save</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export function DigitalPathologyPage() {
  const [slideId, setSlideId] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [images, setImages] = useState<string[]>([])
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const digitalSlidesState = useLoadable<DigitalSlideRecord[]>([], [], async () => {
    const response = await api.get('/digital-slides')
    return response.data
  })
  const aiModelsState = useLoadable<AiModelRegistryRecord[]>([], [], async () => {
    const response = await api.get('/ai/models')
    return response.data
  })
  const selectedDigitalSlide = digitalSlidesState.data.find((entry) => entry.slideId === slideId || entry._id === slideId)

  const simulate = async () => {
    if (!slideId.trim()) {
      setFeedback({ kind: 'error', message: 'Enter a slide ID before starting the simulation.' })
      return
    }
    setRunning(true)
    setProgress(0)
    setFeedback(null)
    const started = Date.now()
    const interval = window.setInterval(() => {
      const next = Math.min(100, Math.round(((Date.now() - started) / 5000) * 100))
      setProgress(next)
    }, 150)
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 5200))
      const response = await api.post('/slide-images/simulate', { slideId })
      setImages(response.data.imageUrls)
      setFeedback({ kind: 'success', message: `Digital image set generated for ${slideId}.` })
      digitalSlidesState.refresh()
    } catch (simulationError) {
      setFeedback({ kind: 'error', message: errorMessage(simulationError) })
    } finally {
      window.clearInterval(interval)
      setRunning(false)
      setProgress(100)
    }
  }

  return (
    <Stack spacing={3}>
      <PageHeader title="Digital pathology" description="Enter the stained sample (Slide ID), then run the simulation. When it finishes, images are saved to the server for that sample." />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <SectionCard>
        <Stack spacing={2}>
          <TextField label="Stained sample ID / Slide ID" value={slideId} onChange={(event) => setSlideId(event.target.value)} />
          <FormControl>
            <InputLabel>Existing digital slide</InputLabel>
            <Select label="Existing digital slide" value={selectedDigitalSlide?._id ?? ''} onChange={(event) => {
              const selected = digitalSlidesState.data.find((entry) => entry._id === String(event.target.value))
              setSlideId(selected?.slideId ?? '')
            }}>
              <MenuItem value="">Select slide record</MenuItem>
              {digitalSlidesState.data.map((slide) => (
                <MenuItem key={slide._id} value={slide._id}>{slide.slideId} · {slide.signOutStatus}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {running ? <LinearProgress variant="determinate" value={progress} /> : null}
          <Button disabled={!slideId || running} variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={simulate}>
            Simulate processing (about 5 sec demo)
          </Button>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
            <Button
              disabled={!selectedDigitalSlide}
              onClick={async () => {
                if (!selectedDigitalSlide) return
                try {
                  await api.post(`/digital-slides/${selectedDigitalSlide._id}/claim`, { reason: 'Pathologist review ownership' })
                  digitalSlidesState.refresh()
                  setFeedback({ kind: 'success', message: `${selectedDigitalSlide.slideId} claimed for digital review.` })
                } catch (lockError) {
                  setFeedback({ kind: 'error', message: errorMessage(lockError) })
                }
              }}
            >
              Claim ownership lock
            </Button>
            <Button
              disabled={!selectedDigitalSlide}
              onClick={async () => {
                if (!selectedDigitalSlide) return
                try {
                  await api.post(`/digital-slides/${selectedDigitalSlide._id}/signout-lock`, { reason: 'Ready for report sign-out' })
                  digitalSlidesState.refresh()
                  setFeedback({ kind: 'success', message: `${selectedDigitalSlide.slideId} sign-out locked.` })
                } catch (lockError) {
                  setFeedback({ kind: 'error', message: errorMessage(lockError) })
                }
              }}
            >
              Lock sign-out
            </Button>
            <Button
              disabled={!selectedDigitalSlide || !aiModelsState.data.length}
              onClick={async () => {
                if (!selectedDigitalSlide) return
                try {
                  await api.post(`/ai/slides/${selectedDigitalSlide.slideId}/run`, {
                    modelId: aiModelsState.data[0]?._id,
                    analysisType: 'qc',
                    clinicalUseRequested: false,
                  })
                  setFeedback({ kind: 'success', message: 'AI QC record created as non-diagnostic/free-mode output.' })
                } catch (aiError) {
                  setFeedback({ kind: 'error', message: errorMessage(aiError) })
                }
              }}
            >
              Run AI QC
            </Button>
          </Stack>
        </Stack>
      </SectionCard>
      {images.length ? (
        <SectionCard title="Generated images">
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' } }}>
            {images.map((image, index) => (
              <Paper key={image} sx={{ p: 2 }}>
                <Box sx={{ height: 180, borderRadius: 3, background: `linear-gradient(135deg, rgba(21,101,192,${0.16 + index * 0.08}), rgba(139,94,52,0.24))` }} />
                <Typography sx={{ mt: 2 }}>{image.replace('generated:', '').replaceAll(':', ' · ')}</Typography>
              </Paper>
            ))}
          </Box>
        </SectionCard>
      ) : (
        <EmptyState title="No generated images yet." body="Run the simulation after entering a stained slide ID to create the digital image set." />
      )}
    </Stack>
  )
}

export function WorkflowSelectPage() {
  const templatesState = useLoadable<WorkflowTemplate[]>([], [], async () => {
    const response = await api.get<WorkflowTemplate[]>('/workflows/templates')
    return response.data
  })
  const [executingId, setExecutingId] = useState('')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)

  return (
    <Stack spacing={3}>
      <PageHeader title="Workflow select" description="Run reference workflow templates and record their execution in history." />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, 1fr)' } }}>
        {templatesState.data.map((template) => (
          <Paper key={template.id} sx={{ p: 3 }}>
            <Typography variant="h5">{template.name}</Typography>
            <Typography color="text.secondary" sx={{ mt: 1 }}>
              Steps: {template.steps.join(' → ')}
            </Typography>
            <Button
              disabled={executingId === template.id}
              variant="contained"
              sx={{ mt: 2 }}
              onClick={async () => {
                setExecutingId(template.id)
                setFeedback(null)
                try {
                  await api.post(`/workflow/execute/${template.id}`)
                  await api.post(`/workflow/complete/${template.id}`, { notes: `${template.name} executed from the web app.` })
                  setFeedback({ kind: 'success', message: `${template.name} executed and logged to workflow history.` })
                } catch (executeError) {
                  setFeedback({ kind: 'error', message: errorMessage(executeError) })
                } finally {
                  setExecutingId('')
                }
              }}
            >
              {executingId === template.id ? 'Executing…' : 'Execute'}
            </Button>
          </Paper>
        ))}
      </Box>
    </Stack>
  )
}

export function WorkflowHistoryPage() {
  const historyState = useLoadable<{ data: WorkflowHistoryEntry[] }>({ data: [] }, [], async () => {
    const response = await api.get('/workflows/history')
    return response.data
  })
  return (
    <Stack spacing={3}>
      <PageHeader title="Workflow history" />
      <SectionCard>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Workflow</TableCell>
                <TableCell>Order #</TableCell>
                <TableCell>Completed at</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {historyState.data.data.map((entry) => (
                <TableRow key={entry._id}>
                  <TableCell>{entry.workflowTemplateName}</TableCell>
                  <TableCell>{entry.patientName ?? '—'}</TableCell>
                  <TableCell>{formatDateTime(entry.completedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>
    </Stack>
  )
}

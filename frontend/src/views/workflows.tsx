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
  CytologyCase,
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
  const receiveOrders = ordersState.data.data.filter((order) => order.status === 'draft')
  const paymentOrders = ordersState.data.data.filter((order) => order.status === 'received' || order.status === 'draft')
  const courierOrders = ordersState.data.data
  const assignOrders = ordersState.data.data.filter(
    (order) =>
      order.status === 'received' &&
      ((!order.assignedTechnician && order.workflowPlan.requiresTechnician) || order.workflowPlan.reviewReady),
  )
  const resultOrders = ordersState.data.data.filter((order) => ['completed', 'released'].includes(order.status))

  const [paymentDialog, setPaymentDialog] = useState<{
    orderId: string
    amount: number
    method: 'cash' | 'card' | 'mobile_money' | 'bank_transfer'
    status: 'pending' | 'completed' | 'failed'
  } | null>(null)
  const [assignment, setAssignment] = useState<Record<string, string>>({})
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

  return (
    <Stack spacing={3}>
      <PageHeader
        title="Receptionist workflow"
        description="Receive orders (web or walk-in) → Confirm payment → Add courier if needed → Route each case to the correct lab workflow or straight to pathologist review."
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
                  <TableCell>
                    {tab === 0 ? (
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                        <Button
                          disabled={actionLock.isPending(`receive-${order._id}`)}
                          onClick={() => runOrderAction(`receive-${order._id}`, () => api.post(`/orders/${order._id}/mark-received`), `${order.orderNumber} marked as received.`)}
                        >
                          Mark received
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
                          })}
                        >
                          Process payment
                        </Button>
                        <Button component={RouterLink} to={`/orders/${order._id}`}>
                          View order
                        </Button>
                      </Stack>
                    ) : null}
                    {tab === 2 ? (
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                        <Button
                          disabled={actionLock.isPending(`courier-${order._id}`)}
                          onClick={() => runOrderAction(`courier-${order._id}`, () => api.post(`/orders/${order._id}/check-in-courier`), `${order.orderNumber} added to the courier queue.`)}
                        >
                          Add courier
                        </Button>
                        <Button component={RouterLink} to="/courier">
                          Open courier board
                        </Button>
                      </Stack>
                    ) : null}
                    {tab === 3 ? (
                      order.workflowPlan.requiresTechnician ? (
                        <Stack direction="row" spacing={1}>
                          <FormControl size="small" sx={{ minWidth: 180 }}>
                            <Select
                              value={assignment[order._id] ?? ''}
                              displayEmpty
                              onChange={(event) => setAssignment((prev) => ({ ...prev, [order._id]: String(event.target.value) }))}
                            >
                              <MenuItem value="">Select technician</MenuItem>
                              {technicians.map((tech) => (
                                <MenuItem key={tech._id} value={tech._id}>{tech.name}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <Button
                            disabled={!assignment[order._id] || actionLock.isPending(`assign-${order._id}`)}
                            onClick={async () => {
                              await runOrderAction(
                                `assign-${order._id}`,
                                () => api.post(`/orders/${order._id}/assign-technician`, { technicianId: assignment[order._id] }),
                                `${order.orderNumber} assigned to technician.`,
                              )
                              setAssignment((prev) => ({ ...prev, [order._id]: '' }))
                            }}
                          >
                            Assign
                          </Button>
                        </Stack>
                      ) : (
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
                          <Button
                            disabled={order.workflowPlan.nextStageId !== 'pathologist_review' || actionLock.isPending(`direct-review-${order._id}`)}
                            onClick={() =>
                              runOrderAction(
                                `direct-review-${order._id}`,
                                () => api.post(`/orders/${order._id}/ready-for-review`, {}),
                                `${order.orderNumber} sent directly to pathologist review.`,
                              )
                            }
                          >
                            Send to pathologist
                          </Button>
                          <Button component={RouterLink} to={`/orders/${order._id}`}>
                            View order
                          </Button>
                        </Stack>
                      )
                    ) : null}
                    {tab === 4 ? (
                      <Button component={RouterLink} to={`/orders/${order._id}`}>
                        View result
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionCard>

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
                onChange={(event) => setPaymentDialog((prev) => (prev ? { ...prev, method: String(event.target.value) as 'cash' | 'card' | 'mobile_money' | 'bank_transfer' } : null))}
              >
                <MenuItem value="cash">Cash</MenuItem>
                <MenuItem value="card">Card</MenuItem>
                <MenuItem value="mobile_money">Mobile money</MenuItem>
                <MenuItem value="bank_transfer">Bank transfer</MenuItem>
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
                            () => api.post(`/orders/${order._id}/start-processing`),
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
                      {order.workflowPlan.nextStageId === 'cytology_qc' ? (
                        <Button component={RouterLink} to={`/cytology/cases?order=${encodeURIComponent(order._id)}`}>
                          Open cytology QC
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
                () => api.post(`/orders/${reviewDialog.orderId}/ready-for-review`, { pathologistId: reviewDialog.pathologistId || null }),
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
    qcNotes: '',
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
                <MenuItem value="review">Review</MenuItem>
                <MenuItem value="complete">Complete</MenuItem>
              </Select>
            </FormControl>
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
          {running ? <LinearProgress variant="determinate" value={progress} /> : null}
          <Button disabled={!slideId || running} variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={simulate}>
            Simulate processing (about 5 sec demo)
          </Button>
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

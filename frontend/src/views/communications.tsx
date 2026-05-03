import AttachFileRoundedIcon from '@mui/icons-material/AttachFileRounded'
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded'
import DoneAllRoundedIcon from '@mui/icons-material/DoneAllRounded'
import ReportProblemRoundedIcon from '@mui/icons-material/ReportProblemRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControlLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'

import { api, apiBaseUrl, getStoredToken } from '../api'
import { EmptyState, LoadingPanel, PageHeader, SectionCard } from '../components'
import type {
  CommunicationExceptionType,
  CommunicationPriority,
  CommunicationThreadType,
  InternalChatMessage,
  InternalChatThread,
  SafeUser,
  UserRole,
} from '../types'
import { formatDateTime } from '../utils'
import { errorMessage, PageError, useLoadable } from './shared'
import { useAuth } from '../auth'

type CommunicationUser = Pick<SafeUser, '_id' | 'name' | 'role' | 'siteId'>

const departmentOptions = [
  'receptionist',
  'receiving',
  'courier',
  'technician',
  'laboratory',
  'histology',
  'cytology',
  'ihc',
  'pathologist',
  'finance',
  'billing',
  'quality',
  'admin',
  'doctor',
]

const roleOptions: UserRole[] = [
  'super_admin',
  'admin',
  'receptionist',
  'technician',
  'pathologist',
  'doctor',
  'finance',
  'courier',
]

const threadTypeOptions: Array<{ value: CommunicationThreadType; label: string }> = [
  { value: 'department', label: 'Department thread' },
  { value: 'direct', label: 'Direct message' },
  { value: 'broadcast', label: 'Broadcast notice' },
  { value: 'exception', label: 'Exception alert' },
]

const priorityOptions: CommunicationPriority[] = ['routine', 'urgent', 'critical']

const exceptionTypeOptions: CommunicationExceptionType[] = [
  'rejected_sample',
  'missing_payment',
  'failed_qc',
  'delayed_tat',
  'missing_specimen',
  'unread_clinician_response',
]

const emptyLinks = {
  linkedOrderId: '',
  linkedSpecimenId: '',
  linkedOrderItemId: '',
  linkedInvoiceId: '',
  linkedReportId: '',
}

const linkLabels: Array<{ key: keyof typeof emptyLinks; label: string }> = [
  { key: 'linkedOrderId', label: 'Order' },
  { key: 'linkedSpecimenId', label: 'Specimen' },
  { key: 'linkedOrderItemId', label: 'Order item' },
  { key: 'linkedInvoiceId', label: 'Invoice' },
  { key: 'linkedReportId', label: 'Report' },
]

function labelize(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function trimPayloadValues(values: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value.length > 0),
  )
}

function priorityColor(priority?: CommunicationPriority) {
  if (priority === 'critical') return 'error'
  if (priority === 'urgent') return 'warning'
  return 'default'
}

export function CommunicationsPage() {
  const { user } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const threadsState = useLoadable<InternalChatThread[]>([], [], async () => {
    const response = await api.get<InternalChatThread[]>('/communications/threads')
    return response.data
  })
  const usersState = useLoadable<CommunicationUser[]>([], [], async () => {
    const response = await api.get<CommunicationUser[]>('/communications/users')
    return response.data
  })
  const [activeThreadId, setActiveThreadId] = useState('')
  const [messages, setMessages] = useState<InternalChatMessage[]>([])
  const [messageDraft, setMessageDraft] = useState('')
  const [messageMandatoryRead, setMessageMandatoryRead] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [newThreadTitle, setNewThreadTitle] = useState('')
  const [newThreadType, setNewThreadType] = useState<CommunicationThreadType>('department')
  const [newThreadDepartments, setNewThreadDepartments] = useState<string[]>(['receptionist', 'histology'])
  const [newThreadParticipantIds, setNewThreadParticipantIds] = useState<string[]>([])
  const [newThreadAudienceRoles, setNewThreadAudienceRoles] = useState<UserRole[]>([
    'admin',
    'receptionist',
    'technician',
    'pathologist',
    'finance',
    'courier',
    'doctor',
  ])
  const [newThreadPriority, setNewThreadPriority] = useState<CommunicationPriority>('routine')
  const [newThreadRegulated, setNewThreadRegulated] = useState(false)
  const [newExceptionType, setNewExceptionType] = useState<CommunicationExceptionType>('missing_specimen')
  const [newThreadBody, setNewThreadBody] = useState('')
  const [newThreadLinks, setNewThreadLinks] = useState(emptyLinks)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [streamState, setStreamState] = useState<'connecting' | 'live' | 'polling'>('connecting')

  const activeThread = useMemo(
    () => threadsState.data.find((thread) => thread._id === activeThreadId) ?? threadsState.data[0] ?? null,
    [activeThreadId, threadsState.data],
  )

  const availableUsers = useMemo(
    () => usersState.data.filter((entry) => entry._id !== user?._id),
    [user?._id, usersState.data],
  )

  const selectedParticipants = useMemo(
    () => availableUsers.filter((entry) => newThreadParticipantIds.includes(entry._id)),
    [availableUsers, newThreadParticipantIds],
  )

  useEffect(() => {
    if (!activeThreadId && activeThread?._id) {
      setActiveThreadId(activeThread._id)
    }
  }, [activeThread, activeThreadId])

  useEffect(() => {
    if (!activeThread?._id) {
      setMessages([])
      return
    }
    let cancelled = false
    const loadMessages = async () => {
      try {
        const response = await api.get<InternalChatMessage[]>(`/communications/threads/${activeThread._id}/messages`)
        if (!cancelled) {
          setMessages(response.data)
          const readResponse = await api.post<InternalChatMessage[]>(`/communications/threads/${activeThread._id}/read`)
          setMessages(readResponse.data)
          threadsState.refresh()
        }
      } catch (loadError) {
        if (!cancelled) {
          setFeedback({ kind: 'error', message: errorMessage(loadError) })
        }
      }
    }
    void loadMessages()
    return () => {
      cancelled = true
    }
  }, [activeThread?._id])

  useEffect(() => {
    const token = getStoredToken()
    if (!token) {
      setStreamState('polling')
      return
    }
    const source = new EventSource(`${apiBaseUrl}/communications/stream?access_token=${encodeURIComponent(token)}`)
    source.addEventListener('open', () => setStreamState('live'))
    source.addEventListener('messages', (event) => {
      setStreamState('live')
      const payload = JSON.parse((event as MessageEvent).data) as { messages: InternalChatMessage[] }
      if (activeThread?._id) {
        setMessages(payload.messages.filter((message) => message.threadId === activeThread._id))
      }
      threadsState.refresh()
    })
    source.addEventListener('error', () => {
      setStreamState('polling')
      source.close()
    })
    return () => source.close()
  }, [activeThread?._id])

  useEffect(() => {
    if (streamState !== 'polling' || !activeThread?._id) {
      return
    }
    const interval = window.setInterval(async () => {
      try {
        const response = await api.get<InternalChatMessage[]>(`/communications/threads/${activeThread._id}/messages`)
        setMessages(response.data)
        threadsState.refresh()
      } catch {
        // Polling is a fallback; visible errors are handled by direct actions.
      }
    }, 5000)
    return () => window.clearInterval(interval)
  }, [activeThread?._id, streamState])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, activeThread?._id])

  const createThread = async () => {
    if (!newThreadTitle.trim()) {
      setFeedback({ kind: 'error', message: 'Give the communication a title first.' })
      return
    }
    if (newThreadType === 'direct' && newThreadParticipantIds.length === 0) {
      setFeedback({ kind: 'error', message: 'Choose at least one direct recipient.' })
      return
    }
    if ((newThreadType === 'broadcast' || newThreadType === 'exception') && !newThreadBody.trim()) {
      setFeedback({ kind: 'error', message: 'Broadcasts and exception alerts need an initial message.' })
      return
    }

    const departments = newThreadDepartments.length ? newThreadDepartments : [user?.role ?? 'admin']
    const links = trimPayloadValues(newThreadLinks)

    try {
      let createdThread: InternalChatThread
      if (newThreadType === 'broadcast') {
        const response = await api.post<{ thread: InternalChatThread }>('/communications/broadcasts', {
          title: newThreadTitle.trim(),
          body: newThreadBody.trim(),
          departments,
          audienceRoles: newThreadAudienceRoles,
          priority: newThreadPriority,
          regulated: newThreadRegulated,
          mandatoryRead: newThreadRegulated,
          ...links,
        })
        createdThread = response.data.thread
      } else if (newThreadType === 'exception') {
        const response = await api.post<{ thread: InternalChatThread }>('/communications/exceptions', {
          title: newThreadTitle.trim(),
          body: newThreadBody.trim(),
          exceptionType: newExceptionType,
          departments,
          participantUserIds: newThreadParticipantIds,
          priority: newThreadPriority,
          ...links,
        })
        createdThread = response.data.thread
      } else {
        const response = await api.post<InternalChatThread>('/communications/threads', {
          title: newThreadTitle.trim(),
          threadType: newThreadType,
          department: departments[0],
          departments,
          participantUserIds: newThreadParticipantIds,
          priority: newThreadPriority,
          regulated: newThreadRegulated,
          ...links,
        })
        createdThread = response.data
        if (newThreadBody.trim()) {
          await api.post<InternalChatMessage>(`/communications/threads/${createdThread._id}/messages`, {
            body: newThreadBody.trim(),
            regulated: newThreadRegulated,
            mandatoryRead: newThreadRegulated,
          })
        }
      }

      setNewThreadTitle('')
      setNewThreadBody('')
      setNewThreadLinks(emptyLinks)
      setNewThreadParticipantIds([])
      setActiveThreadId(createdThread._id)
      threadsState.refresh()
      setFeedback({ kind: 'success', message: 'Communication created.' })
    } catch (createError) {
      setFeedback({ kind: 'error', message: errorMessage(createError) })
    }
  }

  const sendMessage = async () => {
    if (!activeThread?._id || !messageDraft.trim()) {
      return
    }
    const body = messageDraft.trim()
    const file = selectedFile
    setMessageDraft('')
    try {
      const response = await api.post<InternalChatMessage>(`/communications/threads/${activeThread._id}/messages`, {
        body,
        regulated: Boolean(activeThread.regulated),
        mandatoryRead: Boolean(messageMandatoryRead || activeThread.regulated),
      })
      setMessages((current) => [...current, response.data])
      setMessageMandatoryRead(false)
      threadsState.refresh()

      if (file) {
        try {
          const form = new FormData()
          form.append('messageId', response.data._id)
          form.append('file', file)
          const upload = await api.post<{ message: InternalChatMessage }>(
            `/communications/threads/${activeThread._id}/attachments`,
            form,
          )
          setMessages((current) =>
            current.map((entry) => (entry._id === response.data._id ? upload.data.message : entry)),
          )
          setSelectedFile(null)
        } catch (uploadError) {
          setFeedback({ kind: 'error', message: errorMessage(uploadError) })
        }
      }
    } catch (sendError) {
      setMessageDraft(body)
      setFeedback({ kind: 'error', message: errorMessage(sendError) })
    }
  }

  if (threadsState.loading) return <LoadingPanel label="Loading communications..." />
  if (threadsState.error) return <PageError message={threadsState.error} />

  const activeThreadType = activeThread?.threadType ?? 'department'

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Internal communications"
        title="Department communications"
        description="Order-linked handoffs, direct notes, broadcast notices, and regulated exception alerts."
        action={
          <Stack direction="row" spacing={1}>
            <Chip
              label={streamState === 'live' ? 'Live' : streamState === 'polling' ? 'Polling' : 'Connecting'}
              color={streamState === 'live' ? 'success' : 'warning'}
            />
            {usersState.error ? <Chip label="Limited recipients" color="warning" /> : null}
          </Stack>
        }
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '420px 1fr' } }}>
        <Stack spacing={2}>
          <SectionCard title="New communication">
            <Stack spacing={1.5}>
              <TextField
                label="Title"
                value={newThreadTitle}
                onChange={(event) => setNewThreadTitle(event.target.value)}
                fullWidth
              />
              <TextField
                select
                label="Type"
                value={newThreadType}
                onChange={(event) => setNewThreadType(event.target.value as CommunicationThreadType)}
                fullWidth
              >
                {threadTypeOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              <Autocomplete
                multiple
                freeSolo
                options={departmentOptions}
                value={newThreadDepartments}
                onChange={(_, value) => setNewThreadDepartments(value)}
                renderInput={(params) => <TextField {...params} label="Departments" />}
              />
              {newThreadType === 'direct' || newThreadType === 'exception' ? (
                <Autocomplete
                  multiple
                  options={availableUsers}
                  value={selectedParticipants}
                  getOptionLabel={(option) => `${option.name} (${option.role})`}
                  onChange={(_, value) => setNewThreadParticipantIds(value.map((entry) => entry._id))}
                  renderInput={(params) => <TextField {...params} label="Recipients" />}
                />
              ) : null}
              {newThreadType === 'broadcast' ? (
                <Autocomplete
                  multiple
                  options={roleOptions}
                  value={newThreadAudienceRoles}
                  onChange={(_, value) => setNewThreadAudienceRoles(value)}
                  getOptionLabel={(option) => labelize(option)}
                  renderInput={(params) => <TextField {...params} label="Audience roles" />}
                />
              ) : null}
              {newThreadType === 'exception' ? (
                <TextField
                  select
                  label="Exception"
                  value={newExceptionType}
                  onChange={(event) => setNewExceptionType(event.target.value as CommunicationExceptionType)}
                  fullWidth
                >
                  {exceptionTypeOptions.map((option) => (
                    <MenuItem key={option} value={option}>
                      {labelize(option)}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              <TextField
                select
                label="Priority"
                value={newThreadPriority}
                onChange={(event) => setNewThreadPriority(event.target.value as CommunicationPriority)}
                fullWidth
              >
                {priorityOptions.map((option) => (
                  <MenuItem key={option} value={option}>
                    {labelize(option)}
                  </MenuItem>
                ))}
              </TextField>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
                {linkLabels.map((field) => (
                  <TextField
                    key={field.key}
                    label={field.label}
                    value={newThreadLinks[field.key]}
                    onChange={(event) =>
                      setNewThreadLinks((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    size="small"
                    fullWidth
                  />
                ))}
              </Box>
              <TextField
                label={newThreadType === 'broadcast' ? 'Notice' : newThreadType === 'exception' ? 'Alert' : 'Initial message'}
                value={newThreadBody}
                onChange={(event) => setNewThreadBody(event.target.value)}
                multiline
                minRows={2}
                fullWidth
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={newThreadRegulated}
                    onChange={(event) => setNewThreadRegulated(event.target.checked)}
                  />
                }
                label="Regulated read receipt"
              />
              <Button
                variant="contained"
                onClick={createThread}
                startIcon={
                  newThreadType === 'broadcast' ? (
                    <CampaignRoundedIcon />
                  ) : newThreadType === 'exception' ? (
                    <ReportProblemRoundedIcon />
                  ) : undefined
                }
              >
                Create
              </Button>
            </Stack>
          </SectionCard>
          <SectionCard title="Threads">
            {threadsState.data.length ? (
              <List sx={{ maxHeight: 560, overflow: 'auto' }}>
                {threadsState.data.map((thread) => {
                  const type = thread.threadType ?? 'department'
                  const departments = thread.departments?.length ? thread.departments : [thread.department]
                  return (
                    <ListItemButton
                      key={thread._id}
                      selected={thread._id === activeThread?._id}
                      onClick={() => setActiveThreadId(thread._id)}
                      sx={{ borderRadius: 1, mb: 1, alignItems: 'flex-start' }}
                    >
                      <ListItemText
                        primary={
                          <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                            <Typography fontWeight={700}>{thread.title}</Typography>
                            {thread.unreadCount ? <Chip size="small" color="primary" label={thread.unreadCount} /> : null}
                          </Stack>
                        }
                        secondary={
                          <Stack component="span" spacing={0.75} sx={{ mt: 0.75 }}>
                            <Stack component="span" direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                              <Chip size="small" label={labelize(type)} />
                              <Chip size="small" label={labelize(thread.priority ?? 'routine')} color={priorityColor(thread.priority)} />
                              {thread.regulated ? <Chip size="small" label="Regulated" color="info" /> : null}
                            </Stack>
                            <Typography component="span" variant="caption" color="text.secondary">
                              {departments.join(', ')} | {thread.lastMessageAt ? formatDateTime(thread.lastMessageAt) : 'No messages yet'}
                            </Typography>
                          </Stack>
                        }
                      />
                    </ListItemButton>
                  )
                })}
              </List>
            ) : (
              <EmptyState title="No communications yet" body="Create the first department thread to begin internal communication." />
            )}
          </SectionCard>
        </Stack>

        <SectionCard
          title={activeThread?.title ?? 'Communication'}
          description={activeThread ? `${labelize(activeThreadType)} | ${(activeThread.departments ?? [activeThread.department]).join(', ')}` : undefined}
        >
          {activeThread ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                <Chip label={labelize(activeThreadType)} />
                <Chip label={labelize(activeThread.priority ?? 'routine')} color={priorityColor(activeThread.priority)} />
                {activeThread.exceptionType ? <Chip label={labelize(activeThread.exceptionType)} color="warning" /> : null}
                {activeThread.regulated ? <Chip label="Regulated" color="info" /> : null}
                {linkLabels.map((field) => {
                  const value = activeThread[field.key]
                  return value ? <Chip key={field.key} label={`${field.label}: ${value}`} variant="outlined" /> : null
                })}
              </Stack>
              <Paper variant="outlined" sx={{ p: 2, height: { xs: 460, lg: 620 }, overflow: 'auto', bgcolor: '#f7f4ee' }}>
                <Stack spacing={1.5}>
                  {messages.length ? messages.map((message) => {
                    const mine = message.senderId === user?._id
                    return (
                      <Box key={message._id} sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        <Paper
                          sx={{
                            p: 1.5,
                            maxWidth: { xs: '94%', md: '72%' },
                            bgcolor: mine ? '#d8f3dc' : 'background.paper',
                            borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          }}
                        >
                          <Stack spacing={0.75}>
                            <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
                              <Typography variant="caption" color="text.secondary">
                                {message.senderName} | {formatDateTime(message.createdAt)}
                              </Typography>
                              {message.mandatoryRead ? <Chip size="small" icon={<DoneAllRoundedIcon />} label={`Read ${message.readBy.length}`} /> : null}
                              {message.messageType && message.messageType !== 'message' ? (
                                <Chip size="small" label={labelize(message.messageType)} color={message.messageType === 'exception' ? 'warning' : 'info'} />
                              ) : null}
                            </Stack>
                            <Typography sx={{ whiteSpace: 'pre-wrap' }}>{message.body}</Typography>
                            {message.attachments?.length ? (
                              <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                                {message.attachments.map((attachment) => {
                                  const token = getStoredToken()
                                  const url = `${apiBaseUrl}/communications/threads/${activeThread._id}/attachments/${attachment._id}/file?access_token=${encodeURIComponent(token ?? '')}`
                                  return (
                                    <Button
                                      key={attachment._id}
                                      size="small"
                                      variant="outlined"
                                      startIcon={<AttachFileRoundedIcon />}
                                      href={url}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {attachment.filename}
                                    </Button>
                                  )
                                })}
                              </Stack>
                            ) : null}
                          </Stack>
                        </Paper>
                      </Box>
                    )
                  }) : (
                    <EmptyState title="No messages yet" body="Send the first note to start the conversation." />
                  )}
                  <div ref={messagesEndRef} />
                </Stack>
              </Paper>
              <Divider />
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', lg: 'center' }}>
                <TextField
                  label="Message"
                  value={messageDraft}
                  onChange={(event) => setMessageDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                  multiline
                  minRows={2}
                  fullWidth
                />
                <Stack spacing={1} sx={{ minWidth: { lg: 220 } }}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={messageMandatoryRead || Boolean(activeThread.regulated)}
                        onChange={(event) => setMessageMandatoryRead(event.target.checked)}
                        disabled={Boolean(activeThread.regulated)}
                      />
                    }
                    label="Read receipt"
                  />
                  <Button variant="outlined" component="label" startIcon={<AttachFileRoundedIcon />}>
                    {selectedFile ? selectedFile.name : 'Attach'}
                    <input
                      hidden
                      type="file"
                      onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                    />
                  </Button>
                  <Button
                    variant="contained"
                    endIcon={<SendRoundedIcon />}
                    onClick={sendMessage}
                    disabled={!messageDraft.trim()}
                  >
                    Send
                  </Button>
                </Stack>
              </Stack>
            </Stack>
          ) : (
            <EmptyState title="Choose a communication" body="Create or select a thread to view history." />
          )}
        </SectionCard>
      </Box>
    </Stack>
  )
}

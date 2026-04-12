import SendRoundedIcon from '@mui/icons-material/SendRounded'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
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
import type { InternalChatMessage, InternalChatThread } from '../types'
import { formatDateTime } from '../utils'
import { errorMessage, PageError, useLoadable } from './shared'
import { useAuth } from '../auth'

const departmentOptions = [
  'receptionist',
  'courier',
  'technician',
  'histology',
  'cytology',
  'ihc',
  'pathologist',
  'finance',
  'admin',
]

export function CommunicationsPage() {
  const { user } = useAuth()
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const threadsState = useLoadable<InternalChatThread[]>([], [], async () => {
    const response = await api.get<InternalChatThread[]>('/communications/threads')
    return response.data
  })
  const [activeThreadId, setActiveThreadId] = useState('')
  const [messages, setMessages] = useState<InternalChatMessage[]>([])
  const [messageDraft, setMessageDraft] = useState('')
  const [newThreadTitle, setNewThreadTitle] = useState('')
  const [newThreadDepartment, setNewThreadDepartment] = useState('histology')
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [streamState, setStreamState] = useState<'connecting' | 'live' | 'polling'>('connecting')

  const activeThread = useMemo(
    () => threadsState.data.find((thread) => thread._id === activeThreadId) ?? threadsState.data[0] ?? null,
    [activeThreadId, threadsState.data],
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
          await api.post(`/communications/threads/${activeThread._id}/read`)
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
      setFeedback({ kind: 'error', message: 'Give the chat thread a title first.' })
      return
    }
    try {
      const response = await api.post<InternalChatThread>('/communications/threads', {
        title: newThreadTitle,
        department: newThreadDepartment,
        participantUserIds: [],
      })
      setNewThreadTitle('')
      setActiveThreadId(response.data._id)
      threadsState.refresh()
      setFeedback({ kind: 'success', message: 'Chat thread created.' })
    } catch (createError) {
      setFeedback({ kind: 'error', message: errorMessage(createError) })
    }
  }

  const sendMessage = async () => {
    if (!activeThread?._id || !messageDraft.trim()) {
      return
    }
    const body = messageDraft.trim()
    setMessageDraft('')
    try {
      const response = await api.post<InternalChatMessage>(`/communications/threads/${activeThread._id}/messages`, { body })
      setMessages((current) => [...current, response.data])
      threadsState.refresh()
    } catch (sendError) {
      setMessageDraft(body)
      setFeedback({ kind: 'error', message: errorMessage(sendError) })
    }
  }

  if (threadsState.loading) return <LoadingPanel label="Loading communications…" />
  if (threadsState.error) return <PageError message={threadsState.error} />

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Internal communications"
        title="Department chat"
        description="Realtime department messages with timestamped history, read tracking, and an automatic polling fallback if the live stream is interrupted."
        action={<Chip label={streamState === 'live' ? 'Live' : streamState === 'polling' ? 'Polling fallback' : 'Connecting'} color={streamState === 'live' ? 'success' : 'warning'} />}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '360px 1fr' } }}>
        <Stack spacing={2}>
          <SectionCard title="New chat">
            <Stack spacing={1.5}>
              <TextField
                label="Thread title"
                value={newThreadTitle}
                onChange={(event) => setNewThreadTitle(event.target.value)}
                fullWidth
              />
              <TextField
                select
                label="Department"
                value={newThreadDepartment}
                onChange={(event) => setNewThreadDepartment(event.target.value)}
                fullWidth
              >
                {departmentOptions.map((department) => (
                  <MenuItem key={department} value={department}>
                    {department}
                  </MenuItem>
                ))}
              </TextField>
              <Button variant="contained" onClick={createThread}>Create chat</Button>
            </Stack>
          </SectionCard>
          <SectionCard title="Threads">
            {threadsState.data.length ? (
              <List sx={{ maxHeight: 520, overflow: 'auto' }}>
                {threadsState.data.map((thread) => (
                  <ListItemButton
                    key={thread._id}
                    selected={thread._id === activeThread?._id}
                    onClick={() => setActiveThreadId(thread._id)}
                    sx={{ borderRadius: 2, mb: 1 }}
                  >
                    <ListItemText
                      primary={(
                        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                          <Typography fontWeight={700}>{thread.title}</Typography>
                          {thread.unreadCount ? <Chip size="small" color="primary" label={thread.unreadCount} /> : null}
                        </Stack>
                      )}
                      secondary={`${thread.department} · ${thread.lastMessageAt ? formatDateTime(thread.lastMessageAt) : 'No messages yet'}`}
                    />
                  </ListItemButton>
                ))}
              </List>
            ) : (
              <EmptyState title="No chat threads yet" body="Create the first department thread to begin internal communication." />
            )}
          </SectionCard>
        </Stack>

        <SectionCard title={activeThread?.title ?? 'Chat'} description={activeThread ? `Department: ${activeThread.department}` : undefined}>
          {activeThread ? (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 2, height: { xs: 460, lg: 620 }, overflow: 'auto', bgcolor: '#f7f4ee' }}>
                <Stack spacing={1.5}>
                  {messages.length ? messages.map((message) => {
                    const mine = message.senderId === user?._id
                    return (
                      <Box key={message._id} sx={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                        <Paper
                          sx={{
                            p: 1.5,
                            maxWidth: { xs: '90%', md: '70%' },
                            bgcolor: mine ? '#d8f3dc' : 'background.paper',
                            borderRadius: mine ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                          }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            {message.senderName} · {formatDateTime(message.createdAt)}
                          </Typography>
                          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{message.body}</Typography>
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
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
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
                <Button
                  variant="contained"
                  endIcon={<SendRoundedIcon />}
                  onClick={sendMessage}
                  disabled={!messageDraft.trim()}
                  sx={{ alignSelf: { xs: 'stretch', md: 'center' } }}
                >
                  Send
                </Button>
              </Stack>
            </Stack>
          ) : (
            <EmptyState title="Choose a chat thread" body="Create or select a department chat to view history." />
          )}
        </SectionCard>
      </Box>
    </Stack>
  )
}

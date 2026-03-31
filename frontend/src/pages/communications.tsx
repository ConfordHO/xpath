import MarkEmailReadRoundedIcon from '@mui/icons-material/MarkEmailReadRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'

import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import { useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import { useAuth } from '../auth'
import { EmptyState, PageHeader, SectionCard } from '../components'

import {
  errorMessage,
  PageError,
  useActionLock,
  useLoadable,
  useRealtimeStream,
} from './shared'

import type {
  InternalMessage,
  InternalMessageContactDirectory,
  InternalMessageConversation,
  SafeUser,
  UserRole,
} from '../types'

import { formatDateTime } from '../utils'

const staffRoleLabels: Record<UserRole, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  receptionist: 'Reception',
  technician: 'Technical',
  pathologist: 'Pathology',
  doctor: 'Doctor',
  finance: 'Finance',
  courier: 'Courier',
}

type ConversationTarget = InternalMessageConversation & {
  kind: 'role' | 'user' | 'broadcast'
  contact?: SafeUser | null
}

function buildRoleConversationKey(role: UserRole) {
  return `role:${role}`
}

function buildUserConversationKey(userId: string) {
  return `user:${userId}`
}

const broadcastConversationKey = 'broadcast'

function matchesConversation(
  message: InternalMessage,
  conversation: ConversationTarget,
  currentUser: NonNullable<ReturnType<typeof useAuth>['user']>,
) {
  if (conversation.kind === 'broadcast') {
    return message.recipientType === 'broadcast'
  }

  if (conversation.kind === 'user') {
    return (
      message.recipientType === 'user'
      && (
        (message.senderUserId === currentUser._id && message.recipientUserId === conversation.recipientUserId)
        || (message.senderUserId === conversation.recipientUserId && message.recipientUserId === currentUser._id)
      )
    )
  }

  return (
    message.recipientType === 'role'
    && (
      message.recipientRole === conversation.recipientRole
      || message.senderRole === conversation.recipientRole
    )
  )
}

function buildConversations(
  currentUser: NonNullable<ReturnType<typeof useAuth>['user']>,
  contacts: InternalMessageContactDirectory,
  messages: InternalMessage[],
) {
  const conversations: ConversationTarget[] = []

  for (const roleEntry of contacts.roles) {
    const threadMessages = messages.filter((message) =>
      message.recipientType === 'role'
      && (message.recipientRole === roleEntry.role || message.senderRole === roleEntry.role),
    )
    const latest = threadMessages.at(-1)
    conversations.push({
      key: buildRoleConversationKey(roleEntry.role),
      label: staffRoleLabels[roleEntry.role],
      kind: 'role',
      recipientType: 'role',
      recipientRole: roleEntry.role,
      unreadCount: threadMessages.filter(
        (message) =>
          message.senderUserId !== currentUser._id
          && !message.readByUserIds.includes(currentUser._id),
      ).length,
      lastMessageAt: latest?.createdAt ?? '',
      lastMessagePreview: latest?.message ?? `Open the ${staffRoleLabels[roleEntry.role]} chat.`,
    })
  }

  for (const contact of contacts.users) {
    const threadMessages = messages.filter((message) =>
      message.recipientType === 'user'
      && (
        (message.senderUserId === currentUser._id && message.recipientUserId === contact._id)
        || (message.senderUserId === contact._id && message.recipientUserId === currentUser._id)
      ),
    )
    const latest = threadMessages.at(-1)
    conversations.push({
      key: buildUserConversationKey(contact._id),
      label: contact.name,
      kind: 'user',
      recipientType: 'user',
      recipientUserId: contact._id,
      unreadCount: threadMessages.filter(
        (message) =>
          message.senderUserId !== currentUser._id
          && !message.readByUserIds.includes(currentUser._id),
      ).length,
      lastMessageAt: latest?.createdAt ?? '',
      lastMessagePreview: latest?.message ?? `Start a direct chat with ${contact.name}.`,
      contact,
    })
  }

  const broadcastMessages = messages.filter((message) => message.recipientType === 'broadcast')
  const latestBroadcast = broadcastMessages.at(-1)
  if (broadcastMessages.length || ['super_admin', 'admin'].includes(currentUser.role)) {
    conversations.push({
      key: broadcastConversationKey,
      label: 'Broadcast',
      kind: 'broadcast',
      recipientType: 'broadcast',
      unreadCount: broadcastMessages.filter(
        (message) =>
          message.senderUserId !== currentUser._id
          && !message.readByUserIds.includes(currentUser._id),
      ).length,
      lastMessageAt: latestBroadcast?.createdAt ?? '',
      lastMessagePreview: latestBroadcast?.message ?? 'Send a site-wide update.',
    })
  }

  return conversations.sort((left, right) => {
    if (!left.lastMessageAt && !right.lastMessageAt) {
      return left.label.localeCompare(right.label)
    }
    if (!left.lastMessageAt) {
      return 1
    }
    if (!right.lastMessageAt) {
      return -1
    }
    return right.lastMessageAt.localeCompare(left.lastMessageAt)
  })
}

export function CommunicationsPage() {
  const { user } = useAuth()
  const actionLock = useActionLock()
  const scrollAnchorRef = useRef<HTMLDivElement | null>(null)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [activeConversationKey, setActiveConversationKey] = useState('')
  const [draftMessage, setDraftMessage] = useState('')
  const [relatedOrderId, setRelatedOrderId] = useState('')

  const contactsState = useLoadable<InternalMessageContactDirectory>(
    { roles: [], users: [] },
    [user?._id],
    async () => {
      const response = await api.get<InternalMessageContactDirectory>('/internal-messages/contacts')
      return response.data
    },
  )

  const messagesState = useLoadable<InternalMessage[]>(
    [],
    [user?._id],
    async () => {
      const response = await api.get<InternalMessage[]>('/internal-messages', {
        params: { limit: 250 },
      })
      return response.data
    },
  )

  const connected = useRealtimeStream(
    '/internal-messages/stream',
    () => {
      messagesState.refresh()
    },
    Boolean(user),
  )

  const conversations = useMemo(
    () => (user ? buildConversations(user, contactsState.data, messagesState.data) : []),
    [contactsState.data, messagesState.data, user],
  )

  useEffect(() => {
    if (!conversations.length) {
      if (activeConversationKey) {
        setActiveConversationKey('')
      }
      return
    }

    const exists = conversations.some((conversation) => conversation.key === activeConversationKey)
    if (!exists) {
      setActiveConversationKey(conversations[0].key)
    }
  }, [activeConversationKey, conversations])

  const activeConversation = useMemo(
    () => conversations.find((conversation) => conversation.key === activeConversationKey) ?? null,
    [activeConversationKey, conversations],
  )

  const conversationMessages = useMemo(() => {
    if (!activeConversation || !user) {
      return []
    }
    return messagesState.data.filter((message) =>
      matchesConversation(message, activeConversation, user),
    )
  }, [activeConversation, messagesState.data, user])

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [conversationMessages])

  useEffect(() => {
    if (!user || !activeConversation || !conversationMessages.length) {
      return
    }

    const unreadIncoming = conversationMessages.filter(
      (message) =>
        message.senderUserId !== user._id
        && !message.readByUserIds.includes(user._id),
    )

    if (!unreadIncoming.length) {
      return
    }

    void Promise.all(
      unreadIncoming.map((message) =>
        api.post(`/internal-messages/${message._id}/read`).catch(() => null),
      ),
    ).then(() => {
      messagesState.refresh()
    })
  }, [activeConversation, conversationMessages, messagesState, user])

  const unreadCount = useMemo(
    () =>
      messagesState.data.filter(
        (message) =>
          message.senderUserId !== user?._id
          && !message.readByUserIds.includes(user?._id ?? ''),
      ).length,
    [messagesState.data, user?._id],
  )

  if (contactsState.loading || messagesState.loading) {
    return <Typography color="text.secondary">Loading communications…</Typography>
  }

  if (contactsState.error) {
    return <PageError message={contactsState.error} />
  }

  if (messagesState.error) {
    return <PageError message={messagesState.error} />
  }

  const sendMessage = async () => {
    if (!activeConversation) {
      setFeedback({ kind: 'error', message: 'Choose a chat first.' })
      return
    }

    if (!draftMessage.trim()) {
      setFeedback({ kind: 'error', message: 'Enter a message before sending.' })
      return
    }

    await actionLock.runLocked('send-message', async () => {
      try {
        await api.post('/internal-messages', {
          recipientType: activeConversation.recipientType,
          recipientRole: activeConversation.recipientType === 'role' ? activeConversation.recipientRole : undefined,
          recipientUserId: activeConversation.recipientType === 'user' ? activeConversation.recipientUserId : undefined,
          message: draftMessage.trim(),
          relatedOrderId: relatedOrderId.trim() || undefined,
        })

        setDraftMessage('')
        setRelatedOrderId('')
        setFeedback(null)
        messagesState.refresh()
      } catch (sendError) {
        setFeedback({ kind: 'error', message: errorMessage(sendError) })
      }
    })
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Live"
        title="Internal communications"
        description="Realtime conversations between departments and individual team members."
        action={(
          <Chip
            color={connected ? 'success' : 'default'}
            label={connected ? `Live · ${unreadCount} unread` : 'Connecting…'}
          />
        )}
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '320px minmax(0, 1fr)' } }}>
        <SectionCard
          title="Chats"
          description="Open a department channel or a direct conversation."
          scrollable
          maxBodyHeight="calc(100vh - 260px)"
          bodySx={{ px: 0 }}
        >
          <Stack divider={<Divider flexItem />} spacing={0}>
            {conversations.length ? (
              conversations.map((conversation) => (
                <Box
                  key={conversation.key}
                  onClick={() => setActiveConversationKey(conversation.key)}
                  sx={{
                    px: 2,
                    py: 1.5,
                    cursor: 'pointer',
                    bgcolor: conversation.key === activeConversationKey ? 'rgba(21,101,192,0.08)' : 'transparent',
                    transition: 'background-color 160ms ease',
                    '&:hover': {
                      bgcolor: conversation.key === activeConversationKey ? 'rgba(21,101,192,0.12)' : 'rgba(15,23,42,0.03)',
                    },
                  }}
                >
                  <Stack direction="row" spacing={1.5} justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography fontWeight={700} noWrap>
                        {conversation.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" noWrap>
                        {conversation.lastMessagePreview}
                      </Typography>
                      {conversation.lastMessageAt ? (
                        <Typography variant="caption" color="text.secondary">
                          {formatDateTime(conversation.lastMessageAt)}
                        </Typography>
                      ) : null}
                    </Box>
                    {conversation.unreadCount ? (
                      <Chip size="small" color="primary" label={conversation.unreadCount} />
                    ) : null}
                  </Stack>
                </Box>
              ))
            ) : (
              <Box sx={{ px: 2, py: 2 }}>
                <EmptyState
                  title="No chats available"
                  body="No departments or users are available for messaging yet."
                />
              </Box>
            )}
          </Stack>
        </SectionCard>

        <Paper sx={{ display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr) auto', minHeight: 'calc(100vh - 260px)' }}>
          {activeConversation ? (
            <>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                spacing={2}
                sx={{ px: 3, py: 2, borderBottom: '1px solid rgba(15,23,42,0.08)' }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h6">{activeConversation.label}</Typography>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {activeConversation.kind === 'user'
                      ? `${staffRoleLabels[activeConversation.contact?.role ?? 'admin']} · ${activeConversation.contact?.email ?? ''}`
                      : activeConversation.kind === 'broadcast'
                        ? 'Visible to everyone in your lab scope.'
                        : 'Department channel with timestamped message history.'}
                  </Typography>
                </Box>
                <Chip
                  icon={<MarkEmailReadRoundedIcon />}
                  color={connected ? 'success' : 'default'}
                  label={connected ? 'Live sync' : 'Waiting for live sync'}
                  variant={connected ? 'filled' : 'outlined'}
                />
              </Stack>

              <Box sx={{ px: 3, py: 2, overflowY: 'auto', bgcolor: '#f8fafc' }}>
                <Stack spacing={1.5}>
                  {conversationMessages.length ? (
                    conversationMessages.map((message) => {
                      const sentByCurrentUser = message.senderUserId === user?._id
                      return (
                        <Stack
                          key={message._id}
                          alignItems={sentByCurrentUser ? 'flex-end' : 'flex-start'}
                        >
                          <Paper
                            sx={{
                              px: 2,
                              py: 1.25,
                              maxWidth: { xs: '92%', md: '72%' },
                              borderRadius: 3,
                              bgcolor: sentByCurrentUser ? '#1565c0' : 'white',
                              color: sentByCurrentUser ? 'white' : 'text.primary',
                            }}
                          >
                            {!sentByCurrentUser ? (
                              <Typography
                                variant="caption"
                                sx={{
                                  display: 'block',
                                  fontWeight: 700,
                                  color: sentByCurrentUser ? 'rgba(255,255,255,0.8)' : '#1565c0',
                                  mb: 0.5,
                                }}
                              >
                                {message.senderName} · {staffRoleLabels[message.senderRole]}
                              </Typography>
                            ) : null}
                            <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                              {message.message}
                            </Typography>
                            {message.relatedOrderId ? (
                              <Typography
                                variant="caption"
                                sx={{
                                  display: 'block',
                                  mt: 0.75,
                                  color: sentByCurrentUser ? 'rgba(255,255,255,0.82)' : 'text.secondary',
                                }}
                              >
                                Order: {message.relatedOrderId}
                              </Typography>
                            ) : null}
                            <Typography
                              variant="caption"
                              sx={{
                                display: 'block',
                                mt: 0.75,
                                textAlign: sentByCurrentUser ? 'right' : 'left',
                                color: sentByCurrentUser ? 'rgba(255,255,255,0.82)' : 'text.secondary',
                              }}
                            >
                              {formatDateTime(message.createdAt)}
                            </Typography>
                          </Paper>
                        </Stack>
                      )
                    })
                  ) : (
                    <EmptyState
                      title="No messages yet"
                      body="This thread is empty. Send the first message below."
                    />
                  )}
                  <Box ref={scrollAnchorRef} />
                </Stack>
              </Box>

              <Stack spacing={2} sx={{ p: 3, borderTop: '1px solid rgba(15,23,42,0.08)' }}>
                <TextField
                  label="Related order (optional)"
                  value={relatedOrderId}
                  onChange={(event) => setRelatedOrderId(event.target.value)}
                  placeholder="ORD-000123"
                />
                <TextField
                  label="Message"
                  multiline
                  minRows={4}
                  value={draftMessage}
                  onChange={(event) => setDraftMessage(event.target.value)}
                  placeholder={`Message ${activeConversation.label}...`}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault()
                      void sendMessage()
                    }
                  }}
                />
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
                  <Typography variant="caption" color="text.secondary">
                    Press Ctrl/Cmd + Enter to send quickly.
                  </Typography>
                  <Button
                    variant="contained"
                    endIcon={<SendRoundedIcon />}
                    onClick={() => void sendMessage()}
                    disabled={actionLock.isPending('send-message')}
                  >
                    Send
                  </Button>
                </Stack>
              </Stack>
            </>
          ) : (
            <Box sx={{ p: 4 }}>
              <EmptyState
                title="Choose a chat"
                body="Select a department or a user from the left to open the conversation."
              />
            </Box>
          )}
        </Paper>
      </Box>
    </Stack>
  )
}

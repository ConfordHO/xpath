import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import { api } from '../api'
import { useAuth } from '../auth'
import { PageHeader, SectionCard } from '../components'

import { errorMessage, PageError, useActionLock, useLoadable } from './shared'

import type { ProjectReviewComment } from '../types'

import { formatDateTime } from '../utils'

const defaultForm = {
  title: '',
  module: 'General',
  screen: '',
  severity: 'medium' as ProjectReviewComment['severity'],
  comment: '',
}

const severityColors: Record<ProjectReviewComment['severity'], 'default' | 'warning' | 'error'> = {
  low: 'default',
  medium: 'default',
  high: 'warning',
  critical: 'error',
}

const statusLabels: Record<ProjectReviewComment['status'], string> = {
  new: 'New',
  reviewed: 'Reviewed',
  planned: 'Planned',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
}

export function ProjectReviewPage() {
  const { user } = useAuth()
  const actionLock = useActionLock()
  const [form, setForm] = useState(defaultForm)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [triageDrafts, setTriageDrafts] = useState<
    Record<string, { status: ProjectReviewComment['status']; developerResponse: string }>
  >({})

  const reviewState = useLoadable<ProjectReviewComment[]>([], [user?._id], async () => {
    const response = await api.get<ProjectReviewComment[]>('/project-review-comments')
    return response.data
  })

  const canTriage = user?.role === 'admin' || user?.role === 'super_admin'

  const submitReview = async () => {
    if (!form.title.trim() || !form.screen.trim() || !form.comment.trim()) {
      setFeedback({ kind: 'error', message: 'Add a title, screen, and comment before submitting.' })
      return
    }

    await actionLock.runLocked('submit-review', async () => {
      try {
        await api.post('/project-review-comments', {
          ...form,
          title: form.title.trim(),
          module: form.module.trim() || 'General',
          screen: form.screen.trim(),
          comment: form.comment.trim(),
        })
        setForm(defaultForm)
        setFeedback({ kind: 'success', message: 'Project review comment saved for developer review.' })
        reviewState.refresh()
      } catch (submitError) {
        setFeedback({ kind: 'error', message: errorMessage(submitError) })
      }
    })
  }

  const saveTriage = async (comment: ProjectReviewComment) => {
    const draft = triageDrafts[comment._id] ?? {
      status: comment.status,
      developerResponse: comment.developerResponse ?? '',
    }

    await actionLock.runLocked(`triage-${comment._id}`, async () => {
      try {
        await api.patch(`/project-review-comments/${comment._id}`, {
          status: draft.status,
          developerResponse: draft.developerResponse.trim() || null,
        })
        setFeedback({ kind: 'success', message: 'Project review status updated.' })
        reviewState.refresh()
      } catch (triageError) {
        setFeedback({ kind: 'error', message: errorMessage(triageError) })
      }
    })
  }

  if (reviewState.error) {
    return <PageError message={reviewState.error} />
  }

  return (
    <Stack spacing={3}>
      <PageHeader
        eyebrow="Feedback"
        title="Project review comments"
        description="Record issues, workflow friction, missing production requirements, or improvement notes for the development team."
      />
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', xl: '420px minmax(0, 1fr)' } }}>
        <SectionCard title="Add a review comment" description="Tell the developers exactly what you saw and where it happened.">
          <Stack spacing={2}>
            <TextField
              label="Short title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            />
            <TextField
              label="Module"
              value={form.module}
              onChange={(event) => setForm((current) => ({ ...current, module: event.target.value }))}
              placeholder="Orders, finance, reporting, dashboard..."
            />
            <TextField
              label="Screen or workflow"
              value={form.screen}
              onChange={(event) => setForm((current) => ({ ...current, screen: event.target.value }))}
              placeholder="/orders/create or Technician workflow"
            />
            <FormControl fullWidth>
              <InputLabel>Severity</InputLabel>
              <Select
                label="Severity"
                value={form.severity}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    severity: event.target.value as ProjectReviewComment['severity'],
                  }))
                }
              >
                <MenuItem value="low">Low</MenuItem>
                <MenuItem value="medium">Medium</MenuItem>
                <MenuItem value="high">High</MenuItem>
                <MenuItem value="critical">Critical</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Review comment"
              multiline
              minRows={6}
              value={form.comment}
              onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
            />
            <Button
              variant="contained"
              onClick={() => void submitReview()}
              disabled={actionLock.isPending('submit-review')}
            >
              Save review comment
            </Button>
          </Stack>
        </SectionCard>

        <SectionCard
          title={canTriage ? 'Review queue' : 'My submitted comments'}
          description={canTriage ? 'Admins can triage feedback and record developer responses.' : 'You can see the comments you submitted and their status.'}
        >
          <Stack spacing={2}>
            {reviewState.loading ? (
              <Typography color="text.secondary">Loading review comments...</Typography>
            ) : reviewState.data.length ? (
              reviewState.data.map((comment) => {
                const draft = triageDrafts[comment._id] ?? {
                  status: comment.status,
                  developerResponse: comment.developerResponse ?? '',
                }
                return (
                  <Paper key={comment._id} variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1.5}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between">
                        <Box>
                          <Typography variant="h6">{comment.title}</Typography>
                          <Typography variant="body2" color="text.secondary">
                            {comment.module} · {comment.screen} · {comment.createdByName} · {formatDateTime(comment.createdAt)}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1}>
                          <Chip size="small" label={comment.severity} color={severityColors[comment.severity]} />
                          <Chip size="small" label={statusLabels[comment.status]} />
                        </Stack>
                      </Stack>
                      <Typography sx={{ whiteSpace: 'pre-wrap' }}>{comment.comment}</Typography>
                      {comment.developerResponse ? (
                        <Alert severity="info">
                          <Typography fontWeight={700}>Developer response</Typography>
                          <Typography sx={{ whiteSpace: 'pre-wrap' }}>{comment.developerResponse}</Typography>
                        </Alert>
                      ) : null}
                      {canTriage ? (
                        <Stack spacing={1.5}>
                          <FormControl fullWidth>
                            <InputLabel>Status</InputLabel>
                            <Select
                              label="Status"
                              value={draft.status}
                              onChange={(event) =>
                                setTriageDrafts((current) => ({
                                  ...current,
                                  [comment._id]: {
                                    ...draft,
                                    status: event.target.value as ProjectReviewComment['status'],
                                  },
                                }))
                              }
                            >
                              {Object.entries(statusLabels).map(([status, label]) => (
                                <MenuItem key={status} value={status}>{label}</MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                          <TextField
                            label="Developer response"
                            multiline
                            minRows={3}
                            value={draft.developerResponse}
                            onChange={(event) =>
                              setTriageDrafts((current) => ({
                                ...current,
                                [comment._id]: {
                                  ...draft,
                                  developerResponse: event.target.value,
                                },
                              }))
                            }
                          />
                          <Button
                            variant="outlined"
                            onClick={() => void saveTriage(comment)}
                            disabled={actionLock.isPending(`triage-${comment._id}`)}
                          >
                            Save triage update
                          </Button>
                        </Stack>
                      ) : null}
                    </Stack>
                  </Paper>
                )
              })
            ) : (
              <Typography color="text.secondary">No project review comments have been submitted yet.</Typography>
            )}
          </Stack>
        </SectionCard>
      </Box>
    </Stack>
  )
}

import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import MicRoundedIcon from '@mui/icons-material/MicRounded'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
import VolumeUpRoundedIcon from '@mui/icons-material/VolumeUpRounded'
import { Alert, Box, Button, CircularProgress, IconButton, Stack, TextField, Tooltip, Typography, type TextFieldProps } from '@mui/material'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api'

export type VoiceAssistContext =
  | 'order_intake'
  | 'sample_observation'
  | 'histology_grossing'
  | 'histology_processing'
  | 'ihc_qc'
  | 'cytology_qc'
  | 'pathology_report'
  | 'department_message'
  | 'general'

type VoiceAssistFieldProps = Omit<TextFieldProps, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
  context: VoiceAssistContext
  targetField: string
  orderId?: string
  accessionId?: string
  sampleId?: string
  assistInstruction?: string
}

function toMessage(error: unknown) {
  const apiMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
  if (apiMessage) return apiMessage
  if (error instanceof Error) return error.message
  return 'Voice assist failed.'
}

function appendTranscript(existing: string, transcript: string) {
  const incoming = transcript.trim()
  if (!incoming) return existing
  if (!existing.trim()) return incoming
  return `${existing.trimEnd()}\n${incoming}`
}

function bestAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? ''
}

export function VoiceAssistField({
  value,
  onChange,
  context,
  targetField,
  orderId,
  accessionId,
  sampleId,
  assistInstruction,
  multiline = true,
  minRows = 3,
  helperText,
  ...textFieldProps
}: VoiceAssistFieldProps) {
  const valueRef = useRef(value)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [assisting, setAssisting] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'info' | 'error'; message: string } | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      if (recorder.state === 'recording') {
        recorder.stop()
      }
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
    }
  }, [])

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const transcribeAudio = async (blob: Blob) => {
    setTranscribing(true)
    setFeedback(null)
    try {
      const formData = new FormData()
      formData.append('audio', blob, `dictation-${Date.now()}.webm`)
      formData.append('context', context)
      formData.append('targetField', targetField)
      if (orderId) formData.append('orderId', orderId)
      if (accessionId) formData.append('accessionId', accessionId)
      if (sampleId) formData.append('sampleId', sampleId)
      const response = await api.post('/ai/transcribe', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onChange(appendTranscript(valueRef.current, String(response.data.text ?? '')))
      setFeedback({ kind: 'info', message: 'Dictation added.' })
    } catch (error) {
      setFeedback({ kind: 'error', message: toMessage(error) })
    } finally {
      setTranscribing(false)
    }
  }

  const startRecording = async () => {
    setFeedback(null)
    setSuggestion(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setFeedback({ kind: 'error', message: 'Microphone recording requires a supported HTTPS browser.' })
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = bestAudioMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      streamRef.current = stream
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        setRecording(false)
        stopStream()
        const audio = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        chunksRef.current = []
        if (audio.size) {
          void transcribeAudio(audio)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (error) {
      stopStream()
      setRecording(false)
      setFeedback({ kind: 'error', message: toMessage(error) })
    }
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (recorder?.state === 'recording') {
      recorder.stop()
    }
  }

  const speak = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setFeedback({ kind: 'error', message: 'Speech output requires a supported browser.' })
      return
    }
    const text = value.trim()
    if (!text) {
      setFeedback({ kind: 'error', message: 'Add text before using speech output.' })
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = navigator.language || 'en-US'
    window.speechSynthesis.speak(utterance)
  }

  const requestAssist = async () => {
    setAssisting(true)
    setFeedback(null)
    setSuggestion(null)
    try {
      const response = await api.post('/ai/specialist-assist', {
        context,
        targetField,
        orderId,
        accessionId,
        sampleId,
        instruction: assistInstruction,
        text: value,
      })
      setSuggestion(String(response.data.suggestion ?? '').trim())
    } catch (error) {
      setFeedback({ kind: 'error', message: toMessage(error) })
    } finally {
      setAssisting(false)
    }
  }

  return (
    <Stack spacing={1}>
      <TextField
        {...textFieldProps}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        multiline={multiline}
        minRows={minRows}
        helperText={helperText}
      />
      <Stack direction="row" spacing={1} alignItems="center">
        <Tooltip title={recording ? 'Stop dictation' : 'Record dictation'}>
          <span>
            <IconButton color={recording ? 'error' : 'primary'} onClick={recording ? stopRecording : startRecording} disabled={transcribing}>
              {recording ? <StopRoundedIcon /> : <MicRoundedIcon />}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Read text aloud">
          <span>
            <IconButton onClick={speak} disabled={!value.trim()}>
              <VolumeUpRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Specialist drafting assist">
          <span>
            <IconButton color="secondary" onClick={requestAssist} disabled={assisting}>
              {assisting ? <CircularProgress size={20} /> : <AutoAwesomeRoundedIcon />}
            </IconButton>
          </span>
        </Tooltip>
        {transcribing ? <CircularProgress size={20} /> : null}
      </Stack>
      {feedback ? <Alert severity={feedback.kind}>{feedback.message}</Alert> : null}
      {suggestion ? (
        <Alert
          severity="info"
          action={
            <Button size="small" onClick={() => {
              onChange(suggestion)
              setSuggestion(null)
            }}>
              Use
            </Button>
          }
        >
          <Box>
            <Typography component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', font: 'inherit' }}>
              {suggestion}
            </Typography>
          </Box>
        </Alert>
      ) : null}
    </Stack>
  )
}

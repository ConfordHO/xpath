import CameraAltRoundedIcon from '@mui/icons-material/CameraAltRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'

import { api, getStoredToken } from '../api'
import { VoiceAssistField } from './VoiceAssistField'

type OcrOrderUploadProps = {
  title?: string
  buttonLabel?: string
  endpoint?: string
  buildCorrections?: () => Record<string, unknown>
  onOrderCreated?: (order: any) => void
}

function toMessage(error: unknown) {
  const apiMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
  if (apiMessage) return apiMessage
  if (error instanceof Error) return error.message
  return 'OCR upload failed.'
}

export function OcrOrderUpload({
  title = 'Scan requisition',
  buttonLabel = 'Scan and create order',
  endpoint,
  buildCorrections,
  onOrderCreated,
}: OcrOrderUploadProps) {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [canUseVoiceAssist, setCanUseVoiceAssist] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setCameraOpen(false)
  }

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    setCanUseVoiceAssist(Boolean(getStoredToken()))
  }, [])

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return
    videoRef.current.srcObject = streamRef.current
    void videoRef.current.play().catch(() => undefined)
  }, [cameraOpen])

  const openCamera = async () => {
    setCameraError(null)
    setMessage(null)
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera capture requires a supported HTTPS browser.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      setCameraOpen(true)
    } catch (error) {
      setCameraError(toMessage(error))
    }
  }

  const capturePhoto = async () => {
    setCameraError(null)
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setCameraError('Camera preview is not ready yet.')
      return
    }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) {
      setCameraError('Camera capture is not available in this browser.')
      return
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((image) => {
        if (image) {
          resolve(image)
        } else {
          reject(new Error('Unable to capture the medical note photo.'))
        }
      }, 'image/jpeg', 0.9)
    }).catch((error) => {
      setCameraError(toMessage(error))
      return null
    })
    if (!blob) return
    setFiles((prev) => [...prev, new File([blob], `medical-note-${Date.now()}.jpg`, { type: 'image/jpeg' })])
    setMessage({ kind: 'success', text: 'Medical note photo added.' })
    stopCamera()
  }

  const submit = async () => {
    setMessage(null)
    if (!files.length && !text.trim()) {
      setMessage({ kind: 'error', text: 'Select at least one file or enter requisition text.' })
      return
    }
    setBusy(true)
    try {
      const formData = new FormData()
      files.forEach((file) => formData.append('files', file))
      if (text.trim()) formData.append('text', text.trim())
      formData.append('verify', 'true')
      formData.append('corrections', JSON.stringify(buildCorrections?.() ?? {}))
      const targetEndpoint = endpoint ?? (getStoredToken() ? '/intake/ocr/jobs' : '/public/intake/ocr-order-request')
      const response = await api.post(targetEndpoint, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const order = response.data.order
      if (!order) {
        throw new Error(response.data.message ?? 'The scan was queued for verification.')
      }
      setFiles([])
      setText('')
      setMessage({ kind: 'success', text: `Order ${order.orderNumber} created.` })
      onOrderCreated?.(order)
    } catch (error) {
      setMessage({ kind: 'error', text: toMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 2 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle2">{title}</Typography>
        {message ? <Alert severity={message.kind}>{message.text}</Alert> : null}
        <Button component="label" variant="outlined" startIcon={<UploadFileRoundedIcon />}>
          {files.length ? `${files.length} file${files.length === 1 ? '' : 's'} selected` : 'Choose files'}
          <input
            hidden
            multiple
            type="file"
            accept="image/*,.pdf,.txt,.doc,.docx"
            capture="environment"
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
        </Button>
        <Button variant="outlined" startIcon={<CameraAltRoundedIcon />} onClick={openCamera}>
          Capture medical note
        </Button>
        {cameraError ? <Alert severity="error">{cameraError}</Alert> : null}
        {cameraOpen ? (
          <Stack spacing={1}>
            <Box
              component="video"
              ref={videoRef}
              muted
              playsInline
              sx={{ width: '100%', maxHeight: 360, bgcolor: 'common.black', borderRadius: 1, objectFit: 'contain' }}
            />
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={capturePhoto}>Take photo</Button>
              <Button onClick={stopCamera}>Close camera</Button>
            </Stack>
          </Stack>
        ) : null}
        <Box component="canvas" ref={canvasRef} sx={{ display: 'none' }} />
        {canUseVoiceAssist ? (
          <VoiceAssistField
            label="Requisition text"
            value={text}
            onChange={setText}
            context="order_intake"
            targetField="requisition_text"
            minRows={3}
          />
        ) : (
          <TextField
            label="Requisition text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            multiline
            minRows={3}
          />
        )}
        <Button variant="contained" disabled={busy} onClick={submit}>
          {buttonLabel}
        </Button>
      </Stack>
    </Box>
  )
}

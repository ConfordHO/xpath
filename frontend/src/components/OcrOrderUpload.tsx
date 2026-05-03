import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'

import { api, getStoredToken } from '../api'

type OcrOrderUploadProps = {
  title?: string
  buttonLabel?: string
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
  buildCorrections,
  onOrderCreated,
}: OcrOrderUploadProps) {
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

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
      const endpoint = getStoredToken() ? '/intake/ocr/jobs' : '/public/intake/ocr-order-request'
      const response = await api.post(endpoint, formData, {
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
            onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
          />
        </Button>
        <TextField
          label="Requisition text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          multiline
          minRows={3}
        />
        <Button variant="contained" disabled={busy} onClick={submit}>
          {buttonLabel}
        </Button>
      </Stack>
    </Box>
  )
}

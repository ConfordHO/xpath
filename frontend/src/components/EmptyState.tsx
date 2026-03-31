import { Box, Paper, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  body: string
  action?: ReactNode
}

export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <Paper
      sx={{
        p: 4,
        borderRadius: 4,
        borderStyle: 'dashed',
      }}
    >
      <Typography variant="h5">{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1, maxWidth: 720 }}>
        {body}
      </Typography>
      {action ? <Box sx={{ mt: 2 }}>{action}</Box> : null}
    </Paper>
  )
}

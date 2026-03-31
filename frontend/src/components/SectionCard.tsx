import { Box, Paper, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface SectionCardProps {
  title?: string
  description?: string
  children: ReactNode
  action?: ReactNode
}

export function SectionCard({ title, description, children, action }: SectionCardProps) {
  return (
    <Paper sx={{ p: 3 }}>
      {title || action ? (
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'flex-start', md: 'center' }}
          spacing={2}
          sx={{ mb: 2 }}
        >
          <Box>
            {title ? <Typography variant="h5">{title}</Typography> : null}
            {description ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                {description}
              </Typography>
            ) : null}
          </Box>
          {action}
        </Stack>
      ) : null}
      {children}
    </Paper>
  )
}

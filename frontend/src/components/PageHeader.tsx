import { Box, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', md: 'center' }}
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box>
        {eyebrow ? (
          <Typography
            variant="overline"
            sx={{ color: 'primary.main', letterSpacing: '0.12em' }}
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography variant="h3" sx={{ fontSize: { xs: 34, md: 42 }, lineHeight: 1 }}>
          {title}
        </Typography>
        {description ? (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1, maxWidth: 860 }}>
            {description}
          </Typography>
        ) : null}
      </Box>
      {action}
    </Stack>
  )
}

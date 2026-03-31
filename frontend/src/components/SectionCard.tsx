import { Box, Paper, Stack, Typography, type SxProps, type Theme } from '@mui/material'
import type { ReactNode } from 'react'

interface SectionCardProps {
  title?: string
  description?: string
  children: ReactNode
  action?: ReactNode
  scrollable?: boolean
  maxBodyHeight?: number | string
  bodySx?: SxProps<Theme>
}

export function SectionCard({
  title,
  description,
  children,
  action,
  scrollable = false,
  maxBodyHeight = 420,
  bodySx,
}: SectionCardProps) {
  const mergedBodySx: SxProps<Theme> | undefined = scrollable
    ? ([
        {
          maxHeight: maxBodyHeight,
          overflowY: 'auto',
          pr: 0.5,
        },
        ...((Array.isArray(bodySx) ? bodySx : bodySx ? [bodySx] : []) as SxProps<Theme>[]),
      ] as SxProps<Theme>)
    : bodySx

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
      <Box sx={mergedBodySx}>
        {children}
      </Box>
    </Paper>
  )
}

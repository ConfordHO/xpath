import { Paper, Typography } from '@mui/material'

interface MetricCardProps {
  label: string
  value: string
  helper?: string
}

export function MetricCard({ label, value, helper }: MetricCardProps) {
  return (
    <Paper
      sx={{
        p: 3,
        borderRadius: 3,
        minHeight: 140,
      }}
    >
      <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '0.1em' }}>
        {label}
      </Typography>
      <Typography variant="h4" sx={{ mt: 1 }}>
        {value}
      </Typography>
      {helper ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {helper}
        </Typography>
      ) : null}
    </Paper>
  )
}

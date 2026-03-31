import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'

import logoLarge from '../assets/logo_large.png'

interface BrandLogoProps {
  alt?: string
  sx?: SxProps<Theme>
  width?: number | string
}

export function BrandLogo({ alt = 'X.PATH LABS', sx, width = 220 }: BrandLogoProps) {
  return (
    <Box
      component="img"
      src={logoLarge}
      alt={alt}
      sx={[
        {
          display: 'block',
          width,
          maxWidth: '100%',
          height: 'auto',
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    />
  )
}

import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { StaticImageData } from 'next/image'

import logoLarge from '../assets/logo_large.png'

interface BrandLogoProps {
  alt?: string
  sx?: SxProps<Theme>
  width?: number | string
}

export function BrandLogo({ alt = 'X.PATH LABS', sx, width = 220 }: BrandLogoProps) {
  const logoSrc = typeof logoLarge === 'string' ? logoLarge : (logoLarge as StaticImageData).src

  return (
    <Box
      component="img"
      src={logoSrc}
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

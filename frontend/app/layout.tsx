import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/500.css'
import '@fontsource/dm-sans/700.css'
import '@fontsource/cormorant-garamond/500.css'
import '@fontsource/cormorant-garamond/600.css'
import '@fontsource/cormorant-garamond/700.css'
import '../src/index.css'

export const metadata: Metadata = {
  title: 'X.PATH LIMS',
  description: 'X.PATH Labs pathology and molecular diagnostics platform',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}

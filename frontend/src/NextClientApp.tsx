'use client'

import { CssBaseline, ThemeProvider } from '@mui/material'
import { BrowserRouter, StaticRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

import App from './App'
import { AuthProvider } from './auth'
import type { AppLocale } from './i18n'
import { appTheme } from './theme'

interface NextClientAppProps {
  defaultLocale?: AppLocale
  initialPath?: string
}

function UniversalRouter({ children, initialPath = '/' }: { children: ReactNode; initialPath?: string }) {
  if (typeof window === 'undefined') {
    return <StaticRouter location={initialPath}>{children}</StaticRouter>
  }
  return <BrowserRouter>{children}</BrowserRouter>
}

export function NextClientApp({ defaultLocale = 'en', initialPath = '/' }: NextClientAppProps) {
  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <UniversalRouter initialPath={initialPath}>
        <AuthProvider>
          <App defaultLocale={defaultLocale} />
        </AuthProvider>
      </UniversalRouter>
    </ThemeProvider>
  )
}

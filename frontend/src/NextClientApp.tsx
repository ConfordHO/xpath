'use client'

import { CssBaseline, ThemeProvider } from '@mui/material'
import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { AuthProvider } from './auth'
import type { AppLocale } from './i18n'
import { appTheme } from './theme'

interface NextClientAppProps {
  defaultLocale?: AppLocale
}

export function NextClientApp({ defaultLocale = 'en' }: NextClientAppProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return null
  }

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <BrowserRouter>
        <AuthProvider>
          <App defaultLocale={defaultLocale} />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

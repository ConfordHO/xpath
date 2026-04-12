'use client'

import { CssBaseline, ThemeProvider } from '@mui/material'
import { useEffect, useState } from 'react'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import { AuthProvider } from './auth'
import { appTheme } from './theme'

export function NextClientApp() {
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
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

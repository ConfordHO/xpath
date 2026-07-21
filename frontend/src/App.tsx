import { AppRoutes } from './app/AppRoutes'
import { FloatingLanguageToggle, LanguageProvider, type AppLocale } from './i18n'

interface AppProps {
  defaultLocale?: AppLocale
}

function App({ defaultLocale = 'en' }: AppProps) {
  return (
    <LanguageProvider defaultLocale={defaultLocale}>
      <AppRoutes />
      <FloatingLanguageToggle />
    </LanguageProvider>
  )
}

export default App

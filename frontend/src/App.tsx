import { AppRoutes } from './app/AppRoutes'
import { FloatingLanguageToggle, LanguageProvider } from './i18n'

function App() {
  return (
    <LanguageProvider>
      <AppRoutes />
      <FloatingLanguageToggle />
    </LanguageProvider>
  )
}

export default App

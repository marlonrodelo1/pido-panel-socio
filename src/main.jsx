import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConfigErrorScreen from './components/ConfigErrorScreen.jsx'
import { SUPABASE_CONFIG_OK } from './lib/supabase'

// Captura ultima de errores no manejados — log a consola.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (ev) => {
    // eslint-disable-next-line no-console
    console.error('[Pidoo window.error]', ev?.error || ev?.message, ev?.filename, ev?.lineno)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    // eslint-disable-next-line no-console
    console.error('[Pidoo unhandledrejection]', ev?.reason)
  })
}

// Validacion al boot: si faltaron las VITE_* en el build, mostrar pantalla
// legible en vez de pantalla blanca silenciosa.
function getMissingEnvKeys() {
  const missing = []
  if (!import.meta.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY')
  return missing
}

const rootEl = document.getElementById('root')
const root = createRoot(rootEl)

const missingEnv = getMissingEnvKeys()

if (!SUPABASE_CONFIG_OK || missingEnv.length > 0) {
  root.render(<ConfigErrorScreen missing={missingEnv.length ? missingEnv : ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']} />)
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

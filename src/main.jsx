import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConfigErrorScreen from './components/ConfigErrorScreen.jsx'
import { SUPABASE_CONFIG_OK } from './lib/supabase'

// Captura ultima de errores no manejados — log a consola para Web Inspector
// Safari (iOS). Si llega aqui, la app sobrevive pero el error queda registrado.
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

// StatusBar setup en background — diferido y con catch para no bloquear el
// boot. Capacitor.config.ts ya define StatusBar (overlay=false, fondo claro);
// este setup runtime es "cinturon y tirantes" y NO debe romper el render
// si el plugin tarda en cargar.
function setupStatusBar() {
  if (typeof window === 'undefined') return
  if (!Capacitor.isNativePlatform?.()) return
  setTimeout(() => {
    import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) => {
        StatusBar.setStyle({ style: Style.Light }).catch(() => {})
      })
      .catch(() => {})
  }, 0)
}
try { setupStatusBar() } catch (_) {}

// Validacion al boot: si faltaron las VITE_* en el build, mostrar pantalla
// legible en vez de pantalla blanca silenciosa (caso TestFlight tipico).
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
  // No envolvemos en StrictMode/ErrorBoundary aqui — queremos que esta
  // pantalla salga si o si.
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

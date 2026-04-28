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

// StatusBar overlay TRUE: la WebView ocupa toda la pantalla y nosotros
// reservamos espacio en CSS via env(safe-area-inset-top). Es mas predecible
// que confiar en Android para "empujar" la WebView abajo.
async function setupStatusBar() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: true })
    await StatusBar.setStyle({ style: Style.Light }) // iconos oscuros sobre fondo claro
  } catch (_) {}
}
setupStatusBar()

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

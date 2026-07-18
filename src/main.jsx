import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import ConfigErrorScreen from './components/ConfigErrorScreen.jsx'
import { SUPABASE_CONFIG_OK } from './lib/supabase'
import { setupStatusBar, hideSplash } from './lib/capacitor'
import { initLiveUpdates } from './lib/liveUpdates'
import { installPedidoSoundUnlock } from './lib/pedidoSound'

// Desbloqueo del audio del pedido LO ANTES POSIBLE (18-jul-2026). Antes se instalaba
// dentro de RiderProvider, que solo se monta tras el gate de sesión: los toques en el
// Login no contaban, así que en el arranque en frío el audio quedaba bloqueado y el
// modal de pedido salía MUDO. Cualquier toque en la app ya vale.
installPedidoSoundUnlock()

// OTA (Capgo): confirma que este bundle arrancó bien (si no, Capgo revierte al anterior) y
// deja que autoUpdate traiga las siguientes versiones sin pasar por la tienda. No-op en web.
initLiveUpdates()

// Setup StatusBar nativo (no-op en web). overlay=true para safe-area.
setupStatusBar().catch(() => {})
// Tras 1.5s ocultar splash (configurado en capacitor.config.ts)
setTimeout(() => { hideSplash().catch(() => {}) }, 1500)

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

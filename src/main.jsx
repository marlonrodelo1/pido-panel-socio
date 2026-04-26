import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.jsx'

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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

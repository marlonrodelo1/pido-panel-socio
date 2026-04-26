import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.jsx'

// StatusBar: respetar barra del sistema (no overlay) en Capacitor nativo
async function setupStatusBar() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setStyle({ style: Style.Light }) // iconos oscuros sobre fondo claro
    await StatusBar.setBackgroundColor({ color: '#FAFAF7' })
  } catch (_) {}
}
setupStatusBar()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

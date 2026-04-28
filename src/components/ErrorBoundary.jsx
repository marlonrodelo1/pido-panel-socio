import { Component } from 'react'

// ErrorBoundary global. Si algun render/lifecycle lanza una excepcion,
// renderiza una pantalla legible con mensaje y boton Reintentar en vez
// de dejar al usuario con pantalla blanca (caso clasico TestFlight).
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, info: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    // Log al stdout — en iOS lo captura Safari Web Inspector
    // eslint-disable-next-line no-console
    console.error('[Pidoo ErrorBoundary]', error, info?.componentStack)
    this.setState({ info })
  }
  render() {
    if (!this.state.hasError) return this.props.children
    const { error, info } = this.state
    const msg = (error && (error.message || String(error))) || 'Error desconocido'
    const stack = info?.componentStack || (error && error.stack) || ''
    return (
      <div style={wrap}>
        <div style={card}>
          <div style={iconBox}>!</div>
          <div style={title}>Pidoo Socio no pudo arrancar</div>
          <div style={subtitle}>
            Ha ocurrido un error inesperado. Cierra y vuelve a abrir la app.
            Si el problema persiste contacta con soporte.
          </div>
          <pre style={pre}>{msg}</pre>
          {stack ? <details style={details}><summary style={summary}>Detalles tecnicos</summary><pre style={preSmall}>{stack}</pre></details> : null}
          <button style={btn} onClick={() => { try { this.setState({ hasError: false, error: null, info: null }) } catch (_) { window.location.reload() } }}>
            Reintentar
          </button>
          <button style={btnGhost} onClick={() => { try { window.location.reload() } catch (_) {} }}>
            Recargar
          </button>
        </div>
      </div>
    )
  }
}

const wrap = {
  position: 'fixed', inset: 0, background: '#FAFAF7', color: '#1F1F1E',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'max(env(safe-area-inset-top), 24px) 20px max(env(safe-area-inset-bottom), 24px)',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
  zIndex: 999999,
}
const card = {
  background: '#FFFFFF', border: '1px solid #E8E6E0', borderRadius: 16,
  maxWidth: 460, width: '100%', padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
}
const iconBox = {
  width: 48, height: 48, borderRadius: 24, background: 'rgba(220,38,38,0.10)',
  color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 800, fontSize: 24, marginBottom: 12,
}
const title = { fontSize: 18, fontWeight: 800, marginBottom: 6 }
const subtitle = { fontSize: 14, color: '#6B6B68', lineHeight: 1.45, marginBottom: 14 }
const pre = {
  background: '#F4F2EC', border: '1px solid #E8E6E0', borderRadius: 8,
  padding: 10, fontSize: 12, lineHeight: 1.4, color: '#1F1F1E',
  whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto',
}
const details = { marginTop: 10 }
const summary = { fontSize: 12, color: '#6B6B68', cursor: 'pointer' }
const preSmall = { ...pre, fontSize: 11, maxHeight: 200 }
const btn = {
  marginTop: 14, width: '100%', height: 46, border: 'none',
  background: '#FF6B2C', color: '#fff', borderRadius: 10,
  fontWeight: 800, fontSize: 14, cursor: 'pointer',
}
const btnGhost = {
  marginTop: 8, width: '100%', height: 42, background: '#F4F2EC',
  color: '#1F1F1E', border: '1px solid #E8E6E0', borderRadius: 10,
  fontWeight: 700, fontSize: 13, cursor: 'pointer',
}

// Pantalla mostrada cuando el build no incluyo VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY.
// Sustituye la pantalla blanca clasica de TestFlight con un mensaje legible
// que dice exactamente que arreglar.
export default function ConfigErrorScreen({ missing }) {
  return (
    <div style={wrap}>
      <div style={card}>
        <div style={iconBox}>!</div>
        <div style={title}>Pidoo Socio: configuracion incompleta</div>
        <div style={subtitle}>
          El build de la app no incluye las claves necesarias para conectarse al servidor.
          Esto es un problema del proceso de compilacion, no de tu cuenta.
        </div>
        <div style={sub2}>Falta(n):</div>
        <ul style={list}>
          {missing.map(k => <li key={k} style={li}><code style={code}>{k}</code></li>)}
        </ul>
        <div style={hint}>
          Si eres tester: avisa al equipo Pidoo (codigo configuracion incompleta).
        </div>
      </div>
    </div>
  )
}

const wrap = {
  position: 'fixed', inset: 0, background: '#FAFAF7', color: '#1F1F1E',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 'max(env(safe-area-inset-top), 24px) 20px max(env(safe-area-inset-bottom), 24px)',
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif',
}
const card = {
  background: '#FFFFFF', border: '1px solid #E8E6E0', borderRadius: 16,
  maxWidth: 460, width: '100%', padding: 24, boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
}
const iconBox = {
  width: 48, height: 48, borderRadius: 24, background: 'rgba(217,119,6,0.12)',
  color: '#D97706', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontWeight: 800, fontSize: 24, marginBottom: 12,
}
const title = { fontSize: 18, fontWeight: 800, marginBottom: 6 }
const subtitle = { fontSize: 14, color: '#6B6B68', lineHeight: 1.45, marginBottom: 14 }
const sub2 = { fontSize: 13, fontWeight: 700, marginBottom: 6 }
const list = { margin: 0, padding: '0 0 0 18px' }
const li = { fontSize: 13, marginBottom: 4 }
const code = {
  background: '#F4F2EC', border: '1px solid #E8E6E0', borderRadius: 6,
  padding: '2px 6px', fontSize: 12, fontFamily: 'monospace',
}
const hint = { marginTop: 14, fontSize: 12, color: '#6B6B68' }

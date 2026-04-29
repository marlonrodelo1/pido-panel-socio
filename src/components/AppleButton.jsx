import { useState } from 'react'
import { loginApple } from '../lib/auth'

const AppleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.05 12.04c-.03-3.13 2.55-4.62 2.67-4.7-1.45-2.13-3.72-2.42-4.53-2.45-1.93-.2-3.76 1.13-4.74 1.13-.99 0-2.49-1.1-4.1-1.07-2.11.03-4.06 1.23-5.14 3.12-2.19 3.81-.56 9.43 1.58 12.52 1.04 1.51 2.28 3.21 3.9 3.15 1.57-.06 2.16-1.01 4.05-1.01 1.89 0 2.42 1.01 4.07.98 1.68-.03 2.74-1.54 3.77-3.06 1.19-1.76 1.68-3.46 1.71-3.55-.04-.02-3.28-1.26-3.32-4.99l.08-.07zM14.06 4.22c.86-1.04 1.45-2.49 1.29-3.93-1.25.05-2.76.83-3.65 1.87-.8.92-1.5 2.4-1.31 3.81 1.39.11 2.81-.71 3.67-1.75z"/>
  </svg>
)

export default function AppleButton({ label = 'Continuar con Apple' }) {
  const [loading, setLoading] = useState(false)
  const handle = async () => {
    setLoading(true)
    try { await loginApple() }
    catch (e) { console.error('[AppleButton] error', e) }
    finally { setLoading(false) }
  }
  return (
    <button
      onClick={handle}
      disabled={loading}
      style={{
        width: '100%', padding: '13px 0', borderRadius: 8,
        border: 'none', background: '#000', color: '#fff',
        fontSize: 14, fontWeight: 600,
        cursor: loading ? 'wait' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        marginTop: 10, opacity: loading ? 0.7 : 1, fontFamily: 'inherit',
      }}
    >
      <AppleIcon /> {loading ? 'Conectando…' : label}
    </button>
  )
}

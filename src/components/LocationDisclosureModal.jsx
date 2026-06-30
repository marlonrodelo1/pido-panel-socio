// LocationDisclosureModal — "Prominent disclosure" obligatoria de Google Play
// para ubicación en segundo plano. Se muestra DENTRO del flujo normal de la app,
// ANTES de pedir el permiso de ubicación (lo gatea RiderContext.setOnline), y
// describe qué dato se recoge, que se usa en segundo plano y para qué.
// Requiere acción afirmativa del usuario (Activar) antes de seguir.

import { MapPin } from 'lucide-react'

export default function LocationDisclosureModal({ open, onAccept, onDecline }) {
  if (!open) return null
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(22,19,15,0.55)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        style={{
          width: '100%', maxWidth: 420, background: '#FFFFFF', borderRadius: 20,
          padding: '28px 24px', boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          fontFamily: "'Plus Jakarta Sans', 'Inter', sans-serif", color: '#16130F',
        }}
      >
        <div
          style={{
            width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px',
            background: 'rgba(255,107,44,0.14)', color: '#FF6B2C',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <MapPin size={28} strokeWidth={2.2} />
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', margin: '0 0 12px', letterSpacing: '-0.01em' }}>
          Pidoo Socio necesita tu ubicación
        </h2>
        <p style={{ fontSize: 14.5, lineHeight: 1.55, color: '#4A4640', margin: '0 0 22px', textAlign: 'center' }}>
          Para asignarte los pedidos más cercanos, Pidoo Socio recoge tu ubicación{' '}
          <b>incluso cuando la app está cerrada o en segundo plano</b>, mientras estás{' '}
          <b>En servicio</b>. Verás una notificación “Pidoo en servicio” mientras compartes tu
          ubicación. Puedes dejar de compartirla poniéndote <b>Fuera de servicio</b> cuando quieras.
        </p>
        <button
          onClick={onAccept}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
            background: '#FF6B2C', color: '#fff', fontSize: 15, fontWeight: 800,
            cursor: 'pointer', fontFamily: 'inherit', marginBottom: 10,
          }}
        >
          Activar y continuar
        </button>
        <button
          onClick={onDecline}
          style={{
            width: '100%', padding: '12px 0', borderRadius: 12, border: 'none',
            background: 'transparent', color: '#6B6356', fontSize: 14, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Ahora no
        </button>
      </div>
    </div>
  )
}

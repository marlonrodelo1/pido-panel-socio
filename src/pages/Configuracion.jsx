import { useEffect, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { colors, ds, type } from '../lib/uiStyles'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'

export default function Configuracion() {
  const { socio, updateSocio, logout } = useSocio()
  const [form, setForm] = useState({
    nombre: socio?.nombre || '',
    telefono: socio?.telefono || '',
    shipday_api_key: socio?.shipday_api_key || '',
    razon_social: socio?.razon_social || '',
    nif: socio?.nif || '',
    direccion_fiscal: socio?.direccion_fiscal || '',
    codigo_postal: socio?.codigo_postal || '',
    ciudad: socio?.ciudad || '',
    provincia: socio?.provincia || '',
    pais: socio?.pais || 'España',
    iban: socio?.iban || '',
    iva_pct: socio?.iva_pct ?? 21,
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!socio) return
    setForm({
      nombre: socio.nombre || '',
      telefono: socio.telefono || '',
      shipday_api_key: socio.shipday_api_key || '',
      razon_social: socio.razon_social || '',
      nif: socio.nif || '',
      direccion_fiscal: socio.direccion_fiscal || '',
      codigo_postal: socio.codigo_postal || '',
      ciudad: socio.ciudad || '',
      provincia: socio.provincia || '',
      pais: socio.pais || 'España',
      iban: socio.iban || '',
      iva_pct: socio.iva_pct ?? 21,
    })
  }, [socio])

  const fiscalCompleto = !!(socio?.razon_social && socio?.nif && socio?.direccion_fiscal && socio?.codigo_postal && socio?.ciudad && socio?.iban)

  const save = async () => {
    setSaving(true); setErr(null); setOk(false)
    try {
      await updateSocio({
        nombre: form.nombre,
        telefono: form.telefono || null,
        shipday_api_key: form.shipday_api_key || null,
        razon_social: form.razon_social || null,
        nif: form.nif ? form.nif.trim().toUpperCase() : null,
        direccion_fiscal: form.direccion_fiscal || null,
        codigo_postal: form.codigo_postal || null,
        ciudad: form.ciudad || null,
        provincia: form.provincia || null,
        pais: form.pais || 'España',
        iban: form.iban ? form.iban.replace(/\s+/g, '').toUpperCase() : null,
        iva_pct: form.iva_pct === '' || form.iva_pct == null ? 21 : Number(form.iva_pct),
      })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div>
      <h1 style={ds.h1}>Configuración</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 18 }}>
        Datos de cuenta y opciones del marketplace.
      </p>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Identidad de tienda</h2>
        <div style={{ fontSize: type.sm, color: colors.textDim, marginBottom: 10 }}>
          Slug: <strong style={{ color: colors.text }}>{socio?.slug}</strong> (no se puede cambiar desde aquí).
        </div>
        <div style={{ fontSize: type.sm, color: colors.textDim }}>
          Límite de restaurantes: <strong style={{ color: colors.text }}>{socio?.limite_restaurantes ?? 5}</strong> (solo editable por administración).
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Datos personales</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          <div>
            <label style={ds.label}>Nombre</label>
            <input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Teléfono</label>
            <input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })}
              placeholder="+34 600 000 000" style={ds.input} />
          </div>
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <h2 style={{ ...ds.h2, margin: 0 }}>Datos fiscales</h2>
          <span style={{
            fontSize: type.xxs, fontWeight: 700, padding: '4px 10px', borderRadius: 999,
            background: fiscalCompleto ? colors.stateOkSoft : colors.dangerSoft,
            color: fiscalCompleto ? colors.stateOk : colors.danger,
            letterSpacing: '0.04em', textTransform: 'uppercase',
          }}>
            {fiscalCompleto ? 'Completos' : 'Incompletos'}
          </span>
        </div>
        <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 14 }}>
          Estos datos aparecerán en las facturas que emitas a los restaurantes.
          Sin ellos no podrás generar facturas legales.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          <div>
            <label style={ds.label}>Razón social / nombre fiscal</label>
            <input value={form.razon_social} onChange={e => setForm({ ...form, razon_social: e.target.value })}
              placeholder="Ej. Juan Pérez García" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>NIF / DNI</label>
            <input value={form.nif} onChange={e => setForm({ ...form, nif: e.target.value })}
              placeholder="12345678Z" style={ds.input} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={ds.label}>Dirección fiscal</label>
            <input value={form.direccion_fiscal} onChange={e => setForm({ ...form, direccion_fiscal: e.target.value })}
              placeholder="Calle, número, piso" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Código postal</label>
            <input value={form.codigo_postal} onChange={e => setForm({ ...form, codigo_postal: e.target.value })}
              placeholder="38001" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Ciudad</label>
            <input value={form.ciudad} onChange={e => setForm({ ...form, ciudad: e.target.value })}
              placeholder="Santa Cruz de Tenerife" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Provincia</label>
            <input value={form.provincia} onChange={e => setForm({ ...form, provincia: e.target.value })}
              placeholder="Santa Cruz de Tenerife" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>País</label>
            <input value={form.pais} onChange={e => setForm({ ...form, pais: e.target.value })}
              placeholder="España" style={ds.input} />
          </div>
          <div style={{ gridColumn: '1/-1' }}>
            <label style={ds.label}>IBAN</label>
            <input value={form.iban} onChange={e => setForm({ ...form, iban: e.target.value })}
              placeholder="ES00 0000 0000 0000 0000 0000" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>IVA aplicable (%)</label>
            <input type="number" min="0" max="21" step="0.01"
              value={form.iva_pct}
              onChange={e => setForm({ ...form, iva_pct: e.target.value })}
              style={ds.input} />
            <p style={{ fontSize: type.xxs, color: colors.textMute, marginTop: 4 }}>
              Canarias: 0% (exento). Península: 21% (general). Consulta con tu gestor.
            </p>
          </div>
        </div>
      </div>

      <FacturacionPidooCard socio={socio} />

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Integración Shipday (rider)</h2>
        <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 10 }}>
          Si eres rider además de socio, vincula aquí tu cuenta Shipday.
        </p>
        <label style={ds.label}>API Key de Shipday</label>
        <input value={form.shipday_api_key} onChange={e => setForm({ ...form, shipday_api_key: e.target.value })}
          placeholder="Pega aquí tu API key…" style={ds.input} />
      </div>

      {err && <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>{err}</div>}
      {ok && <div style={{ background: colors.stateOkSoft, color: colors.stateOk, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>Cambios guardados.</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button onClick={save} disabled={saving} style={{ ...ds.primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
        <button onClick={logout} style={ds.dangerBtn}>Cerrar sesión</button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Mi facturación Pidoo — plan multi-rider 39€/mes
// ──────────────────────────────────────────────────────────────────────────────
function FacturacionPidooCard({ socio }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  if (!socio) return null

  const n = socio.n_riders_actual ?? 1
  const activa = !!socio.facturacion_multirider_activa
  const estado = socio.multirider_estado || 'al_dia'
  const proximoPago = socio.multirider_proximo_pago

  const fmtFecha = (iso) => {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: 'long', year: 'numeric' }) }
    catch { return '—' }
  }

  const pagarAhora = async () => {
    setBusy(true); setMsg(null)
    try {
      // Reusa la función gestionar — devolverá client_secret para confirmar
      const { data: { session } } = await supabase.auth.getSession()
      const r = await fetch(`${FUNCTIONS_URL}/gestionar-facturacion-socio-multirider`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || ''}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ socio_id: socio.id, accion: 'crear' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Error')
      if (j.client_secret) {
        setMsg('Para regularizar el pago, contacta a soporte (próximamente: Stripe Checkout integrado).')
      } else {
        setMsg('Suscripción reactivada.')
      }
    } catch (e) {
      setMsg(e.message || 'Error')
    } finally {
      setBusy(false)
    }
  }

  // Estado: impago — banner rojo
  if (activa && estado === 'impago') {
    return (
      <div style={{
        ...ds.card,
        marginBottom: 16,
        background: colors.dangerSoft || 'rgba(220,38,38,0.08)',
        borderColor: colors.danger || '#dc2626',
        borderWidth: 2,
        borderStyle: 'solid',
      }}>
        <h2 style={{ ...ds.h2, color: colors.danger || '#dc2626' }}>
          ⚠️ Suscripción multi-rider impagada
        </h2>
        <p style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.5, marginBottom: 12 }}>
          No hemos podido cobrar tu plan multi-rider de <strong>39 €/mes</strong>.
          Tu marketplace público está <strong>desactivado</strong> y no recibirás pedidos hasta que regularices el pago.
        </p>
        <p style={{ fontSize: type.xs, color: colors.textMute, marginBottom: 12 }}>
          Tienes {n} rider{n === 1 ? '' : 's'} activo{n === 1 ? '' : 's'} en tu cuenta Shipday.
        </p>
        <button
          onClick={pagarAhora}
          disabled={busy}
          style={{
            ...ds.primaryBtn,
            background: colors.danger || '#dc2626',
            borderColor: colors.danger || '#dc2626',
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? 'Procesando…' : 'Pagar ahora'}
        </button>
        {msg && <div style={{ fontSize: type.xs, color: colors.textDim, marginTop: 10 }}>{msg}</div>}
      </div>
    )
  }

  // Estado: 1 rider — informativo
  if (n <= 1 && !activa) {
    return (
      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Mi facturación Pidoo</h2>
        <p style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5 }}>
          Ahora tienes <strong style={{ color: colors.text }}>1 rider</strong> en tu cuenta Shipday → no pagas plan multi-rider a Pidoo.
        </p>
        <p style={{ fontSize: type.xs, color: colors.textMute, marginTop: 8 }}>
          Si añades 2 o más riders en Shipday, se aplicará automáticamente el plan multi-rider de <strong>39 €/mes</strong>.
        </p>
      </div>
    )
  }

  // Estado: 2+ riders, al día
  if (activa && (estado === 'al_dia' || estado === 'reintento1' || estado === 'reintento2')) {
    return (
      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Mi facturación Pidoo</h2>
        <p style={{ fontSize: type.sm, color: colors.text, lineHeight: 1.5 }}>
          Estás pagando <strong>39 €/mes</strong> por el plan multi-rider ({n} rider{n === 1 ? '' : 's'} en Shipday).
        </p>
        <div style={{
          marginTop: 10, padding: '10px 12px',
          background: colors.elev2 || colors.surfaceHover || 'rgba(0,0,0,0.04)',
          borderRadius: 8, fontSize: type.xs, color: colors.textDim,
        }}>
          Próximo cargo: <strong style={{ color: colors.text }}>{fmtFecha(proximoPago)}</strong>
        </div>
        {(estado === 'reintento1' || estado === 'reintento2') && (
          <p style={{ fontSize: type.xs, color: '#ea580c', marginTop: 8 }}>
            ⚠️ Stripe está reintentando el cobro (intento {estado === 'reintento2' ? '2' : '1'} de 3). Verifica tu método de pago.
          </p>
        )}
      </div>
    )
  }

  // Estado: 2+ riders pero aún no activa (debería sincronizarse pronto)
  if (n >= 2 && !activa) {
    return (
      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Mi facturación Pidoo</h2>
        <p style={{ fontSize: type.sm, color: colors.textDim, lineHeight: 1.5 }}>
          Tienes <strong style={{ color: colors.text }}>{n} riders</strong> en Shipday. El plan multi-rider de <strong>39 €/mes</strong> se activará en las próximas horas tras la sincronización automática.
        </p>
      </div>
    )
  }

  return null
}


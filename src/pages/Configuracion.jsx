import { useCallback, useEffect, useState, useRef } from 'react'
import { Capacitor } from '@capacitor/core'
import { CheckCircle2, CircleX, CircleQuestionMark, CreditCard } from 'lucide-react'
import { useSocio } from '../context/SocioContext'
import { supabase } from '../lib/supabase'
import { isNativeSync, getPlugin } from '../lib/capacitor'
import { colors, ds, type } from '../lib/uiStyles'
import {
  cobroMovilSoportado, configCobroMovil, requisitosTapToPay, prepararLector,
  abrirAjustesNfc, lectorPreparado,
} from '../lib/cobroMovil'
import { requestLocationPermission, openLocationSettings } from '../lib/riderGeo'

// Campos fiscales obligatorios para poder emitir facturas a los restaurantes
// (mismo criterio que el gate en Dashboard.jsx y RestauranteDetalle.jsx).
const REQUERIDOS_FISCALES = ['razon_social', 'nif', 'direccion_fiscal', 'codigo_postal', 'ciudad']

const FISCAL_INIT = (socio) => ({
  razon_social: socio?.razon_social || '',
  nif: socio?.nif || '',
  direccion_fiscal: socio?.direccion_fiscal || '',
  codigo_postal: socio?.codigo_postal || '',
  ciudad: socio?.ciudad || '',
  provincia: socio?.provincia || '',
  pais: socio?.pais || 'España',
  iban: socio?.iban || '',
})

// `enApp` = se está pintando dentro del shell de repartidor, que es lo que
// renderiza la app descargable. Ahí no se enseña nada de suscripción.
export default function Configuracion({ enApp = false }) {
  const { socio, updateSocio, logout } = useSocio()
  const [form, setForm] = useState({
    nombre: socio?.nombre || '',
    telefono: socio?.telefono || '',
    ...FISCAL_INIT(socio),
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)
  const fiscalRef = useRef(null)

  useEffect(() => {
    if (!socio) return
    setForm({
      nombre: socio.nombre || '',
      telefono: socio.telefono || '',
      ...FISCAL_INIT(socio),
    })
  }, [socio])

  const fiscalCompleto = REQUERIDOS_FISCALES.every(k => (form[k] || '').trim())

  // Si el socio llega aquí con los datos fiscales incompletos (p. ej. desde el
  // aviso "Ir a Configuración"), llevamos el scroll a la sección fiscal.
  useEffect(() => {
    if (!socio) return
    const completo = REQUERIDOS_FISCALES.every(k => (socio[k] || '').toString().trim())
    if (!completo && fiscalRef.current) {
      const t = setTimeout(() => {
        try { fiscalRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }) } catch (_) {}
      }, 250)
      return () => clearTimeout(t)
    }
  }, [socio])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
  const clean = (v) => { const t = (v || '').trim(); return t || null }

  const save = async () => {
    setSaving(true); setErr(null); setOk(false)
    try {
      await updateSocio({
        nombre: form.nombre,
        telefono: clean(form.telefono),
        razon_social: clean(form.razon_social),
        nif: clean(form.nif) ? form.nif.trim().toUpperCase() : null,
        direccion_fiscal: clean(form.direccion_fiscal),
        codigo_postal: clean(form.codigo_postal),
        ciudad: clean(form.ciudad),
        provincia: clean(form.provincia),
        pais: clean(form.pais),
        iban: clean(form.iban) ? form.iban.replace(/\s+/g, '').toUpperCase() : null,
      })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h1 style={ds.h1}>Configuración</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 22 }}>
        Datos personales y fiscales.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Mi cuenta: qué correo tiene la sesión abierta y cómo cambiar la contraseña. */}
        <MiCuentaCard />

        {/* Cobro con tarjeta (Tap to Pay): solo en la app del móvil. Dice si este móvil puede
            cobrar, qué falta y cómo se cobra. */}
        {enApp && isNativeSync() && <CobroTarjetaCard />}

        {/* Mi suscripción Pidoo — SOLO en el panel web. Dentro de la app no puede haber
            ningún camino hacia un cobro fuera del sistema de Apple/Google: es rechazo
            directo (App Store 3.1.1). Doble condición a propósito: el shell de la app
            (enApp) y la plataforma nativa. El plan se gestiona en socio.pidoo.es. */}
        {!enApp && !isNativeSync() && <SuscripcionAccesoCard />}

        {/* Datos personales */}
        <Card>
          <h2 style={{ ...ds.h2, marginBottom: 14 }}>Datos personales</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <Field label="Nombre completo">
              <input value={form.nombre} onChange={set('nombre')} style={ds.input} />
            </Field>
            <Field label="Teléfono">
              <input value={form.telefono} onChange={set('telefono')}
                placeholder="+34 600 000 000" style={ds.input} />
            </Field>
          </div>
        </Card>

        {/* Datos fiscales — necesarios para emitir facturas a los restaurantes */}
        <Card style={{ scrollMarginTop: 80 }}>
          <div ref={fiscalRef} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <h2 style={{ ...ds.h2, margin: 0 }}>Datos fiscales</h2>
            <span style={{
              padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700,
              background: fiscalCompleto ? colors.sageSoft : colors.dangerSoft,
              color: fiscalCompleto ? colors.sage2 : colors.danger,
            }}>{fiscalCompleto ? '✓ Completo' : 'Incompleto'}</span>
          </div>
          <p style={{ color: colors.textMute, fontSize: type.xs, marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
            Necesitas estos datos para poder <b>emitir facturas</b> a los restaurantes. Aparecerán como
            emisor en cada factura. El IBAN se usa para recibir tus liquidaciones semanales.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <Field label="Razón social *">
              <input value={form.razon_social} onChange={set('razon_social')}
                placeholder="Nombre fiscal o autónomo" style={ds.input} />
            </Field>
            <Field label="NIF / CIF *">
              <input value={form.nif} onChange={set('nif')}
                placeholder="12345678Z" style={ds.input} />
            </Field>
            <Field label="Dirección fiscal *" full>
              <input value={form.direccion_fiscal} onChange={set('direccion_fiscal')}
                placeholder="Calle, número, piso" style={ds.input} />
            </Field>
            <Field label="Código postal *">
              <input value={form.codigo_postal} onChange={set('codigo_postal')}
                placeholder="38001" style={ds.input} />
            </Field>
            <Field label="Ciudad *">
              <input value={form.ciudad} onChange={set('ciudad')}
                placeholder="Santa Cruz de Tenerife" style={ds.input} />
            </Field>
            <Field label="Provincia">
              <input value={form.provincia} onChange={set('provincia')}
                placeholder="Santa Cruz de Tenerife" style={ds.input} />
            </Field>
            <Field label="País">
              <input value={form.pais} onChange={set('pais')}
                placeholder="España" style={ds.input} />
            </Field>
            <Field label="IBAN (para cobros)" full>
              <input value={form.iban} onChange={set('iban')}
                placeholder="ES00 0000 0000 0000 0000 0000" style={ds.input} />
            </Field>
          </div>
          {!fiscalCompleto && (
            <div style={{
              marginTop: 12, background: colors.dangerSoft, color: colors.danger,
              padding: '10px 14px', borderRadius: 10, fontSize: type.xs, lineHeight: 1.5,
            }}>
              Los campos marcados con <b>*</b> son obligatorios para emitir facturas.
            </div>
          )}
        </Card>

        {err && (
          <div style={{
            background: colors.dangerSoft, color: colors.danger,
            padding: '10px 14px', borderRadius: 10,
            fontSize: type.xs, fontWeight: 600,
          }}>{err}</div>
        )}
        {ok && (
          <div style={{
            background: colors.sageSoft, color: colors.sage2,
            padding: '10px 14px', borderRadius: 10,
            fontSize: type.xs, fontWeight: 600,
          }}>Cambios guardados.</div>
        )}

        {/* Acciones */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={logout} style={{
            ...ds.dangerBtn,
            background: colors.dangerSoft, border: `1px solid ${colors.dangerSoft}`,
            color: colors.danger,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Cerrar sesión
          </button>
          <div style={{ flex: 1 }}/>
          <button onClick={save} disabled={saving} style={{ ...ds.glossyBtn, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>

        {/* Zona peligrosa */}
        <div style={{
          marginTop: 8, padding: 18,
          borderRadius: 14, background: colors.dangerSoft,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, color: colors.danger,
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8,
          }}>Zona peligrosa</div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{ fontSize: type.sm, color: colors.danger }}>
              Esto borrará tu cuenta y todos los datos asociados.
            </div>
            <button
              onClick={() => { try { window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'eliminar-cuenta' })) } catch (_) {} }}
              style={{ ...ds.dangerBtn, background: 'transparent' }}
            >
              Eliminar cuenta
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────── Sub-components ───────────────────────

function Card({ children, style }) {
  return <div style={{ ...ds.card, padding: 20, ...style }}>{children}</div>
}

// Mi cuenta — el socio no tenía dónde ver con qué correo ha entrado ni cómo
// cambiar su contraseña. La contraseña NO se cambia aquí a mano: se manda el
// correo de recuperación, que es el único camino que funciona igual tanto si
// entró con email como si entró con Google o Apple.
function MiCuentaCard() {
  const { user, socio } = useSocio()
  const email = user?.email || socio?.email || null
  // Con qué entró: si la cuenta solo tiene Google/Apple, no hay contraseña que cambiar
  // hasta que se cree una, y eso es exactamente lo que hace el correo de recuperación.
  const proveedores = (user?.app_metadata?.providers || []).filter(Boolean)
  const [estado, setEstado] = useState(null) // null | 'enviando' | 'enviado' | 'error'

  async function cambiarPassword() {
    if (!email) return
    setEstado('enviando')
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      setEstado(error ? 'error' : 'enviado')
    } catch (_) {
      setEstado('error')
    }
  }

  return (
    <Card>
      <h2 style={{ ...ds.h2, marginBottom: 14 }}>Mi cuenta</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={{ fontSize: type.xs, color: colors.textMute }}>Correo de acceso</div>
          <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text, wordBreak: 'break-all' }}>
            {email || '—'}
          </div>
          {proveedores.length > 0 && (
            <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
              Entras con: {proveedores.map(p => ({ email: 'correo y contraseña', google: 'Google', apple: 'Apple' }[p] || p)).join(' · ')}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={cambiarPassword}
            disabled={!email || estado === 'enviando'}
            style={{ ...ds.secondaryBtn, opacity: (!email || estado === 'enviando') ? 0.6 : 1 }}
          >
            {estado === 'enviando' ? 'Enviando…' : 'Cambiar contraseña'}
          </button>
          {estado === 'enviado' && (
            <span style={{ fontSize: type.xs, color: colors.text }}>
              Te hemos enviado un correo a {email}. Ábrelo para poner la nueva contraseña.
            </span>
          )}
          {estado === 'error' && (
            <span style={{ fontSize: type.xs, color: colors.danger }}>
              No se pudo enviar el correo. Inténtalo de nuevo en un momento.
            </span>
          )}
        </div>
      </div>
    </Card>
  )
}

// ─── Cobro con tarjeta (Tap to Pay de Stripe) ─────────────────
// El socio cobra en la puerta con la tarjeta del cliente en SU móvil (lib/cobroMovil.js).
// Esta tarjeta le dice si su móvil puede, qué le falta (casi todo se arregla en Ajustes) y cómo
// se cobra. Las comprobaciones del móvil las da el plugin nativo (tapToPayChecks); si la app no
// las trae, salen como «sin comprobar» y no se bloquea nada.
function CobroTarjetaCard() {
  let plataforma = 'web'
  try { plataforma = Capacitor.getPlatform() } catch (_) {}
  if (plataforma === 'ios') {
    return (
      <Card>
        <CabeceraCobro />
        <EstadoCobro tono="neutro" titulo="Pendiente de Apple: por ahora cobra en efectivo">
          En iPhone hace falta un permiso de Apple que todavía no tenemos. Cuando llegue, podrás
          cobrar con tarjeta desde este móvil sin hacer nada más.
        </EstadoCobro>
      </Card>
    )
  }
  if (plataforma !== 'android') return null
  return <CobroTarjetaAndroid />
}

const VERSION_ANDROID = { 33: '13', 34: '14', 35: '15', 36: '16', 37: '17' }

async function permisoUbicacion() {
  try {
    const Geo = (await getPlugin('Geolocation'))?.plugin
    if (!Geo) return null
    const p = await Geo.checkPermissions()
    return p?.location || null // 'granted' | 'prompt' | 'prompt-with-rationale' | 'denied'
  } catch (_) {
    return null
  }
}

function CobroTarjetaAndroid() {
  const soportado = cobroMovilSoportado()
  const [cfg, setCfg] = useState(null)         // null = comprobando
  const [req, setReq] = useState(undefined)    // undefined = comprobando · null = sin comprobar
  const [ubic, setUbic] = useState(undefined)
  const [lector, setLector] = useState({ estado: lectorPreparado() ? 'ok' : 'sin_probar', msg: null })

  const comprobar = useCallback(async () => {
    const [c, r, u] = await Promise.all([
      configCobroMovil().catch(() => ({ habilitado: false, metodos: [], locationId: null })),
      requisitosTapToPay().catch(() => null),
      permisoUbicacion(),
    ])
    setCfg(c)
    setReq(r)
    setUbic(u)
    if (lectorPreparado()) setLector({ estado: 'ok', msg: null })
  }, [])

  useEffect(() => { if (soportado) comprobar() }, [soportado, comprobar])

  // Al volver de Ajustes (NFC, ubicación, opciones de desarrollador) se vuelve a mirar.
  useEffect(() => {
    if (!soportado) return
    let quitado = false
    let handle = null
    ;(async () => {
      const App = (await getPlugin('App'))?.plugin
      if (!App || quitado) return
      handle = await App.addListener('appStateChange', (s) => { if (s?.isActive) comprobar() })
    })()
    return () => { quitado = true; try { handle?.remove?.() } catch (_) {} }
  }, [soportado, comprobar])

  async function prepararAhora() {
    if (!cfg?.locationId) {
      setLector({ estado: 'error', msg: 'El cobro con tarjeta no está activado para tu cuenta.' })
      return
    }
    setLector({ estado: 'preparando', msg: null })
    try {
      await prepararLector(cfg.locationId)
      setLector({ estado: 'ok', msg: null })
    } catch (e) {
      setLector({ estado: 'error', msg: e?.message || 'No se pudo preparar el lector. Inténtalo otra vez.' })
    }
  }

  async function darPermisoUbicacion() {
    if (ubic === 'denied') { await openLocationSettings(); return }
    await requestLocationPermission()
    setUbic(await permisoUbicacion())
  }

  if (!soportado) {
    return (
      <Card>
        <CabeceraCobro />
        <EstadoCobro tono="neutro" titulo="Actualiza la app para cobrar con tarjeta">
          Esta versión de Pidoo Socio no trae el cobro con tarjeta. Actualízala desde Google Play.
          Mientras tanto, cobra en efectivo.
        </EstadoCobro>
      </Card>
    )
  }

  const comprobando = cfg === null || req === undefined || ubic === undefined
  const sdk = Number(req?.androidSdk) || 0
  const versionTxt = sdk ? (VERSION_ANDROID[sdk] ? `Android ${VERSION_ANDROID[sdk]}` : `API ${sdk}`) : null
  const ubicOk = ubic === 'granted'
  const todoOk = !!(cfg?.habilitado && req?.listo && ubicOk)

  let estado
  if (comprobando) {
    estado = { tono: 'neutro', titulo: 'Comprobando tu móvil…', texto: null }
  } else if (req && !req.hardwareOk) {
    estado = { tono: 'mal', titulo: 'Este móvil no puede cobrar con tarjeta', texto: 'Hace falta un móvil con NFC y Android 13 o superior. Cobra en efectivo.' }
  } else if (!cfg?.habilitado) {
    estado = { tono: 'neutro', titulo: 'Todavía no está activado para tu cuenta', texto: 'Cuando Pidoo lo active, podrás cobrar con tarjeta desde este móvil. Mientras tanto, cobra en efectivo.' }
  } else if (todoOk && lector.estado === 'ok') {
    estado = { tono: 'ok', titulo: 'Listo para cobrar con tarjeta', texto: null }
  } else if (todoOk) {
    estado = { tono: 'ok', titulo: 'Tu móvil puede cobrar con tarjeta', texto: 'Pulsa «Preparar ahora» para dejar el lector listo antes del primer reparto.' }
  } else {
    estado = { tono: 'aviso', titulo: 'Falta algo por revisar', texto: 'Mira la lista de abajo: casi todo se arregla en los Ajustes del móvil.' }
  }

  const sinDato = req === null // la app no trae las comprobaciones del móvil
  const items = [
    { ok: cfg?.habilitado, titulo: 'Activado por Pidoo para tu cuenta' },
    { ok: sinDato ? null : req?.androidOk, titulo: 'Android 13 o superior', detalle: versionTxt ? `Tu móvil: ${versionTxt}` : null },
    { ok: sinDato ? null : req?.tieneNfc, titulo: 'El móvil tiene NFC' },
    {
      ok: sinDato ? null : req?.nfcActivado, titulo: 'NFC encendido',
      accion: !sinDato && req?.tieneNfc && !req?.nfcActivado ? { texto: 'Abrir ajustes de NFC', fn: abrirAjustesNfc } : null,
    },
    {
      ok: sinDato ? null : !req?.opcionesDesarrollador,
      titulo: 'Opciones de desarrollador apagadas',
      detalle: !sinDato && req?.opcionesDesarrollador
        ? `Apágalas en Ajustes${req?.depuracionUsb ? ' (también la depuración USB)' : ''}: con ellas encendidas no deja cobrar.`
        : null,
    },
    {
      ok: ubic == null ? null : ubicOk, titulo: 'Permiso de ubicación',
      detalle: ubicOk || ubic == null ? null : 'Stripe lo pide para cobrar con tarjeta.',
      accion: ubic != null && !ubicOk ? { texto: ubic === 'denied' ? 'Abrir ajustes' : 'Dar permiso', fn: darPermisoUbicacion } : null,
    },
    {
      ok: lector.estado === 'ok' ? true : lector.estado === 'error' ? false : null,
      titulo: 'Lector preparado',
      detalle: lector.estado === 'preparando' ? 'Preparando… la primera vez puede tardar un minuto.' : lector.msg,
      accion: lector.estado !== 'ok' && cfg?.habilitado && (!req || req.hardwareOk)
        ? { texto: lector.estado === 'preparando' ? 'Preparando…' : 'Preparar ahora', fn: prepararAhora, desactivado: lector.estado === 'preparando' }
        : null,
    },
  ]

  return (
    <Card>
      <CabeceraCobro />
      <EstadoCobro tono={estado.tono} titulo={estado.titulo}>{estado.texto}</EstadoCobro>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12 }}>
        {items.map((it) => <ItemCobro key={it.titulo} {...it} />)}
      </div>

      {req?.fabricante && (
        <div style={{ fontSize: type.xxs, color: colors.textFaint, marginTop: 8 }}>
          Móvil: {[req.fabricante, req.modelo].filter(Boolean).join(' ')}{versionTxt ? ` · ${versionTxt}` : ''}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button onClick={abrirAjustesNfc} style={{ ...ds.secondaryBtn, fontSize: type.xs }}>Abrir ajustes de NFC</button>
        <button onClick={comprobar} style={{ ...ds.secondaryBtn, fontSize: type.xs }}>Volver a comprobar</button>
      </div>

      <div style={{
        marginTop: 16, padding: '12px 14px', borderRadius: 10,
        background: colors.surface2, border: `1px solid ${colors.border}`,
      }}>
        <div style={{ fontSize: type.xs, fontWeight: 800, color: colors.text, marginBottom: 6 }}>Cómo se cobra</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: type.xs, color: colors.textDim, lineHeight: 1.55 }}>
          <li>En el pedido, pulsa «Cobrar con tarjeta». El cliente acerca su tarjeta o su móvil a la <b>parte de atrás</b> de tu teléfono y la deja quieta hasta que suene.</li>
          <li>Por encima de <b>50 €</b> el banco puede pedir el <b>PIN</b>: el cliente lo teclea en tu pantalla.</li>
          <li>Antes de cobrar, quita las <b>burbujas flotantes</b> (chats, grabadores de pantalla, filtros de luz): con ellas el PIN no funciona.</li>
          <li>Al confirmarse el cobro, el pedido queda entregado solo. Si la tarjeta falla, cobra en efectivo. Nunca cobres dos veces el mismo pedido.</li>
        </ul>
      </div>
    </Card>
  )
}

function CabeceraCobro() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: colors.terracottaSoft, color: colors.terracotta,
        display: 'grid', placeItems: 'center', flexShrink: 0,
      }}>
        <CreditCard size={18} strokeWidth={2.2} />
      </div>
      <h2 style={{ ...ds.h2, margin: 0 }}>Cobro con tarjeta</h2>
    </div>
  )
}

const TONO_COBRO = {
  ok:    { bg: colors.sageSoft,    fg: colors.sage2 },
  aviso: { bg: colors.warningSoft, fg: '#8B6126' },
  mal:   { bg: colors.dangerSoft,  fg: colors.danger },
  neutro: { bg: colors.surface2,   fg: colors.textDim },
}

function EstadoCobro({ tono, titulo, children }) {
  const t = TONO_COBRO[tono] || TONO_COBRO.neutro
  return (
    <div style={{ padding: '10px 12px', borderRadius: 10, background: t.bg, color: t.fg }}>
      <div style={{ fontSize: type.sm, fontWeight: 800 }}>{titulo}</div>
      {children && <div style={{ fontSize: type.xs, fontWeight: 600, marginTop: 3, lineHeight: 1.45 }}>{children}</div>}
    </div>
  )
}

// Una línea de la lista de comprobación: ok = true (bien) · false (falta) · null (sin comprobar).
function ItemCobro({ ok, titulo, detalle, accion }) {
  const Icono = ok === true ? CheckCircle2 : ok === false ? CircleX : CircleQuestionMark
  const color = ok === true ? colors.sage2 : ok === false ? colors.danger : colors.textFaint
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderTop: `1px solid ${colors.border}` }}>
      <Icono size={18} strokeWidth={2.4} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: type.sm, fontWeight: 700, color: colors.text }}>{titulo}</div>
        {detalle && <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2, lineHeight: 1.4 }}>{detalle}</div>}
      </div>
      {accion && (
        <button
          onClick={accion.fn}
          disabled={!!accion.desactivado}
          style={{ ...ds.secondaryBtn, fontSize: type.xs, padding: '6px 10px', whiteSpace: 'nowrap', opacity: accion.desactivado ? 0.6 : 1 }}
        >{accion.texto}</button>
      )}
    </div>
  )
}

// Acceso a la página de suscripción. En desktop existe en el menú lateral,
// pero en móvil (BottomNav) no hay entrada → este botón da acceso desde Ajustes.
function SuscripcionAccesoCard() {
  const irASuscripcion = () => {
    try { window.dispatchEvent(new CustomEvent('pidoo:goto', { detail: 'suscripcion' })) } catch (_) {}
  }
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 11,
          background: colors.terracottaSoft, color: colors.terracotta,
          display: 'grid', placeItems: 'center', flexShrink: 0,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...ds.h2, margin: 0 }}>Mi suscripción</div>
          <div style={{ fontSize: type.xs, color: colors.textMute, marginTop: 2 }}>
            Tu plan Pidoo para tener tu marketplace público.
          </div>
        </div>
        <button onClick={irASuscripcion} style={{ ...ds.secondaryBtn, whiteSpace: 'nowrap' }}>
          Ver suscripción
        </button>
      </div>
    </Card>
  )
}

function Field({ label, children, full }) {
  return (
    <div style={full ? { gridColumn: '1 / -1' } : undefined}>
      <label style={ds.label}>{label}</label>
      {children}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useSocio } from '../context/SocioContext'
import { supabase, FUNCTIONS_URL } from '../lib/supabase'
import { colors, ds, type } from '../lib/uiStyles'
import { getPlugin, isNativePlatform } from '../lib/capacitor'

export default function MiMarketplace() {
  const { socio, updateSocio, refreshSocio } = useSocio()
  const logoInputRef = useRef(null)
  const bannerInputRef = useRef(null)
  const [uploading, setUploading] = useState(null)
  const [restaurantes, setRestaurantes] = useState([])
  const [loadingRest, setLoadingRest] = useState(false)
  const [form, setForm] = useState({
    nombre_comercial: socio?.nombre_comercial || '',
    descripcion: socio?.descripcion || '',
    logo_url: socio?.logo_url || '',
    banner_url: socio?.banner_url || '',
    color_primario: socio?.color_primario || '#C5562C',
    instagram: socio?.redes?.instagram || '',
    tiktok: socio?.redes?.tiktok || '',
    web: socio?.redes?.web || '',
    radio_marketplace_km: socio?.radio_marketplace_km ?? 15,
  })
  const [saving, setSaving] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState(null)
  const [copiado, setCopiado] = useState(false)
  const [slugInput, setSlugInput] = useState('')
  const [slugStatus, setSlugStatus] = useState('idle') // idle|short|checking|ok|taken|invalid
  const [creandoTienda, setCreandoTienda] = useState(false)

  useEffect(() => {
    if (!socio) return
    setForm({
      nombre_comercial: socio.nombre_comercial || '',
      descripcion: socio.descripcion || '',
      logo_url: socio.logo_url || '',
      banner_url: socio.banner_url || '',
      color_primario: socio.color_primario || '#C5562C',
      instagram: socio.redes?.instagram || '',
      tiktok: socio.redes?.tiktok || '',
      web: socio.redes?.web || '',
      radio_marketplace_km: socio.radio_marketplace_km ?? 15,
    })
  }, [socio])

  const url = socio?.slug ? `https://pidoo.es/s/${socio.slug}` : null

  const slugify = (s) => String(s || '').toLowerCase().trim()
    .replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

  // Prefill del slug desde el nombre comercial/nombre la primera vez (solo si aún no hay tienda).
  useEffect(() => {
    if (socio && !socio.slug && !slugInput) {
      const base = slugify(socio.nombre_comercial || socio.nombre || '')
      if (base) setSlugInput(base)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socio])

  // Comprobación de disponibilidad del slug en vivo (debounce 450ms) vía reserve-socio-slug.
  useEffect(() => {
    if (socio?.slug) return
    const clean = slugify(slugInput)
    if (clean.length === 0) { setSlugStatus('idle'); return }
    if (clean.length < 3) { setSlugStatus('short'); return }
    setSlugStatus('checking')
    let cancel = false
    const t = setTimeout(async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const res = await fetch(`${FUNCTIONS_URL}/reserve-socio-slug`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
          body: JSON.stringify({ slug: clean, check_only: true }),
        })
        const j = await res.json().catch(() => ({}))
        if (cancel) return
        if (res.ok && j.disponible) setSlugStatus('ok')
        else if (j.disponible === false) setSlugStatus('taken')
        else setSlugStatus('invalid')
      } catch { if (!cancel) setSlugStatus('invalid') }
    }, 450)
    return () => { cancel = true; clearTimeout(t) }
  }, [slugInput, socio?.slug])

  const loadRestaurantes = async () => {
    if (!socio?.id) return
    setLoadingRest(true)
    try {
      const { data } = await supabase
        .from('socio_establecimiento')
        .select('id, destacado, orden_destacado, establecimiento:establecimientos(id, nombre, logo_url, activo)')
        .eq('socio_id', socio.id)
        .eq('estado', 'activa')
        .order('orden_destacado', { ascending: true, nullsFirst: false })
      setRestaurantes(data || [])
    } catch (e) { console.error(e) }
    setLoadingRest(false)
  }

  useEffect(() => { loadRestaurantes() }, [socio?.id])

  const toggleDestacado = async (link) => {
    const siguiente = !link.destacado
    let orden = link.orden_destacado
    if (siguiente && (orden == null || orden < 0)) {
      const maxOrden = restaurantes
        .filter(r => r.destacado)
        .reduce((m, r) => Math.max(m, r.orden_destacado ?? 0), 0)
      orden = maxOrden + 1
    }
    const { error } = await supabase
      .from('socio_establecimiento')
      .update({ destacado: siguiente, orden_destacado: orden })
      .eq('id', link.id)
    if (error) { alert(error.message); return }
    await loadRestaurantes()
  }

  const moverOrden = async (link, delta) => {
    const destacados = restaurantes.filter(r => r.destacado)
      .sort((a, b) => (a.orden_destacado ?? 0) - (b.orden_destacado ?? 0))
    const idx = destacados.findIndex(r => r.id === link.id)
    const nuevoIdx = idx + delta
    if (idx < 0 || nuevoIdx < 0 || nuevoIdx >= destacados.length) return
    const otro = destacados[nuevoIdx]
    const ordenA = link.orden_destacado ?? idx + 1
    const ordenB = otro.orden_destacado ?? nuevoIdx + 1
    await supabase.from('socio_establecimiento').update({ orden_destacado: ordenB }).eq('id', link.id)
    await supabase.from('socio_establecimiento').update({ orden_destacado: ordenA }).eq('id', otro.id)
    await loadRestaurantes()
  }

  // Abre la tienda pública en una pestaña EXTERNA del navegador.
  // En nativo usa Capacitor Browser.open (o window.open '_system' como fallback);
  // en web abre una pestaña nueva con '_blank'.
  const openTienda = async () => {
    if (!url) return
    try {
      if (await isNativePlatform()) {
        const Browser = (await getPlugin('Browser'))?.plugin
        if (Browser) { await Browser.open({ url }); return }
        window.open(url, '_system')
        return
      }
    } catch (_) {}
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // Copia la URL pública con fallback robusto + feedback visual.
  // 1) Capacitor Clipboard (nativo) → 2) navigator.clipboard → 3) textarea + execCommand.
  const copiarUrl = async () => {
    if (!url) return
    let copied = false
    try {
      const Clip = (await getPlugin('Clipboard'))?.plugin
      if (Clip) { await Clip.write({ string: url }); copied = true }
    } catch (_) {}
    if (!copied) {
      try {
        await navigator.clipboard?.writeText(url)
        copied = true
      } catch (_) {}
    }
    if (!copied) {
      try {
        const ta = document.createElement('textarea')
        ta.value = url
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        copied = document.execCommand('copy')
        document.body.removeChild(ta)
      } catch (_) {}
    }
    if (copied) {
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1500)
    }
  }

  const uploadImage = async (file, kind) => {
    if (!file || !socio?.user_id) return
    setUploading(kind); setErr(null)
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${socio.user_id}/${kind}-${Date.now()}.${ext}`
      // Storage no valida el JWT ES256 → subimos vía edge function (service_role).
      const { data: { session } } = await supabase.auth.getSession()
      const fd = new FormData()
      fd.append('path', path)
      fd.append('file', file)
      const res = await fetch(`${FUNCTIONS_URL}/subir-imagen-socio`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        body: fd,
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'No se pudo subir la imagen')
      const publicUrl = j.publicUrl
      setForm(f => ({ ...f, [kind === 'logo' ? 'logo_url' : 'banner_url']: publicUrl }))
      await updateSocio({ [kind === 'logo' ? 'logo_url' : 'banner_url']: publicUrl })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) {
      setErr(`Error subiendo ${kind}: ${e.message}`)
    } finally {
      setUploading(null)
    }
  }

  const save = async () => {
    setSaving(true); setErr(null); setOk(false)
    try {
      const radioParsed = parseFloat(form.radio_marketplace_km)
      const radioFinal = Number.isFinite(radioParsed) && radioParsed > 0
        ? Math.min(Math.max(radioParsed, 1), 100)
        : 15
      await updateSocio({
        nombre_comercial: form.nombre_comercial,
        descripcion: form.descripcion,
        logo_url: form.logo_url || null,
        banner_url: form.banner_url || null,
        color_primario: form.color_primario,
        radio_marketplace_km: radioFinal,
        redes: {
          instagram: form.instagram || null,
          tiktok: form.tiktok || null,
          web: form.web || null,
        },
      })
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  const toggleActivo = async () => {
    try {
      await updateSocio({ marketplace_activo: !socio.marketplace_activo })
    } catch (e) { alert(e.message) }
  }

  // Crea la tienda pública: reserva el slug (reserve-socio-slug escribe socios.slug),
  // guarda el nombre comercial y activa el marketplace. updateSocio refresca el socio
  // local (que ya incluye el slug recién escrito) y la UI cambia al modo completo.
  const crearTienda = async () => {
    const clean = slugify(slugInput)
    if (clean.length < 3 || slugStatus !== 'ok') return
    setCreandoTienda(true); setErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${FUNCTIONS_URL}/reserve-socio-slug`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ slug: clean }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.ok) throw new Error(j.error || 'No se pudo crear la tienda')
      const cambios = { marketplace_activo: true }
      if (form.nombre_comercial?.trim()) cambios.nombre_comercial = form.nombre_comercial.trim()
      await updateSocio(cambios)
      await refreshSocio()
      setOk(true); setTimeout(() => setOk(false), 2500)
    } catch (e) {
      setErr(e.message || 'No se pudo crear la tienda')
    } finally {
      setCreandoTienda(false)
    }
  }

  const slugMsg = {
    idle: '', short: 'Mínimo 3 caracteres',
    checking: 'Comprobando disponibilidad…',
    ok: `Disponible: pidoo.es/s/${slugify(slugInput)}`,
    taken: 'No disponible, prueba con otra',
    invalid: 'Dirección no válida',
  }[slugStatus] || ''
  const slugMsgColor = slugStatus === 'ok' ? (colors.stateOk || colors.sage2)
    : slugStatus === 'checking' ? colors.textMute
    : colors.danger

  return (
    <div>
      <h1 style={ds.h1}>Mi marketplace</h1>
      <p style={{ color: colors.textMute, fontSize: type.sm, marginTop: 4, marginBottom: 20 }}>
        Así verán tus clientes tu tienda pública.
      </p>

      {!socio?.slug ? (
        <div style={{ ...ds.card, marginBottom: 16 }}>
          <h2 style={ds.h2}>Crea tu tienda pública</h2>
          <p style={{ fontSize: type.sm, color: colors.textMute, marginTop: 4, marginBottom: 16 }}>
            Elige el nombre y la dirección web de tu marketplace. Tus clientes pedirán desde ahí.
          </p>
          <label style={ds.label}>Nombre comercial</label>
          <input value={form.nombre_comercial}
            onChange={e => setForm({ ...form, nombre_comercial: e.target.value })}
            placeholder="Ej: Agora Express" style={{ ...ds.input, marginBottom: 14 }} />
          <label style={ds.label}>Dirección de tu tienda</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: colors.surface2, border: `1px solid ${colors.border}`, borderRadius: 10, padding: '0 12px' }}>
            <span style={{ fontSize: type.sm, color: colors.textMute, whiteSpace: 'nowrap' }}>pidoo.es/s/</span>
            <input value={slugInput} onChange={e => setSlugInput(e.target.value)}
              placeholder="tu-marca" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              style={{ ...ds.input, border: 'none', background: 'transparent', padding: '12px 0', flex: 1 }} />
          </div>
          {slugMsg && (
            <div style={{ fontSize: 12, marginTop: 6, fontWeight: 600, color: slugMsgColor }}>{slugMsg}</div>
          )}
          {err && <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '10px 12px', borderRadius: 8, marginTop: 12, fontSize: type.xs }}>{err}</div>}
          <button onClick={crearTienda} disabled={slugStatus !== 'ok' || creandoTienda}
            style={{ ...ds.primaryBtn, marginTop: 14, opacity: (slugStatus === 'ok' && !creandoTienda) ? 1 : 0.55 }}>
            {creandoTienda ? 'Creando…' : 'Crear mi tienda'}
          </button>
        </div>
      ) : (
        <div style={{ ...ds.card, marginBottom: 16 }}>
          <div style={{ fontSize: type.xxs, fontWeight: 700, color: colors.textMute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>URL pública</div>
          <div style={{ fontSize: type.base, fontWeight: 600, color: colors.text, marginTop: 2, wordBreak: 'break-all' }}>{url}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button onClick={copiarUrl} style={{ ...ds.secondaryBtn, flex: '1 1 auto', whiteSpace: 'nowrap' }}>{copiado ? 'Copiado ✓' : 'Copiar'}</button>
            <button onClick={openTienda} style={{ ...ds.secondaryBtn, flex: '1 1 auto', whiteSpace: 'nowrap' }}>Ver tienda ↗</button>
            <button onClick={toggleActivo}
              style={{ ...(socio?.marketplace_activo ? ds.dangerBtn : ds.primaryBtn), flex: '1 1 auto', whiteSpace: 'nowrap' }}>
              {socio?.marketplace_activo ? 'Desactivar' : 'Activar tienda'}
            </button>
          </div>
        </div>
      )}

      {socio?.slug && (<>
      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Branding</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
          <div>
            <label style={ds.label}>Nombre comercial</label>
            <input value={form.nombre_comercial} onChange={e => setForm({ ...form, nombre_comercial: e.target.value })} style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Radio del marketplace (km)</label>
            <input type="number" min={1} max={100} step={1}
              value={form.radio_marketplace_km}
              onChange={e => setForm({ ...form, radio_marketplace_km: e.target.value })}
              style={ds.input} />
            <div style={{ fontSize: 11, color: colors.textMute, marginTop: 4 }}>
              Distancia máxima desde el cliente para mostrar tus restaurantes en {socio?.slug ? `pidoo.es/s/${socio.slug}` : 'tu marketplace'}.
            </div>
          </div>
          <div>
            <label style={ds.label}>Color primario</label>
            <input type="color" value={form.color_primario} onChange={e => setForm({ ...form, color_primario: e.target.value })}
              style={{ ...ds.input, padding: 4, cursor: 'pointer' }} />
          </div>
          <div>
            <label style={ds.label}>Logo</label>
            <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
              onChange={e => uploadImage(e.target.files?.[0], 'logo')} />
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {form.logo_url ? (
                <img src={form.logo_url} alt="logo" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', border: `1px solid ${colors.border}` }} />
              ) : (
                <div style={{ width: 52, height: 52, borderRadius: 12, background: colors.surface2, border: `1px dashed ${colors.border}`, display: 'grid', placeItems: 'center', color: colors.textMute, fontSize: 10 }}>Sin logo</div>
              )}
              <button type="button" onClick={() => logoInputRef.current?.click()} disabled={uploading === 'logo'} style={{ ...ds.secondaryBtn, opacity: uploading === 'logo' ? 0.6 : 1 }}>
                {uploading === 'logo' ? 'Subiendo…' : (form.logo_url ? 'Cambiar logo' : 'Subir logo')}
              </button>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={ds.label}>Descripción</label>
          <textarea value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })}
            rows={3} style={{ ...ds.input, height: 'auto', padding: '10px 12px', fontFamily: 'inherit', resize: 'vertical' }} />
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Redes sociales</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
          <div>
            <label style={ds.label}>Instagram</label>
            <input value={form.instagram} onChange={e => setForm({ ...form, instagram: e.target.value })} placeholder="@usuario" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>TikTok</label>
            <input value={form.tiktok} onChange={e => setForm({ ...form, tiktok: e.target.value })} placeholder="@usuario" style={ds.input} />
          </div>
          <div>
            <label style={ds.label}>Web</label>
            <input value={form.web} onChange={e => setForm({ ...form, web: e.target.value })} placeholder="https://…" style={ds.input} />
          </div>
        </div>
      </div>

      <div style={{ ...ds.card, marginBottom: 16 }}>
        <h2 style={ds.h2}>Restaurantes destacados</h2>
        <p style={{ fontSize: type.xs, color: colors.textMute, marginTop: 0, marginBottom: 14 }}>
          Los restaurantes destacados aparecen primero en tu marketplace. Usa las flechas para reordenarlos.
        </p>
        {loadingRest ? (
          <div style={{ color: colors.textMute, fontSize: type.sm }}>Cargando…</div>
        ) : restaurantes.length === 0 ? (
          <div style={{ fontSize: type.sm, color: colors.textMute }}>
            Aún no tienes restaurantes activos. Ve a “Restaurantes” para vincular alguno.
          </div>
        ) : (
          <div>
            {restaurantes.map((link, idx) => {
              const e = link.establecimiento || {}
              const destacados = restaurantes.filter(r => r.destacado)
                .sort((a, b) => (a.orden_destacado ?? 0) - (b.orden_destacado ?? 0))
              const dIdx = destacados.findIndex(r => r.id === link.id)
              return (
                <div key={link.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0',
                  borderTop: idx === 0 ? 'none' : `1px solid ${colors.border}`,
                  flexWrap: 'wrap',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 8, flexShrink: 0,
                    background: e.logo_url ? `url(${e.logo_url}) center/cover` : colors.surface2,
                    border: `1px solid ${colors.border}`,
                  }} />
                  <div style={{ flex: '1 1 130px', minWidth: 0 }}>
                    <div style={{ fontSize: type.sm, color: colors.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.nombre || '—'}
                    </div>
                    {link.destacado && (
                      <div style={{ fontSize: type.xxs, color: colors.textMute }}>
                        Destacado · posición {dIdx + 1}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
                    {link.destacado && (
                      <>
                        <button onClick={() => moverOrden(link, -1)} disabled={dIdx <= 0}
                          style={{ ...ds.secondaryBtn, width: 32, height: 32, padding: 0, opacity: dIdx <= 0 ? 0.4 : 1 }} aria-label="Subir">↑</button>
                        <button onClick={() => moverOrden(link, 1)} disabled={dIdx >= destacados.length - 1}
                          style={{ ...ds.secondaryBtn, width: 32, height: 32, padding: 0, opacity: dIdx >= destacados.length - 1 ? 0.4 : 1 }} aria-label="Bajar">↓</button>
                      </>
                    )}
                    <button onClick={() => toggleDestacado(link)}
                      style={{ ...(link.destacado ? ds.primaryBtn : ds.secondaryBtn), whiteSpace: 'nowrap' }}>
                      {link.destacado ? '★ Destacado' : '☆ Destacar'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {err && <div style={{ background: colors.dangerSoft, color: colors.danger, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>{err}</div>}
      {ok && <div style={{ background: colors.stateOkSoft, color: colors.stateOk, padding: '10px 12px', borderRadius: 8, marginBottom: 10, fontSize: type.xs }}>Cambios guardados.</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={save} disabled={saving} style={{ ...ds.primaryBtn, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
      </>)}
    </div>
  )
}

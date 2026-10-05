// Estilos compartidos panel-socio
// Design system: Plus Jakarta Sans + paleta cream/terracotta/sage
// Pivote SaaS — paleta artesanal cálida (mayo 2026)
//
// API: mantenemos nombres de tokens existentes (colors.bg, colors.primary, etc.)
// para no romper imports. Solo cambian los valores hex.
//
// 5-oct-2026 — MODO OSCURO. Dos paletas (CLARO / OSCURO) con los MISMOS nombres de token.
// El tema se decide UNA vez al arrancar (preferencia guardada + lo que diga el móvil) y
// `colors` se llena con los hex de esa paleta. Se usan hex y no var(--…) a propósito: hay
// colores que van a sitios donde una variable CSS no vale (atributos stroke/fill de los
// iconos en el WebView de iPhone, canvas de los marcadores, Google Maps, la barra de estado
// nativa). Cambiar de tema = guardar la preferencia y recargar la app (cambiarTema).
// En oscuro `ink`/`text` pasan a ser CLAROS y `cream`/`paper` OSCUROS: los botones
// "tinta + texto crema" se invierten solos. Nunca pongas '#fff' de texto sobre colors.ink.
// La misma lógica (clave y media query) está duplicada en index.html para pintar el fondo
// correcto antes de que cargue React: si se cambia aquí, cambiarla allí.

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"

export const CLAVE_TEMA = 'pidoo_socio_tema' // 'auto' | 'claro' | 'oscuro'

export function preferenciaTema() {
  try {
    const v = window.localStorage.getItem(CLAVE_TEMA)
    return v === 'claro' || v === 'oscuro' ? v : 'auto'
  } catch (_) { return 'auto' }
}
function sistemaOscuro() {
  try { return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches } catch (_) { return false }
}
export function temaEfectivo(pref = preferenciaTema()) {
  return pref === 'auto' ? (sistemaOscuro() ? 'oscuro' : 'claro') : pref
}
// Tema con el que arrancó esta carga de la app. No cambia sin recargar.
export const TEMA = temaEfectivo()
export const esOscuro = TEMA === 'oscuro'

// Guarda la preferencia y, si cambia el tema que se ve, recarga para repintar todo.
export function cambiarTema(pref) {
  try { window.localStorage.setItem(CLAVE_TEMA, pref) } catch (_) {}
  if (temaEfectivo(pref) !== TEMA) window.location.reload()
}

// En "Automático": si el móvil cambió a claro/oscuro mientras la app estaba en segundo
// plano, al volver se recarga con el tema nuevo. Nunca recarga con la app delante (el
// socio podría estar cobrando o aceptando un pedido).
export function vigilarTemaDelMovil() {
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && preferenciaTema() === 'auto' && temaEfectivo() !== TEMA) {
        window.location.reload()
      }
    })
  } catch (_) {}
}

const CLARO = {
  // === Bases (cream world) ===
  cream:    '#F7F3EC',
  cream2:   '#EFE9DD',
  paper:    '#FBF8F2',

  // === Tinta ===
  ink:      '#1A1815',
  ink2:     '#2B2823',
  stone:    '#6B6356',
  stone2:   '#8A8174',

  // === Acentos ===
  terracotta:      '#C5562C',
  terracotta2:     '#A8451F',
  terracottaSoft:  '#F1D9CC',

  sage:      '#8B9D7A',
  sage2:     '#6F8460',
  sageSoft:  '#DDE3D3',

  // === Funcionales ===
  info:        '#7B8FA8',
  infoSoft:    '#DBE0E8',
  danger:      '#B5564A',
  dangerSoft:  '#F1D0CB',
  warning:     '#C99551',
  warningSoft: '#F0E1C8',

  // === Compatibilidad hacia atrás ===
  bg:           '#F7F3EC',
  surface:      '#FBF8F2',
  surface2:     '#EFE9DD',
  elev:         '#FBF8F2',
  elev2:        '#EFE9DD',
  border:       '#E8E1D3',
  borderStrong: '#D8CDB8',

  text:      '#1A1815',
  textDim:   '#2B2823',
  textMute:  '#6B6356',
  textFaint: '#8A8174',

  primary:       '#C5562C',
  primaryDark:   '#A8451F',
  primarySoft:   '#F1D9CC',
  primaryBorder: 'rgba(197,86,44,0.32)',

  stateNew:        '#B5564A',
  stateNewSoft:    '#F1D0CB',
  statePrep:       '#C99551',
  statePrepSoft:   '#F0E1C8',
  stateOk:         '#8B9D7A',
  stateOkSoft:     '#DDE3D3',
  stateNeutral:    '#6B6356',
  stateNeutralSoft:'#EFE9DD',

  dangerText: '#A8451F',

  shadow:   '0 1px 3px rgba(26,24,21,0.05), 0 1px 1px rgba(26,24,21,0.03)',
  shadowMd: '0 4px 12px rgba(26,24,21,0.06), 0 1px 3px rgba(26,24,21,0.04)',
  shadowLg: '0 14px 40px rgba(26,24,21,0.10), 0 4px 12px rgba(26,24,21,0.06)',
  shadowGlossy: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 2px rgba(26,24,21,0.20)',

  // === 5-oct-2026: tonos que estaban escritos a mano en las pantallas ===
  warningInk:    '#8B6126', // texto marrón sobre warningSoft (avisos)
  warningStrong: '#B0763B', // "Pausado" / "En pausa"
  errorBg:       '#FDE8E4', // banner de error de red
  errorInk:      '#9B3412',
  whatsappBg:    '#DCF8C6',
  whatsappInk:   '#128C2E',
  terracottaDeep: '#A8451F', // extremo oscuro de los degradados de botón (texto blanco encima)
}

// Misma familia cálida en oscuro: fondo marrón casi negro (no negro puro), tinta crema,
// terracota algo más viva para que se lea sobre fondo oscuro sin perder el texto blanco
// de los botones.
const OSCURO = {
  cream:    '#14120F',
  cream2:   '#221F1A',
  paper:    '#1C1915',

  ink:      '#F3EDE3',
  ink2:     '#DCD4C7',
  stone:    '#A89F91',
  stone2:   '#857C70',

  terracotta:      '#D46A40',
  terracotta2:     '#EE9670',
  terracottaSoft:  '#3B241A',

  sage:      '#9AAE88',
  sage2:     '#B5C7A3',
  sageSoft:  '#232A1E',

  info:        '#98ABC4',
  infoSoft:    '#1E2531',
  danger:      '#E2806F',
  dangerSoft:  '#3B201C',
  warning:     '#DDAA63',
  warningSoft: '#33291A',

  bg:           '#14120F',
  surface:      '#1C1915',
  surface2:     '#221F1A',
  elev:         '#1C1915',
  elev2:        '#221F1A',
  border:       '#2F2B25',
  borderStrong: '#423C33',

  text:      '#F3EDE3',
  textDim:   '#DCD4C7',
  textMute:  '#A89F91',
  textFaint: '#857C70',

  primary:       '#D46A40',
  primaryDark:   '#EE9670',
  primarySoft:   '#3B241A',
  primaryBorder: 'rgba(212,106,64,0.40)',

  stateNew:        '#E2806F',
  stateNewSoft:    '#3B201C',
  statePrep:       '#DDAA63',
  statePrepSoft:   '#33291A',
  stateOk:         '#9AAE88',
  stateOkSoft:     '#232A1E',
  stateNeutral:    '#A89F91',
  stateNeutralSoft:'#26231E',

  dangerText: '#EE9670',

  shadow:   '0 1px 3px rgba(0,0,0,0.35), 0 1px 1px rgba(0,0,0,0.25)',
  shadowMd: '0 4px 12px rgba(0,0,0,0.40), 0 1px 3px rgba(0,0,0,0.30)',
  shadowLg: '0 14px 40px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.35)',
  shadowGlossy: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 2px rgba(0,0,0,0.50)',

  warningInk:    '#E7BF85',
  warningStrong: '#E0AE6E',
  errorBg:       '#3B201C',
  errorInk:      '#F2A48F',
  whatsappBg:    '#1D3324',
  whatsappInk:   '#7CD596',
  terracottaDeep: '#A9502B',
}

export const colors = { ...(esOscuro ? OSCURO : CLARO) }

// index.css y index.html leen data-theme (fondo del body, variables --c-*).
try {
  document.documentElement.setAttribute('data-theme', esOscuro ? 'dark' : 'light')
  document.documentElement.style.colorScheme = esOscuro ? 'dark' : 'light'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.cream)
} catch (_) {}

export const type = {
  xxs: 11, xs: 12, sm: 13, base: 15, lg: 18, xl: 22,
  family: FONT,
  mono: 'ui-monospace, SFMono-Regular, "JetBrains Mono", monospace',
}

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, full: 999 }

export const ds = {
  card: {
    background: colors.paper, borderRadius: radius.md, padding: '16px 18px',
    border: `1px solid ${colors.border}`, boxShadow: colors.shadow,
  },
  input: {
    padding: '0 12px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`, fontSize: type.sm, fontFamily: FONT,
    width: '100%', outline: 'none', background: colors.paper,
    color: colors.text, boxSizing: 'border-box',
  },
  label: {
    fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
    marginBottom: 6, display: 'block',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  primaryBtn: {
    padding: '0 16px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.primary}`,
    background: colors.primary, color: colors.cream,
    fontSize: type.sm, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  // CTA glossy ink — botón hero del nuevo sistema
  glossyBtn: {
    padding: '0 18px', height: 42, borderRadius: radius.sm,
    background: `linear-gradient(180deg, ${colors.ink2} 0%, ${colors.ink} 100%)`,
    color: colors.cream, border: `1px solid ${esOscuro ? colors.ink2 : '#000'}`,
    boxShadow: colors.shadowGlossy,
    fontSize: type.sm, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  secondaryBtn: {
    padding: '0 16px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.border}`,
    background: colors.paper, color: colors.text,
    fontSize: type.sm, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  dangerBtn: {
    padding: '0 16px', height: 38, borderRadius: radius.sm,
    border: `1px solid ${colors.danger}`,
    background: colors.paper, color: colors.danger,
    fontSize: type.sm, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
  },
  h1: { fontSize: type.xl, fontWeight: 700, color: colors.text, letterSpacing: '-0.02em', fontFamily: FONT },
  h2: { fontSize: type.lg, fontWeight: 700, color: colors.text, marginBottom: 12, letterSpacing: '-0.015em', fontFamily: FONT },
  muted: { color: colors.textMute, fontSize: type.xs },
  dim: { color: colors.textDim, fontSize: type.sm },
  badge: {
    fontSize: type.xxs, fontWeight: 700, padding: '3px 8px', borderRadius: 6,
    letterSpacing: '0.04em', textTransform: 'uppercase',
    background: colors.surface2, color: colors.textDim,
    border: `1px solid ${colors.border}`,
    display: 'inline-flex', alignItems: 'center', gap: 5,
  },
}

export function stateBadge(estado) {
  const map = {
    pendiente: { bg: colors.statePrepSoft, color: colors.statePrep, label: 'Pendiente' },
    activa:    { bg: colors.stateOkSoft,   color: colors.stateOk,   label: 'Activa' },
    rechazada: { bg: colors.dangerSoft,    color: colors.danger,    label: 'Rechazada' },
    nuevo:     { bg: colors.stateNewSoft,  color: colors.stateNew,  label: 'Nuevo' },
    en_camino: { bg: colors.infoSoft,      color: colors.info,      label: 'En camino' },
    entregado: { bg: colors.stateNeutralSoft, color: colors.stateNeutral, label: 'Entregado' },
    cancelado: { bg: colors.stateNeutralSoft, color: colors.stateNeutral, label: 'Cancelado' },
  }
  const s = map[estado] || { bg: colors.stateNeutralSoft, color: colors.stateNeutral, label: estado || '—' }
  return {
    display: 'inline-flex', alignItems: 'center',
    background: s.bg, color: s.color,
    fontSize: type.xxs, fontWeight: 700,
    padding: '3px 8px', borderRadius: 6,
    letterSpacing: '0.04em', textTransform: 'uppercase',
    _label: s.label,
  }
}

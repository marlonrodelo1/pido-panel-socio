// Estilos compartidos panel-socio
// Design system: Plus Jakarta Sans + paleta cream/terracotta/sage
// Pivote SaaS — paleta artesanal cálida (mayo 2026)
//
// API: mantenemos nombres de tokens existentes (colors.bg, colors.primary, etc.)
// para no romper imports. Solo cambian los valores hex.

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif"

export const colors = {
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
}

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
    color: colors.cream, border: '1px solid #000',
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

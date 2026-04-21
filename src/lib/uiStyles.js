// Estilos compartidos panel-socio
// Misma paleta que panel-restaurante (Inter + naranja Pidoo #FF6B2C, light tipo Claude)

export const colors = {
  bg: '#FAFAF7',
  surface: '#FFFFFF',
  surface2: '#F4F2EC',
  elev: '#FFFFFF',
  elev2: '#F8F6F1',
  border: '#E8E6E0',
  borderStrong: '#D4D2CC',

  text: '#1F1F1E',
  textDim: '#3D3D3B',
  textMute: '#6B6B68',
  textFaint: '#A8A6A0',

  primary: '#FF6B2C',
  primaryDark: '#E85A1F',
  primarySoft: 'rgba(255,107,44,0.10)',
  primaryBorder: 'rgba(255,107,44,0.32)',

  stateNew: '#DC2626',
  stateNewSoft: 'rgba(220,38,38,0.10)',
  statePrep: '#D97706',
  statePrepSoft: 'rgba(217,119,6,0.12)',
  stateOk: '#16A34A',
  stateOkSoft: 'rgba(22,163,74,0.10)',
  stateNeutral: '#6B6B68',
  stateNeutralSoft: 'rgba(107,107,104,0.10)',

  danger: '#DC2626',
  dangerSoft: 'rgba(220,38,38,0.10)',
  info: '#2563EB',
  infoSoft: 'rgba(37,99,235,0.10)',

  shadow: '0 1px 2px rgba(15,15,15,0.04), 0 1px 3px rgba(15,15,15,0.06)',
  shadowMd: '0 4px 12px rgba(15,15,15,0.08)',
  shadowLg: '0 12px 30px rgba(15,15,15,0.12)',
}

export const type = { xxs: 11, xs: 12, sm: 13, base: 15, lg: 18, xl: 22 }
const FONT = "'Inter', system-ui, -apple-system, sans-serif"

export const ds = {
  card: {
    background: colors.surface, borderRadius: 12, padding: '16px 18px',
    border: `1px solid ${colors.border}`, boxShadow: colors.shadow,
  },
  input: {
    padding: '0 12px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.border}`, fontSize: type.sm, fontFamily: FONT,
    width: '100%', outline: 'none', background: colors.surface,
    color: colors.text, boxSizing: 'border-box',
  },
  label: {
    fontSize: type.xxs, fontWeight: 700, color: colors.textMute,
    marginBottom: 6, display: 'block',
    textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  primaryBtn: {
    padding: '0 16px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.primary}`,
    background: colors.primary, color: '#fff',
    fontSize: type.sm, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  secondaryBtn: {
    padding: '0 16px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.surface, color: colors.text,
    fontSize: type.sm, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  dangerBtn: {
    padding: '0 16px', height: 38, borderRadius: 8,
    border: `1px solid ${colors.danger}`,
    background: colors.surface, color: colors.danger,
    fontSize: type.sm, fontWeight: 600, cursor: 'pointer', fontFamily: FONT,
  },
  h1: { fontSize: type.xl, fontWeight: 800, color: colors.text, letterSpacing: '-0.4px' },
  h2: { fontSize: type.lg, fontWeight: 700, color: colors.text, marginBottom: 12, letterSpacing: '-0.2px' },
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
    activa:    { bg: colors.stateOkSoft, color: colors.stateOk, label: 'Activa' },
    rechazada: { bg: colors.dangerSoft, color: colors.danger, label: 'Rechazada' },
    nuevo:     { bg: colors.stateNewSoft, color: colors.stateNew, label: 'Nuevo' },
    en_camino: { bg: colors.infoSoft, color: colors.info, label: 'En camino' },
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

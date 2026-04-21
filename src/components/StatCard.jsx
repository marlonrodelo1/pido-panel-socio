import { colors, type } from '../lib/uiStyles'

export default function StatCard({ label, value, sub, icon }) {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      padding: '16px 18px',
      boxShadow: colors.shadow,
      display: 'flex', flexDirection: 'column', gap: 6,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: type.xxs, fontWeight: 700,
        color: colors.textMute, letterSpacing: '0.06em',
        textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {icon}
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: colors.text, letterSpacing: '-0.4px' }}>
        {value ?? '—'}
      </div>
      {sub && (
        <div style={{ fontSize: type.xs, color: colors.textMute }}>{sub}</div>
      )}
    </div>
  )
}

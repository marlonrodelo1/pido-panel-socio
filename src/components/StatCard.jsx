import { colors, type } from '../lib/uiStyles'

/**
 * tone: undefined | 'sage' | 'terracotta'
 *   - undefined → neutral cream card
 *   - sage      → fondo sageSoft, valor sage2
 *   - terracotta→ fondo terracottaSoft, valor terracotta
 */
export default function StatCard({ label, value, sub, icon, tone, delta }) {
  const isTone = tone === 'sage' || tone === 'terracotta'
  const bg = tone === 'sage' ? colors.sageSoft
    : tone === 'terracotta' ? colors.terracottaSoft
    : colors.paper
  const valueColor = tone === 'sage' ? colors.sage2
    : tone === 'terracotta' ? colors.terracotta
    : colors.ink

  return (
    <div style={{
      background: bg,
      border: `1px solid ${isTone ? 'transparent' : colors.border}`,
      borderRadius: 12,
      padding: '14px 16px',
      boxShadow: isTone ? 'none' : colors.shadow,
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 0,
    }}>
      <div style={{
        fontSize: type.xxs, fontWeight: 700,
        color: tone === 'sage' ? colors.sage2 : tone === 'terracotta' ? colors.terracotta2 : colors.textMute,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        {icon}
        {label}
      </div>
      <div style={{
        fontSize: 26, fontWeight: 800,
        color: valueColor,
        letterSpacing: '-0.5px',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
      }}>
        {value ?? '—'}
      </div>
      {(sub || delta) && (
        <div style={{ fontSize: type.xs, color: tone === 'sage' ? colors.sage2 : tone === 'terracotta' ? colors.terracotta2 : colors.textMute }}>
          {delta || sub}
        </div>
      )}
    </div>
  )
}

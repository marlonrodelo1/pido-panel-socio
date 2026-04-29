// Spinner inline pequeno para feedback en botones durante requests.
// Sin dependencias externas, css inline.

export default function Spinner({ size = 16, color = 'currentColor', stroke = 2 }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `${stroke}px solid ${color}`,
        borderRightColor: 'transparent',
        borderRadius: '50%',
        animation: 'pidoo-spin 0.7s linear infinite',
        verticalAlign: 'middle',
      }}
    >
      <style>{`@keyframes pidoo-spin { to { transform: rotate(360deg) } }`}</style>
    </span>
  )
}

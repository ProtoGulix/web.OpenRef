export default function OcrConfBadge({ conf }) {
  if (conf === undefined || conf === null) return null
  const color = conf >= 80 ? 'success' : conf >= 50 ? 'warning' : 'danger'
  const icon = conf >= 80 ? '🟢' : conf >= 50 ? '🟠' : '🔴'
  return <span className={`tag is-${color} is-light`}>{icon} {conf}%</span>
}

export default function OcrConfBadge({ conf }) {
  if (conf === undefined || conf === null) return null
  const cls = conf >= 80 ? 'or-badge-green' : conf >= 50 ? 'or-badge-yellow' : 'or-badge-red'
  return <span className={`or-badge ${cls}`}>{conf}%</span>
}

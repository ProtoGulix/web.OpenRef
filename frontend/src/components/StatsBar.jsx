import { useNavigate } from 'react-router-dom'
import { BookOpen, FileText, Tag, CheckCircle2 } from 'lucide-react'

// `stats` et la cible de clic de chaque tuile sont fournis par la page parente (un seul fetch /api/stats
// partagé avec SearchHero, pas de fetch dupliqué ici).
export default function StatsBar({ stats }) {
  const navigate = useNavigate()

  const items = [
    { key: 'catalogues',           label: 'Catalogues',           icon: BookOpen,      to: '/catalogues' },
    { key: 'pages',                label: 'Pages',                 icon: FileText,      to: '/admin/jobs' },
    { key: 'references_extraites', label: 'Références extraites',  icon: Tag,           to: '/catalogues' },
    {
      key: 'references_corrigees', label: 'Références corrigées', icon: CheckCircle2,
      to: stats?.catalogue_a_corriger_id ? `/admin/catalogue/${stats.catalogue_a_corriger_id}` : '/catalogues',
    },
  ]

  return (
    <div className="or-stats-bar">
      {items.map(({ key, label, icon: Icon, to }) => (
        <button key={key} type="button" className="or-stat-item" onClick={() => navigate(to)}>
          <Icon size={15} className="or-stat-icon" />
          <span className="or-stat-value">{stats ? stats[key].toLocaleString('fr-FR') : '—'}</span>
          <span className="or-stat-label">{label}</span>
        </button>
      ))}
    </div>
  )
}

import { useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api/client'

export default function NomenclatureRow({ data, onUpdated, onDeleted, selected, onSelect }) {
  const [form, setForm] = useState({ ...data })
  const [saving, setSaving] = useState(false)

  const patch = async (body) => {
    setSaving(true)
    try {
      const updated = await api.patchNomenclature(data.id, body)
      setForm(f => ({ ...f, ...updated }))
      onUpdated?.(updated)
    } finally {
      setSaving(false)
    }
  }

  const handleBlur = async (key) => {
    if (String(form[key] ?? '') === String(data[key] ?? '')) return
    await patch({ [key]: form[key], corrige: true })
  }

  const toggleCorrige = () => patch({ corrige: !form.corrige })

  const del = async () => {
    if (!window.confirm('Supprimer cette ligne ?')) return
    await api.deleteNomenclature(data.id)
    onDeleted?.(data.id)
  }

  const field = (key, placeholder, style) => (
    <input
      className="or-input-inline"
      value={form[key] ?? ''}
      placeholder={placeholder}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
      onBlur={() => handleBlur(key)}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      style={style}
    />
  )

  const isCorrige = form.corrige

  return (
    <tr style={{ opacity: saving ? 0.6 : 1, background: isCorrige ? 'rgba(21,128,61,0.04)' : undefined }}>
      <td style={{ width: 28, paddingRight: 0 }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onSelect?.(e.target.checked)}
          title="Sélectionner"
        />
      </td>
      <td>
        <span
          onClick={toggleCorrige}
          title={isCorrige ? 'Marqué corrigé — cliquer pour annuler' : 'Marquer comme corrigé'}
          style={{
            display: 'inline-block', width: 10, height: 10, borderRadius: 2,
            background: isCorrige ? '#15803d' : '#e2e8f0',
            border: '1px solid ' + (isCorrige ? '#15803d' : '#cbd5e1'),
            cursor: 'pointer', flexShrink: 0,
          }}
        />
      </td>
      <td className="or-muted">{field('ref_no', '—', { width: '4ch' })}</td>
      <td><span className="or-mono">{field('part_number', 'Part number', { width: '10ch', fontFamily: 'monospace' })}</span></td>
      <td>{field('description', 'Description', { width: '100%', minWidth: 120 })}</td>
      <td>{field('qty', '—', { width: '4ch' })}</td>
      <td className="or-muted">{field('remarks', '—', { width: '100%', fontSize: '.8rem' })}</td>
      <td>
        <button className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only" onClick={del} title="Supprimer">
          <X size={12} />
        </button>
      </td>
    </tr>
  )
}

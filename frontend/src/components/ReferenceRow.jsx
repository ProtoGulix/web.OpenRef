import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'
import OcrConfBadge from './OcrConfBadge'
import { api } from '../api/client'

export default function ReferenceRow({ data: refData, onUpdated }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ ...refData })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.patchRef(refData.id, { ...form, corrige: true })
      onUpdated?.(updated)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const cancel = () => { setForm({ ...refData }); setEditing(false) }

  if (!editing) {
    return (
      <tr className={refData.corrige ? '' : 'is-uncorrected'}>
        <td><span className="or-mono">{refData.plate_ref}</span></td>
        <td><span className="or-mono">{refData.part_number}</span></td>
        <td>{refData.description}</td>
        <td>{refData.qty}</td>
        <td className="or-muted" style={{ fontSize: '.8rem' }}>{refData.remarks}</td>
        <td><OcrConfBadge conf={refData.conf} /></td>
        <td>
          <button className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only" onClick={() => setEditing(true)} title="Éditer">
            <Pencil size={13} />
          </button>
        </td>
      </tr>
    )
  }

  const field = (key, placeholder, style) => (
    <input
      className="or-input or-input-sm"
      style={style}
      value={form[key] ?? ''}
      placeholder={placeholder}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
    />
  )

  return (
    <tr className="is-editing">
      <td>{field('plate_ref', '#', { width: 60 })}</td>
      <td>{field('part_number', 'Référence', { width: 110 })}</td>
      <td>{field('description', 'Description')}</td>
      <td>
        <input className="or-input or-input-sm" type="number" value={form.qty ?? ''} style={{ width: 60 }}
          onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
      </td>
      <td>{field('remarks', 'Remarques')}</td>
      <td></td>
      <td>
        <div className="or-flex or-gap-1">
          <button className={`or-btn or-btn-success or-btn-sm or-btn-icon-only${saving ? ' is-loading' : ''}`} onClick={save} title="Valider">
            <Check size={13} />
          </button>
          <button className="or-btn or-btn-ghost or-btn-sm or-btn-icon-only" onClick={cancel} title="Annuler">
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

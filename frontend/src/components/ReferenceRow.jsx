import { useState } from 'react'
import OcrConfBadge from './OcrConfBadge'
import { api } from '../api/client'

export default function ReferenceRow({ ref: refData, onUpdated }) {
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

  if (!editing) {
    return (
      <tr className={refData.corrige ? '' : 'has-background-warning-light'}>
        <td>{refData.plate_ref}</td>
        <td><code>{refData.part_number}</code></td>
        <td>{refData.description}</td>
        <td>{refData.qty}</td>
        <td>{refData.remarks}</td>
        <td><OcrConfBadge conf={refData.conf} /></td>
        <td>
          <button className="button is-small is-light" onClick={() => setEditing(true)}>Éditer</button>
        </td>
      </tr>
    )
  }

  const field = (key, placeholder) => (
    <input
      className="input is-small"
      value={form[key] ?? ''}
      placeholder={placeholder}
      onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
    />
  )

  return (
    <tr className="has-background-info-light">
      <td>{field('plate_ref', '#')}</td>
      <td>{field('part_number', 'Référence')}</td>
      <td>{field('description', 'Description')}</td>
      <td><input className="input is-small" type="number" value={form.qty ?? ''} onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} style={{ width: 60 }} /></td>
      <td>{field('remarks', 'Remarques')}</td>
      <td></td>
      <td>
        <button className={`button is-small is-success mr-1 ${saving ? 'is-loading' : ''}`} onClick={save}>Valider</button>
        <button className="button is-small is-light" onClick={() => { setForm({ ...refData }); setEditing(false) }}>Annuler</button>
      </td>
    </tr>
  )
}

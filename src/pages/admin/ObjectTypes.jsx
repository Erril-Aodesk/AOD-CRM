import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Modal from '../../components/Modal'
import { Plus, Trash2, Database, Star } from 'lucide-react'

const TYPES = ['text','textarea','number','currency','date','datetime','boolean','select','multiselect','email','phone']
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')

export default function ObjectTypes() {
  const { objectTypes, fields, profile, refresh } = useAuth()
  const [sel, setSel] = useState(objectTypes[0]?.id || '')
  const [newType, setNewType] = useState(false)
  const [fieldModal, setFieldModal] = useState(null)

  const current = objectTypes.find(o => o.id === sel)
  const defs = fields.filter(f => f.object_type_id === sel).sort((a,b)=>a.sort_order-b.sort_order)

  const addType = async (name) => {
    const { error } = await supabase.from('object_types')
      .insert({ org_id: profile.org_id, name, slug: slugify(name), sort_order: objectTypes.length })
    if (error) alert(error.message); else { setNewType(false); await refresh() }
  }
  const delType = async (id) => {
    if (!confirm('Delete this record type and all its records?')) return
    await supabase.from('object_types').delete().eq('id', id); await refresh(); setSel('')
  }
  const delField = async (id) => {
    await supabase.from('field_definitions').delete().eq('id', id); await refresh()
  }
  const setStatus = async (f) => {
    // clear existing status field for this type, then set this one
    await supabase.from('field_definitions').update({ is_status_field: false })
      .eq('object_type_id', sel).eq('is_status_field', true)
    await supabase.from('field_definitions').update({ is_status_field: true }).eq('id', f.id)
    await refresh()
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Record types</h1>
        <button className="btn-primary ml-auto" onClick={() => setNewType(true)}><Plus size={16} /> New type</button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
        <div className="card p-2 h-max">
          {objectTypes.length === 0 && <p className="p-4 text-sm text-muted">No record types yet.</p>}
          {objectTypes.map(ot => (
            <button key={ot.id} onClick={() => setSel(ot.id)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm
                ${sel === ot.id ? 'bg-brand text-white' : 'hover:bg-black/5'}`}>
              <Database size={15} /> {ot.name}
            </button>
          ))}
        </div>

        {current ? (
          <div className="card p-5">
            <div className="mb-4 flex items-center gap-2">
              <h2 className="font-semibold">{current.name} · fields</h2>
              <button className="btn-outline ml-auto" onClick={() => setFieldModal({ object_type_id: sel })}>
                <Plus size={15} /> Add field
              </button>
              <button className="btn-ghost text-danger" onClick={() => delType(sel)}><Trash2 size={15} /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead><tr><th className="th">Label</th><th className="th">Key</th><th className="th">Type</th><th className="th">Status field</th><th className="th"></th></tr></thead>
                <tbody>
                  {defs.map(f => (
                    <tr key={f.id}>
                      <td className="td font-medium">{f.label}{f.is_required && <span className="text-danger"> *</span>}</td>
                      <td className="td text-muted">{f.key}</td>
                      <td className="td"><span className="chip bg-brand-soft text-brand-dark">{f.field_type}</span></td>
                      <td className="td">
                        <button onClick={() => setStatus(f)} title="Use as status field (drives callback movement)"
                          className={`inline-flex items-center gap-1 text-xs ${f.is_status_field ? 'text-warn font-medium' : 'text-muted hover:text-ink'}`}>
                          <Star size={14} className={f.is_status_field ? 'fill-warn text-warn' : ''} />
                          {f.is_status_field ? 'Status' : 'Set'}
                        </button>
                      </td>
                      <td className="td text-right"><button className="btn-ghost text-danger !px-2" onClick={() => delField(f.id)}><Trash2 size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {defs.length === 0 && <p className="py-6 text-center text-sm text-muted">No fields yet. Add the first one.</p>}
            </div>
          </div>
        ) : <div className="card grid place-items-center p-10 text-sm text-muted">Select or create a record type.</div>}
      </div>

      {newType && <NameModal title="New record type" onClose={() => setNewType(false)} onSave={addType} />}
      {fieldModal && <FieldModal object_type_id={sel} count={defs.length} orgId={profile.org_id}
        onClose={() => setFieldModal(null)} onSaved={async () => { setFieldModal(null); await refresh() }} />}
    </div>
  )
}

function NameModal({ title, onClose, onSave }) {
  const [name, setName] = useState('')
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Create</button></>}>
      <label className="label">Name</label>
      <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)}
        placeholder="e.g. Lead, Client, Candidate" />
    </Modal>
  )
}

function FieldModal({ object_type_id, count, orgId, onClose, onSaved }) {
  const [label, setLabel] = useState('')
  const [type, setType] = useState('text')
  const [required, setRequired] = useState(false)
  const [options, setOptions] = useState('')
  const needsOptions = type === 'select' || type === 'multiselect'

  const save = async () => {
    const { error } = await supabase.from('field_definitions').insert({
      org_id: orgId, object_type_id, label,
      key: slugify(label), field_type: type, is_required: required,
      options: needsOptions ? options.split(',').map(s => s.trim()).filter(Boolean) : null,
      sort_order: count
    })
    if (error) alert(error.message); else onSaved()
  }

  return (
    <Modal title="Add field" onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!label.trim()} onClick={save}>Add field</button></>}>
      <div className="space-y-3">
        <div><label className="label">Label</label>
          <input className="input" autoFocus value={label} onChange={e => setLabel(e.target.value)} /></div>
        <div><label className="label">Type</label>
          <select className="input" value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select></div>
        {needsOptions && (
          <div><label className="label">Options (comma-separated)</label>
            <input className="input" value={options} onChange={e => setOptions(e.target.value)}
              placeholder="New, Contacted, Qualified, Won, Lost" /></div>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={required} onChange={e => setRequired(e.target.checked)} />
          Required
        </label>
      </div>
    </Modal>
  )
}

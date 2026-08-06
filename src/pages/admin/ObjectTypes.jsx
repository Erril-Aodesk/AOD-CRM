import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import Modal from '../../components/Modal'
import { Plus, Trash2, Database, Star, Pencil, Copy, ChevronUp, ChevronDown } from 'lucide-react'

const TYPES = ['text','textarea','number','currency','date','datetime','boolean','select','multiselect','email','phone']
const slugify = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')

export default function ObjectTypes() {
  const { objectTypes, fields, profile, refresh } = useAuth()
  const [sel, setSel] = useState(objectTypes[0]?.id || '')
  const [newType, setNewType] = useState(false)
  const [fieldModal, setFieldModal] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const [users, setUsers] = useState([])

  const current = objectTypes.find(o => o.id === sel)
  const defs = fields.filter(f => f.object_type_id === sel).sort((a,b)=>a.sort_order-b.sort_order)

  useEffect(() => {
    if (!profile?.org_id) return
    supabase.from('profiles').select('id, full_name, email')
      .eq('org_id', profile.org_id).eq('is_active', true).order('full_name')
      .then(({ data }) => setUsers(data || []))
  }, [profile?.org_id])

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
  const renameType = async (name) => {
    const { error } = await supabase.from('object_types').update({ name }).eq('id', sel)
    if (error) alert(error.message); else { setRenaming(false); await refresh() }
  }
  const setDefaultAgent = async (agentId) => {
    await supabase.from('object_types').update({ default_agent_id: agentId || null }).eq('id', sel)
    await refresh()
  }
  const duplicateType = async (ot) => {
    if (!confirm(`Duplicate "${ot.name}"? This copies its fields and permissions, not its records.`)) return
    const name = `${ot.name} (copy)`
    const { data: newOt, error: e1 } = await supabase.from('object_types')
      .insert({ org_id: ot.org_id, name, slug: slugify(name), sort_order: objectTypes.length })
      .select().single()
    if (e1) return alert(e1.message)

    const { data: defsToCopy, error: e2 } = await supabase.from('field_definitions').select('*').eq('object_type_id', ot.id)
    if (e2) return alert(e2.message)

    const fieldIdMap = new Map()
    if (defsToCopy?.length) {
      const { data: inserted, error: e3 } = await supabase.from('field_definitions').insert(
        defsToCopy.map(f => ({
          org_id: f.org_id, object_type_id: newOt.id, key: f.key, label: f.label,
          field_type: f.field_type, options: f.options, is_required: f.is_required,
          is_status_field: f.is_status_field, show_in_list: f.show_in_list, sort_order: f.sort_order
        }))
      ).select()
      if (e3) return alert(e3.message)
      inserted.forEach(nf => {
        const orig = defsToCopy.find(f => f.key === nf.key)
        if (orig) fieldIdMap.set(orig.id, nf.id)
      })
    }

    const { data: objPerms, error: e4 } = await supabase.from('role_object_permissions').select('*').eq('object_type_id', ot.id)
    if (e4) return alert(e4.message)
    if (objPerms?.length) {
      const { error: e5 } = await supabase.from('role_object_permissions').insert(
        objPerms.map(p => ({
          org_id: p.org_id, role_id: p.role_id, object_type_id: newOt.id,
          can_view: p.can_view, can_create: p.can_create, can_edit: p.can_edit, can_delete: p.can_delete, scope: p.scope
        }))
      )
      if (e5) return alert(e5.message)
    }

    if (defsToCopy?.length) {
      const { data: fieldPerms, error: e6 } = await supabase.from('role_field_permissions')
        .select('*').in('field_definition_id', defsToCopy.map(f => f.id))
      if (e6) return alert(e6.message)
      const newFieldPerms = (fieldPerms || [])
        .filter(p => fieldIdMap.has(p.field_definition_id))
        .map(p => ({
          org_id: p.org_id, role_id: p.role_id,
          field_definition_id: fieldIdMap.get(p.field_definition_id),
          can_view: p.can_view, can_edit: p.can_edit
        }))
      if (newFieldPerms.length) {
        const { error: e7 } = await supabase.from('role_field_permissions').insert(newFieldPerms)
        if (e7) return alert(e7.message)
      }
    }

    await refresh()
    setSel(newOt.id)
  }
  // Renumbers the whole list to sequential indices rather than swapping raw
  // sort_order values, so stale/duplicate values from older data can't leave
  // a move looking like it did nothing.
  const moveField = async (index, dir) => {
    const other = index + dir
    if (other < 0 || other >= defs.length) return
    const reordered = [...defs]
    ;[reordered[index], reordered[other]] = [reordered[other], reordered[index]]
    await Promise.all(reordered.map((f, i) => supabase.from('field_definitions').update({ sort_order: i }).eq('id', f.id)))
    await refresh()
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
              <button className="btn-outline" onClick={() => setRenaming(true)}>
                <Pencil size={15} /> Rename
              </button>
              <button className="btn-outline" onClick={() => duplicateType(current)}>
                <Copy size={15} /> Duplicate
              </button>
              <button className="btn-ghost text-danger" onClick={() => delType(sel)}><Trash2 size={15} /></button>
            </div>
            <div className="mb-4 flex items-center gap-2">
              <label className="label !mb-0">Default agent</label>
              <select className="input w-56" value={current.default_agent_id || ''}
                onChange={e => setDefaultAgent(e.target.value)}>
                <option value="">— None (falls back to current user) —</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead><tr><th className="th w-8"></th><th className="th">Label</th><th className="th">Key</th><th className="th">Type</th><th className="th">Status field</th><th className="th"></th></tr></thead>
                <tbody>
                  {defs.map((f, i) => (
                    <tr key={f.id}>
                      <td className="td">
                        <div className="flex flex-col">
                          <button className="text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                            disabled={i === 0} title="Move up" onClick={() => moveField(i, -1)}>
                            <ChevronUp size={14} />
                          </button>
                          <button className="text-muted hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
                            disabled={i === defs.length - 1} title="Move down" onClick={() => moveField(i, 1)}>
                            <ChevronDown size={14} />
                          </button>
                        </div>
                      </td>
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
                      <td className="td text-right">
                        <button className="btn-ghost !px-2" onClick={() => setFieldModal(f)}><Pencil size={14} /></button>
                        <button className="btn-ghost text-danger !px-2" onClick={() => delField(f.id)}><Trash2 size={14} /></button>
                      </td>
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
      {renaming && <NameModal title="Rename record type" initial={current.name} saveLabel="Save"
        onClose={() => setRenaming(false)} onSave={renameType} />}
      {fieldModal && <FieldModal object_type_id={sel} count={defs.length} orgId={profile.org_id}
        field={fieldModal.id ? fieldModal : null}
        onClose={() => setFieldModal(null)} onSaved={async () => { setFieldModal(null); await refresh() }} />}
    </div>
  )
}

function NameModal({ title, initial = '', saveLabel = 'Create', onClose, onSave }) {
  const [name, setName] = useState(initial)
  return (
    <Modal title={title} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>{saveLabel}</button></>}>
      <label className="label">Name</label>
      <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)}
        placeholder="e.g. Lead, Client, Candidate" />
    </Modal>
  )
}

function FieldModal({ field, object_type_id, count, orgId, onClose, onSaved }) {
  const isEdit = !!field
  const [label, setLabel] = useState(field?.label || '')
  const [type, setType] = useState(field?.field_type || 'text')
  const [required, setRequired] = useState(field?.is_required || false)
  const [options, setOptions] = useState((field?.options || []).join(', '))
  const [showInList, setShowInList] = useState(field?.show_in_list ?? true)
  const [defaultValue, setDefaultValue] = useState(field?.default_value || '')
  const needsOptions = type === 'select' || type === 'multiselect'
  const optionList = options.split(',').map(s => s.trim()).filter(Boolean)

  const save = async () => {
    const payload = {
      label, field_type: type, is_required: required, show_in_list: showInList,
      default_value: defaultValue || null,
      options: needsOptions ? optionList : null
    }
    const { error } = isEdit
      ? await supabase.from('field_definitions').update(payload).eq('id', field.id)
      : await supabase.from('field_definitions').insert({
          org_id: orgId, object_type_id, key: slugify(label), sort_order: count, ...payload
        })
    if (error) alert(error.message); else onSaved()
  }

  return (
    <Modal title={isEdit ? 'Edit field' : 'Add field'} onClose={onClose}
      footer={<><button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!label.trim()} onClick={save}>{isEdit ? 'Save' : 'Add field'}</button></>}>
      <div className="space-y-3">
        <div><label className="label">Label</label>
          <input className="input" autoFocus value={label} onChange={e => setLabel(e.target.value)} /></div>
        {isEdit && (
          <div><label className="label">Key</label>
            <input className="input bg-bg text-muted" value={field.key} disabled readOnly /></div>
        )}
        <div><label className="label">Type</label>
          <select className="input" value={type} onChange={e => setType(e.target.value)}>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select></div>
        {needsOptions && (
          <div><label className="label">Options (comma-separated)</label>
            <input className="input" value={options} onChange={e => setOptions(e.target.value)}
              placeholder="New, Contacted, Qualified, Won, Lost" /></div>
        )}
        <div><label className="label">Default value (optional)</label>
          {needsOptions ? (
            <select className="input" value={defaultValue} onChange={e => setDefaultValue(e.target.value)}>
              <option value="">— none —</option>
              {optionList.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input className="input" value={defaultValue} onChange={e => setDefaultValue(e.target.value)}
              placeholder={type === 'boolean' ? 'true or false' : ''} />
          )}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={required} onChange={e => setRequired(e.target.checked)} />
          Required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-brand" checked={showInList} onChange={e => setShowInList(e.target.checked)} />
          Show in list
        </label>
      </div>
    </Modal>
  )
}

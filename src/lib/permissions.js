// Turns the loaded permission rows into simple helpers the UI can call.
export function buildPermissions({ role, objectPerms, fieldPerms }) {
  const isAdmin = !!role?.is_admin
  const oMap = new Map(objectPerms.map(p => [p.object_type_id, p]))
  const fMap = new Map(fieldPerms.map(p => [p.field_definition_id, p]))

  return {
    isAdmin,
    isManager: !!role?.is_manager || isAdmin,
    canView:   ot => isAdmin || !!oMap.get(ot)?.can_view,
    canCreate: ot => isAdmin || !!oMap.get(ot)?.can_create,
    canEdit:   ot => isAdmin || !!oMap.get(ot)?.can_edit,
    canDelete: ot => isAdmin || !!oMap.get(ot)?.can_delete,
    scope:     ot => isAdmin ? 'all' : (oMap.get(ot)?.scope || 'own'),
    // field-level: default visible unless a rule hides it
    fieldVisible:  fid => isAdmin || (fMap.has(fid) ? fMap.get(fid).can_view  : true),
    fieldEditable: fid => isAdmin || (fMap.has(fid) ? fMap.get(fid).can_edit  : false)
  }
}

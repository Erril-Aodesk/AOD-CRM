-- ============================================================================
-- CUSTOMIZABLE CRM — Supabase schema (multi-tenant, dynamic objects, RBAC)
-- Run this in the Supabase SQL Editor (or as a migration).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
do $$ begin
  create type field_type as enum (
    'text','textarea','number','currency','date','datetime',
    'boolean','select','multiselect','email','phone'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type record_scope as enum ('own','assigned_and_unassigned','all');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- ORGANIZATIONS (tenants / workspaces)
-- ----------------------------------------------------------------------------
create table if not exists organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ROLES  (4 seeded per org; super_admin bypasses all checks)
-- ----------------------------------------------------------------------------
create table if not exists roles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  slug        text not null,            -- super_admin | manager | agent | lead_gen_specialist
  name        text not null,
  is_admin    boolean not null default false,   -- super_admin = true (full bypass)
  is_manager  boolean not null default false,   -- receives callback escalations
  created_at  timestamptz not null default now(),
  unique (org_id, slug)
);

-- ----------------------------------------------------------------------------
-- PROFILES (extends auth.users)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  role_id     uuid not null references roles(id),
  full_name   text,
  email       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists idx_profiles_org on profiles(org_id);

-- ----------------------------------------------------------------------------
-- OBJECT TYPES (dynamic record types — Super Admin creates these)
-- ----------------------------------------------------------------------------
create table if not exists object_types (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,            -- e.g. "Lead", "Client"
  slug        text not null,
  icon        text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (org_id, slug)
);
create index if not exists idx_object_types_org on object_types(org_id);

-- ----------------------------------------------------------------------------
-- FIELD DEFINITIONS (columns per object type; drive the dynamic UI)
-- ----------------------------------------------------------------------------
create table if not exists field_definitions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  object_type_id  uuid not null references object_types(id) on delete cascade,
  key             text not null,        -- json key inside records.data
  label           text not null,
  field_type      field_type not null default 'text',
  options         jsonb,                -- choices for select/multiselect
  is_required     boolean not null default false,
  is_status_field boolean not null default false,  -- THE field used for callback movement detection
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  unique (object_type_id, key)
);
create index if not exists idx_fields_object on field_definitions(object_type_id);

-- Only one status field per object type
create unique index if not exists uq_one_status_field
  on field_definitions(object_type_id) where is_status_field;

-- ----------------------------------------------------------------------------
-- RECORDS (actual data; values live in JSONB keyed by field_definitions.key)
-- ----------------------------------------------------------------------------
create table if not exists records (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  object_type_id  uuid not null references object_types(id) on delete cascade,
  owner_id        uuid references profiles(id) on delete set null,  -- assigned-to
  data            jsonb not null default '{}'::jsonb,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_records_org     on records(org_id);
create index if not exists idx_records_type    on records(object_type_id);
create index if not exists idx_records_owner    on records(owner_id);
create index if not exists idx_records_data_gin on records using gin (data);

-- ----------------------------------------------------------------------------
-- PERMISSIONS — object level (Super Admin configures this per role)
-- ----------------------------------------------------------------------------
create table if not exists role_object_permissions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  role_id         uuid not null references roles(id) on delete cascade,
  object_type_id  uuid not null references object_types(id) on delete cascade,
  can_view        boolean not null default false,
  can_create      boolean not null default false,
  can_edit        boolean not null default false,
  can_delete      boolean not null default false,
  scope           record_scope not null default 'own',
  unique (role_id, object_type_id)
);

-- ----------------------------------------------------------------------------
-- PERMISSIONS — field level (per role: which fields visible/editable)
-- ----------------------------------------------------------------------------
create table if not exists role_field_permissions (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references organizations(id) on delete cascade,
  role_id               uuid not null references roles(id) on delete cascade,
  field_definition_id   uuid not null references field_definitions(id) on delete cascade,
  can_view              boolean not null default true,
  can_edit              boolean not null default false,
  unique (role_id, field_definition_id)
);

-- ----------------------------------------------------------------------------
-- CALLBACKS (movement = record status field changed)
-- ----------------------------------------------------------------------------
create table if not exists callbacks (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  record_id       uuid not null references records(id) on delete cascade,
  object_type_id  uuid not null references object_types(id) on delete cascade,
  created_by      uuid references profiles(id) on delete set null,
  assigned_to     uuid references profiles(id) on delete set null,
  callback_at     timestamptz not null,
  status_snapshot text,                 -- record's status value when callback was set
  note            text,
  is_completed    boolean not null default false,
  completed_at    timestamptz,
  escalated       boolean not null default false,   -- manager already notified
  created_at      timestamptz not null default now()
);
create index if not exists idx_callbacks_due
  on callbacks(callback_at) where not is_completed and not escalated;

-- ----------------------------------------------------------------------------
-- NOTIFICATIONS (in-app bell; Realtime subscribe filtered by user_id)
-- ----------------------------------------------------------------------------
create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  type        text not null,            -- e.g. 'callback_missed'
  title       text not null,
  body        text,
  record_id   uuid references records(id) on delete cascade,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_notifs_user on notifications(user_id) where not is_read;

-- ----------------------------------------------------------------------------
-- INVITATIONS (invite-only signup; manager/super_admin invites)
-- ----------------------------------------------------------------------------
create table if not exists invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  email       text not null,
  role_id     uuid not null references roles(id),
  token       uuid not null default gen_random_uuid(),
  invited_by  uuid references profiles(id) on delete set null,
  accepted    boolean not null default false,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  created_at  timestamptz not null default now()
);
create index if not exists idx_invites_token on invitations(token);

-- ============================================================================
-- HELPER FUNCTIONS  (SECURITY DEFINER so RLS policies can call them safely)
-- ============================================================================
create or replace function auth_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from profiles where id = auth.uid();
$$;

create or replace function auth_role_id() returns uuid
language sql stable security definer set search_path = public as $$
  select role_id from profiles where id = auth.uid();
$$;

create or replace function auth_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.is_admin from profiles p
    join roles r on r.id = p.role_id where p.id = auth.uid()), false);
$$;

-- Can the current user view records of this object type, given ownership?
create or replace function auth_can_view_record(p_object_type uuid, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth_is_admin() then true
    else exists (
      select 1 from role_object_permissions rop
      where rop.role_id = auth_role_id()
        and rop.object_type_id = p_object_type
        and rop.can_view
        and (
          rop.scope = 'all'
          or (rop.scope = 'own' and p_owner = auth.uid())
          or (rop.scope = 'assigned_and_unassigned'
              and (p_owner = auth.uid() or p_owner is null))
        )
    )
  end;
$$;

-- Generic object-permission check for a given action.
create or replace function auth_has_object_perm(p_object_type uuid, p_action text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when auth_is_admin() then true
    else exists (
      select 1 from role_object_permissions rop
      where rop.role_id = auth_role_id()
        and rop.object_type_id = p_object_type
        and case p_action
              when 'create' then rop.can_create
              when 'edit'   then rop.can_edit
              when 'delete' then rop.can_delete
              else rop.can_view
            end
    )
  end;
$$;

-- Keep records.updated_at fresh
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists trg_records_touch on records;
create trigger trg_records_touch before update on records
  for each row execute function touch_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table organizations          enable row level security;
alter table roles                  enable row level security;
alter table profiles               enable row level security;
alter table object_types           enable row level security;
alter table field_definitions      enable row level security;
alter table records                enable row level security;
alter table role_object_permissions enable row level security;
alter table role_field_permissions  enable row level security;
alter table callbacks              enable row level security;
alter table notifications          enable row level security;
alter table invitations            enable row level security;

-- Organizations: members can read their own org
create policy org_read on organizations for select
  using (id = auth_org_id());

-- Roles / object_types / field_definitions: any org member reads; only admin writes
create policy roles_read on roles for select using (org_id = auth_org_id());
create policy roles_admin on roles for all
  using (org_id = auth_org_id() and auth_is_admin())
  with check (org_id = auth_org_id() and auth_is_admin());

create policy ot_read on object_types for select using (org_id = auth_org_id());
create policy ot_admin on object_types for all
  using (org_id = auth_org_id() and auth_is_admin())
  with check (org_id = auth_org_id() and auth_is_admin());

create policy fd_read on field_definitions for select using (org_id = auth_org_id());
create policy fd_admin on field_definitions for all
  using (org_id = auth_org_id() and auth_is_admin())
  with check (org_id = auth_org_id() and auth_is_admin());

-- Profiles: read others in your org; admins manage
create policy profiles_read on profiles for select using (org_id = auth_org_id());
create policy profiles_self on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on profiles for all
  using (org_id = auth_org_id() and auth_is_admin())
  with check (org_id = auth_org_id() and auth_is_admin());

-- Permission tables: readable by org (frontend needs them to shape UI); admin writes
create policy rop_read on role_object_permissions for select using (org_id = auth_org_id());
create policy rop_admin on role_object_permissions for all
  using (org_id = auth_org_id() and auth_is_admin())
  with check (org_id = auth_org_id() and auth_is_admin());

create policy rfp_read on role_field_permissions for select using (org_id = auth_org_id());
create policy rfp_admin on role_field_permissions for all
  using (org_id = auth_org_id() and auth_is_admin())
  with check (org_id = auth_org_id() and auth_is_admin());

-- Records: driven by the configurable permission matrix
create policy records_select on records for select
  using (org_id = auth_org_id() and auth_can_view_record(object_type_id, owner_id));

create policy records_insert on records for insert
  with check (org_id = auth_org_id() and auth_has_object_perm(object_type_id, 'create'));

create policy records_update on records for update
  using (org_id = auth_org_id() and auth_has_object_perm(object_type_id, 'edit')
         and auth_can_view_record(object_type_id, owner_id))
  with check (org_id = auth_org_id());

create policy records_delete on records for delete
  using (org_id = auth_org_id() and auth_has_object_perm(object_type_id, 'delete')
         and auth_can_view_record(object_type_id, owner_id));

-- Callbacks: visible to org members who can see the underlying record
create policy callbacks_select on callbacks for select
  using (org_id = auth_org_id());
create policy callbacks_write on callbacks for all
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

-- Notifications: users see only their own
create policy notifs_own on notifications for select
  using (user_id = auth.uid());
create policy notifs_update on notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Invitations: managers and super admins in the org manage
create or replace function auth_is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.is_manager or r.is_admin from profiles p
    join roles r on r.id = p.role_id where p.id = auth.uid()), false);
$$;

create policy invites_manage on invitations for all
  using (org_id = auth_org_id() and auth_is_manager())
  with check (org_id = auth_org_id() and auth_is_manager());

-- ============================================================================
-- CALLBACK ESCALATION  (called by Vercel Cron on a schedule)
-- Notifies managers of any callback that is past due, not completed, and whose
-- record status is unchanged since the callback was set.
-- ============================================================================
create or replace function escalate_overdue_callbacks()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_count int := 0;
  c record;
  v_status_key text;
  v_current_status text;
begin
  for c in
    select cb.*, r.data as record_data, r.object_type_id as otid, r.org_id as org
    from callbacks cb
    join records r on r.id = cb.record_id
    where cb.callback_at < now()
      and not cb.is_completed
      and not cb.escalated
  loop
    -- find the status field key for this object type
    select key into v_status_key from field_definitions
      where object_type_id = c.otid and is_status_field limit 1;

    v_current_status := case when v_status_key is null then null
                             else c.record_data ->> v_status_key end;

    -- "no movement" = status unchanged since callback was set
    if v_status_key is null or v_current_status is not distinct from c.status_snapshot then
      insert into notifications (org_id, user_id, type, title, body, record_id)
      select c.org, p.id, 'callback_missed',
             'Missed callback',
             'A callback due ' || to_char(c.callback_at, 'DD Mon HH24:MI') ||
             ' had no movement.', c.record_id
      from profiles p
      join roles ro on ro.id = p.role_id
      where p.org_id = c.org and ro.is_manager and p.is_active;

      update callbacks set escalated = true where id = c.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end $$;

-- ============================================================================
-- BOOTSTRAP  (create an org with the 4 default roles in one call)
-- ============================================================================
create or replace function bootstrap_org(p_org_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  insert into organizations(name) values (p_org_name) returning id into v_org;
  insert into roles(org_id, slug, name, is_admin, is_manager) values
    (v_org,'super_admin','Super Admin', true,  false),
    (v_org,'manager','Manager',          false, true),
    (v_org,'agent','Agent / Recruiter',  false, false),
    (v_org,'lead_gen_specialist','Lead Gen Specialist', false, false);
  return v_org;
end $$;

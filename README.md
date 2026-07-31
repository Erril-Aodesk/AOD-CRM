# Custom CRM

A fully customizable, multi-tenant CRM. Super Admins create record types and fields,
control what every role can see and do (down to individual fields), and the system
escalates missed callbacks to managers automatically.

Stack: **React + Vite** frontend, **Supabase** (Postgres + Auth + Realtime), deployed on **Vercel**.

---

## What's inside

```
schema.sql            Full database: tables, RLS, callback escalation, bootstrap
vercel.json           Cron schedule (runs escalation every 15 min)
api/cron/escalate.js  Serverless endpoint the cron calls
api/accept-invite.js  Serverless endpoint that finalizes invitations
src/                  The React app (auth, records, admin, callbacks, import)
.env.example          Copy to .env and fill in
```

Feature map: dynamic record types & fields, per-role permission matrix (view/create/edit/delete
+ record scope + per-field visibility), in-app notification bell (Supabase Realtime),
callback escalation to managers, Excel import with column mapping, responsive on
desktop / tablet / mobile.

---

## Prerequisites

- Node.js 18+
- A Supabase project (free tier is fine)
- A Vercel account (for deploy + cron)

---

## Step 1 — Set up the database

1. In your Supabase project, open **SQL Editor** → paste the entire contents of
   `schema.sql` → **Run**. This creates every table, all RLS policies, the escalation
   function, and a `bootstrap_org()` helper.

2. Open **Authentication → Providers → Email** and, for now, **turn off "Confirm email"**.
   This makes the invite flow seamless. (Add SMTP and re-enable later when you want email
   confirmation.)

3. Grab your keys from **Project Settings → API**:
   - Project URL
   - `anon` public key (browser-safe)
   - `service_role` key (server-only — never ship to the browser)

---

## Step 2 — Create your workspace and first Super Admin

1. In **Authentication → Users → Add user**, create your own login
   (email + password, tick "Auto Confirm User").

2. Back in **SQL Editor**, run this once — it creates the org, seeds the 4 roles,
   and makes you the Super Admin. Replace the name and email:

```sql
do $$
declare v_org uuid; v_role uuid; v_user uuid;
begin
  v_org := bootstrap_org('AODesk CRM');
  select id into v_role from roles where org_id = v_org and slug = 'super_admin';
  select id into v_user from auth.users where email = 'you@company.com';
  insert into profiles (id, org_id, role_id, full_name, email)
  values (v_user, v_org, v_role, 'Your Name', 'you@company.com');
end $$;
```

The four roles created: **Super Admin**, **Manager**, **Agent / Recruiter**,
**Lead Gen Specialist**. Managers receive callback escalations; only Super Admin
configures record types, fields, and permissions.

---

## Step 3 — Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

(The `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are only needed on Vercel — Step 5.)

---

## Step 4 — Run locally

```bash
npm install
npm run dev
```

Open the printed URL, sign in with the Super Admin you created. Note: the
`/api/*` serverless functions (invite acceptance, cron) only run on Vercel, not in
`vite dev` — everything else works locally.

---

## Step 5 — Deploy to Vercel

1. Push this folder to a Git repo and import it in Vercel (framework preset: **Vite**).
2. In **Vercel → Project → Settings → Environment Variables**, add:

```
VITE_SUPABASE_URL           = https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY      = your-anon-key
SUPABASE_URL                = https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY   = your-service-role-key
CRON_SECRET                 = a-long-random-string
```

3. Deploy. `vercel.json` registers the cron automatically — it hits
   `/api/cron/escalate` every 15 minutes to escalate missed callbacks.
   (Adjust the `schedule` in `vercel.json` if you want a different cadence.)

To test escalation manually:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://your-app.vercel.app/api/cron/escalate
```

---

## Step 6 — Set it up inside the app (as Super Admin)

1. **Record types** (Admin → Record types): create your objects, e.g. `Lead`, `Client`.
2. Add **fields** to each type (text, select, date, currency, etc.). For each type,
   click the **star** on the field that represents its status (e.g. a `Status` select) —
   this is the field the callback escalation watches for movement.
3. **Permissions** (Admin → Permissions): pick a role, then toggle view/create/edit/delete
   per record type, choose a record **scope** (own only / own + unassigned / all), and
   expand a type to set **per-field** visible/editable. Super Admin is always full-access.
4. **Users** (Admin → Users): invite people by email + role. You get a shareable
   `/accept-invite` link (valid 7 days) — send it however you like. They set a password
   and land in the workspace with exactly the access their role allows.
5. **Import** (Import Excel): pick a record type, upload an `.xlsx`/`.csv`, map columns
   to fields, and bulk-create records.

---

## How callback escalation works

When someone sets a callback on a record, the system snapshots that record's **status
field** value. On schedule, `escalate_overdue_callbacks()` finds callbacks that are past
due, not completed, and whose record status **still matches the snapshot** (i.e. no
movement) — and drops a notification to every manager. Callbacks whose status has changed
are left alone, and each callback escalates only once.

If a record type has no status field marked, any past-due callback on it will escalate
(there's nothing to measure movement against) — so mark a status field per type.

---

## Notes

- **Field-level security:** Postgres RLS enforces record-level access in the database.
  Field hiding is applied in the app from `role_field_permissions`, and all writes are
  validated server-side, so it can't be bypassed through the API.
- **Multi-tenant:** every row carries `org_id`. To onboard another company, create a new
  org with `bootstrap_org('Their Company')` and a Super Admin for them — their data is
  fully isolated by RLS.
- **Email notifications:** the schema and bell are in-app for now. Adding email is a small
  step later — send from the escalation function (Supabase) or the cron route (Resend/SES).

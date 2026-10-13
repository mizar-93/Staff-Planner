# Microsoft 365 and shared database setup

The existing static application remains in local password mode. Corporate mode runs through the Node server and uses Microsoft Entra ID, server sessions, and a shared database. Use a **new hostname/origin** for corporate deployment to avoid a previously installed local service worker serving old assets.

## 1. Register the Microsoft application

In Microsoft Entra admin center, create an App registration for **this organizational directory only**. Add a **Web** redirect URI: `https://YOUR-HOST/auth/callback` (development: `http://localhost:3000/auth/callback`). Create a client secret. Copy the Directory/tenant ID and Application/client ID into `.env`. Keep the secret on the server. No Microsoft password or token is stored in the browser. Login uses authorization code flow, PKCE, nonce, signed ID-token validation, and an HttpOnly session cookie.

Reference: [Microsoft authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

## 2. Connect the database

The included adapter is **PostgreSQL**, because the company database engine has not yet been specified. Run `server/schema.sql` in the chosen PostgreSQL database. Set `DATABASE_URL` in `.env`; configure database TLS according to the company environment. For SQL Server or another database, replace `server/store.mjs` and the parameterized account/session queries in `server/index.mjs` with the company driver and equivalent schema. The current files cannot connect directly to SQL Server.

The three fixed shifts are `shift-1`, `shift-2`, `shift-3`. Staff data, assessments, schedules, production, tasks, and settings are stored separately per shift. Production manager can select any shift. One active shift leader is permitted per shift.

## 3. Provision the first production manager

Find the manager's **Object ID** under Entra → Users (NOT the application Object ID). Run the following with real values using your database administration tool:

```sql
INSERT INTO planner_users(id,email,name,oid,role)
VALUES ('YOUR-NEW-UUID','manager@company.com','Manager name',
        'MICROSOFT-USER-OBJECT-ID','production_manager');
```

Accounts do not self-register. Microsoft tenant and immutable user Object ID determine identity. Email is a contact field. The manager then opens **Personal → Konton och behörigheter** to add/edit accounts, roles, shift, group, staff person ID, and active status. Changing an account revokes its sessions. The manager cannot remove their own administrator access.

## 4. Run

Requires Node 22 or later:

```powershell
npm install
Copy-Item .env.example .env
# Fill .env, apply the SQL schema, provision the manager.
npm start
```

Set `PUBLIC_ORIGIN` to the exact public origin without trailing slash. Production requires HTTPS. Reverse proxy all app and API routes to this server. Do not serve corporate pages independently through a static host. Database and Microsoft credentials stay on the server. Files such as `.env`, SQL, and server source are excluded from public serving. Expired sessions are rejected; account status/role is loaded from the database on every API request.

## 5. Assign groups and existing data

In each selected shift, add staff and schedules using the normal screens. In Personal, assign the same **group string** (for example `A`) to staff and worker accounts, and select that employee's Personal-ID. Group names are case-sensitive. Workers see only their group's assignments and names, with no assessments, competence, production, tasks, or edits. They can choose the schedule week. Manager dashboard shows production in BOX and waste in KG for all shifts on the chosen date. Manager may read Att göra; server rejects all task writes.

Existing encrypted local data is **not automatically migrated** or uploaded. Keep existing local backups before deployment. Initial corporate records start empty. Transfer approved data into the correct shifts only; avoid importing a whole local backup with data from multiple shifts. Local password, backup, wipe, and password-change tools belong to local mode and are hidden in corporate mode.

## Temporary shift-leader deputy

Run `server/schema.sql` again when updating an existing database; it adds `planner_delegations` and `planner_private_todos` without dropping data. A shift leader can open **Personal** or **Översikt → Tillfällig ställföreträdare**, choose an active worker account from their own shift, and grant temporary access. Granting another worker replaces that leader's previous deputy. Select **Återkalla behörighet** on return from leave. No calendar expiry is assumed.

The worker's base role remains unchanged. The deputy gets a restricted editor for their shift's schedule and employee availability (including Sjuk and Semester), and **Min Att göra**, stored by their own account ID. They cannot change names, groups, roles, accounts, assessments, production, or the shift leader's Att göra. Every API request recomputes delegation using the current active leader and shift. Revocation blocks the next deputy request even in an already open session; that screen reloads into the worker view on a 403 response. Personal task history is retained for future delegation and is never merged into the shift list. Changing either account through manager account administration also clears its delegations.

## Validation

`npm test` checks existing app regressions plus authorization and worker projection. `node tests/corporate-browser.cjs` checks corporate role screens using a mock API; `node tests/browser-smoke.cjs` checks local mode in Edge. After connecting real infrastructure, verify login/logout for all roles, account disable/reassignment, cross-shift API requests (403), worker general-data requests (403), manager task PUT (403), concurrent edits (409), and full schedule/production saving. Real Microsoft login and SQL integration require the company's connection settings and have not been exercised locally.

The login handshake currently uses temporary in-process state. Deploy one server instance. If using multiple instances, replace `pending` with shared expiring storage before enabling load balancing. The SQL schema is provided explicitly and is not automatically applied at startup.

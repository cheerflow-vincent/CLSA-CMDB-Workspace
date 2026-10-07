# CLSA CMDB Workspace — ServiceNow React Portal

A scoped ServiceNow application (**CLSA CMDB Workspace**) that delivers a React single-page portal for CMDB configuration items, business applications, infrastructure relationships, and governed relationship change workflows.

The UI is packaged as a **UI Page** and talks to **Scripted REST** endpoints defined in Fluent. Production users authenticate with normal ServiceNow session cookies (`g_ck` / Table API); no credentials are embedded in the client bundle.

| Item | Value |
|------|--------|
| Application scope | `x_citi4_clsa_cmd_0` |
| UI Page | `x_citi4_clsa_cmd_0_cmdb_portal.do` |
| Scripted REST API ID | `portal` (base path `/api/x_citi4_clsa_cmd_0/portal/…`) |
| npm package name | `clsa-cmd-portal` |

---

## Tech stack

| Tool | Purpose |
|------|---------|
| React 18 + TypeScript | Portal UI (`src/client/`) |
| Tailwind CSS | Styling (`npm run build:css`) |
| Axios | Table API and portal REST calls |
| @xyflow/react | Application / relationship / infrastructure diagrams |
| Recharts | Task trend charts |
| @servicenow/sdk (Fluent) | Scoped app metadata, UI Page, REST routes, tables, notifications (`src/fluent/`) |
| ESLint 9 | Linting (`npm run lint`) |

---

## Architecture

```
Developer machine (this repo)
    │  npm run build:css → now-sdk build → now-sdk install
    ▼
ServiceNow instance (scoped app x_citi4_clsa_cmd_0)
    ├── UI Page (compiled React in index.html)
    ├── Scripted REST API (portal)
    ├── Custom table: relationship_change
    └── Script Includes + email notifications
    │
    ▼
Browser (logged-in SN user)
    └── SPA + /api/now/table/… + /api/x_citi4_clsa_cmd_0/portal/…
```

Publishing to ServiceNow is **local deploy only** (`npm run deploy` from a machine with SDK auth). A remote git backup may exist for source control, but it is not part of the application publish path.

Server-side handlers live under `src/fluent/scripts/`; route definitions are in `src/fluent/rest-apis/portal.now.ts`.

---

## Portal features (high level)

- **Application Home** — hierarchy views, filters (including department multi-select), search, and paged app lists via `POST /application_home`.
- **CI Search** — inventory tabs, flags, health results, distinct counts, and task-scoped queries.
- **Record detail** — ACL-aware forms, related lists, infrastructure diagrams, and relationship editing.
- **Relationship changes** — create/delete requests, approvals inbox, notifications (see `docs/relationship-change-setup.md`).
- **Portal metadata & layouts** — `GET /metadata`, view/list layout personalization endpoints.

URL routing uses query parameters on the UI Page (for example `?page=app`, `?page=ci`, `?page=rel-approvals`, plus `table` / `sys_id` for record deep links).

---

## Prerequisites

- Node.js **20** (recommended)
- npm
- ServiceNow instance with the scoped application installed (or credentials to install via SDK)
- Integration user with rights to deploy the app and run REST/Table API as needed

---

## Setup

From the project root on your machine:

```bash
npm install
```

---

## Configure instance access (local deploy)

Store credentials with the ServiceNow SDK auth helper (recommended). Replace placeholders with your environment values — **do not commit real passwords or tokens**.

```bash
npm run auth
# Equivalent:
# npx now-sdk auth --add https://YOUR_INSTANCE.service-now.com --type basic
```

For scripted or non-interactive installs, you can set:

| Variable | Description |
|----------|-------------|
| `SN_SDK_INSTANCE_URL` | `https://YOUR_INSTANCE.service-now.com` |
| `SN_SDK_USER` | Integration username |
| `SN_SDK_USER_PWD` | Integration password |

Optional legacy/alternate deploy script (`scripts/deploy-direct.mjs`) uses `SN_INSTANCE`, `SN_USER`, and `SN_PASS` if you patch records via Table API instead of `now-sdk install`.

---

## Build and deploy

```bash
# Build Tailwind + Fluent app artifact
npm run build

# Build and push to the authenticated instance
npm run deploy
```

`deploy` runs `npm run build` then `npx now-sdk install`.

---

## Portal URL (after deploy)

Replace `YOUR_INSTANCE` with your ServiceNow host:

```
https://YOUR_INSTANCE.service-now.com/x_citi4_clsa_cmd_0_cmdb_portal.do
```

Example REST base (same host):

```
https://YOUR_INSTANCE.service-now.com/api/x_citi4_clsa_cmd_0/portal/metadata
```

---

## Project structure

```
servicenow-development-clsa/
├── now.config.json                # Scope, app name, SDK paths
├── docs/
│   ├── relationship-change-setup.md
│   └── acl-test-matrix.md
├── scripts/
│   └── deploy-direct.mjs          # Optional Table API patch deploy
├── src/
│   ├── client/                    # React UI
│   │   ├── App.tsx
│   │   ├── api/servicenow.ts
│   │   ├── app/components/
│   │   └── app/utils/
│   └── fluent/                    # ServiceNow Fluent definitions
│       ├── index.now.ts
│       ├── rest-apis/portal.now.ts
│       ├── ui-pages/cmdb-portal.now.ts
│       ├── tables/
│       ├── script-includes/
│       ├── scripts/               # REST route scripts
│       └── notifications/
├── eslint.config.mjs
├── package.json
└── tsconfig.eslint.json
```

Build output is produced under `dist/` by the SDK (not checked into git).

---

## Development notes

- **Run in ServiceNow:** The portal is designed to run on the UI Page inside an authenticated session. There is no separate Vite dev server in this repo; validate changes by deploying to a dev instance or using your org’s SN development workflow.
- **Lint:** `npm run lint` / `npm run lint:fix`
- **Relationship change table:** Defined in Fluent; see `docs/relationship-change-setup.md` for fields, ACL guidance, and validation behavior.
- **ACL testing:** See `docs/acl-test-matrix.md` (update instance URLs there to match your environment; keep secrets out of git).

---

## Security

- Never commit `.env`, passwords, personal access tokens, or production instance URLs if your policy treats them as sensitive.
- Use `now-sdk auth` (or environment variables for automation on your deploy machine) instead of hard-coding credentials in scripts or documentation.
- Rotate any credential that has appeared in chat, logs, or old documentation.

# App & CMDB Portal — ServiceNow React SPA

A modern React application served from **ServiceNow** (Yokohama) as a UI Page, providing an enhanced UI/UX for browsing CMDB Configuration Items, Business Applications, and their relationships.

## Tech Stack

| Tool | Purpose |
|------|---------|
| React 18 + TypeScript | UI framework |
| Vite + vite-plugin-singlefile | Bundles everything into one `index.html` |
| Tailwind CSS | Styling |
| Axios | ServiceNow Table API calls |
| React Router (HashRouter) | Client-side routing (hash-based for SN compatibility) |

---

## Architecture

```
GitHub (source code)
    │
    ▼  push to main
GitHub Actions (build + deploy)
    │
    ▼  PATCH sys_properties via Table API
ServiceNow System Property  ←──  stores compiled HTML
    │
    ▼  GET /api/x_1512879_applic_0/cmdb_portal/app
Scripted REST API endpoint  ──►  returns HTML to browser
    │
    ▼
React SPA runs in browser, calls SN Table API with session token
```

---

## ServiceNow Setup (one-time)

### 1. Create Token Endpoint (Scripted REST API)

Go to: **Scripted REST APIs → New**

| Field | Value |
|-------|-------|
| Name | CMDB Portal |
| API ID | `cmdb_portal` |
| Application scope | `x_1512879_applic_0` |

Add a **GET Resource**:
- Relative path: `/get_token`
- **Uncheck** "Requires Authentication"
- Script:

```javascript
(function process(request, response) {
  response.setContentType('application/json');
  response.setBody({
    sessionToken: gs.getSession().getSessionToken(),
    username: gs.getUserName()
  });
})(request, response);
```

### 2. Create App Serve Endpoint

Add another **GET Resource** to the same API:
- Relative path: `/app`
- **Uncheck** "Requires Authentication"
- Script:

```javascript
(function process(request, response) {
  var html = gs.getProperty('x_1512879_applic_0.cmdb_portal.html');
  response.setContentType('text/html');
  response.setStatus(200);
  response.getStreamWriter().writeString(html);
})(request, response);
```

### 3. Add CORS Rule (for local development)

Go to: **System Web Services → REST → CORS Rules → New**

| Field | Value |
|-------|-------|
| Name | CMDB Portal Local Dev |
| REST API | CMDB Portal |
| Domain | `http://localhost:5173` |
| HTTP methods | GET, POST, PUT, PATCH, DELETE |

---

## Local Development

```bash
# 1. Clone
git clone https://github.com/iamapig7210/servicenow-development.git
cd servicenow-development

# 2. Install
npm install

# 3. Create .env (never commit this)
cp .env.example .env
# Edit .env with your credentials

# 4. Start dev server (proxies /api → your SN instance)
npm run dev
# → http://localhost:5173
```

---

## Deploy to ServiceNow

### Manual deploy

```bash
# Set credentials (or use .env)
export SN_INSTANCE=https://dev204322.service-now.com
export SN_USER=integration.ide
export SN_PASS=your_password

npm run deploy
# = npm run build && node scripts/deploy.mjs
```

### Automatic deploy via GitHub Actions

Every push to `main` triggers the workflow in `.github/workflows/deploy.yml`.

**Required GitHub Secrets** (Settings → Secrets → Actions):

| Secret | Value |
|--------|-------|
| `SN_INSTANCE` | `https://dev204322.service-now.com` |
| `SN_USER` | `integration.ide` |
| `SN_PASS` | `$erviceNow1` |
| `SN_PROPERTY_NAME` | `x_1512879_applic_0.cmdb_portal.html` |

---

## Portal URL (after first deploy)

```
https://dev204322.service-now.com/api/x_1512879_applic_0/cmdb_portal/app
```

---

## Project Structure

```
servicenow-development/
├── .github/workflows/deploy.yml   # CI/CD pipeline
├── scripts/deploy.mjs             # Upload script
├── src/
│   ├── api/servicenow.ts          # Table API wrappers + auth
│   ├── components/                # Reusable UI components
│   ├── hooks/useAuth.ts           # Auth state hook
│   ├── pages/
│   │   ├── Dashboard.tsx          # Overview + stats
│   │   ├── CMDBExplorer.tsx       # CMDB CI table + filters
│   │   ├── Applications.tsx       # Business apps table
│   │   └── RelationshipMap.tsx    # CI relationship explorer
│   ├── types/index.ts             # TypeScript interfaces
│   ├── App.tsx                    # Router + layout
│   ├── main.tsx                   # Bootstrap + auth init
│   └── index.css                  # Tailwind base
├── .env.example                   # Template for local .env
├── .gitignore
├── index.html
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── vite.config.ts
```

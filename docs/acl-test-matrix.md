# ACL Test Matrix — CLSA CMDB Workspace (demo1)

Portal: `https://cheerflowtechnologydemo1.service-now.com/x_citi4_clsa_cmd_0_cmdb_portal.do`

## How to test

1. Log in as each test user below (use separate browser profiles or incognito).
2. Append `&sysparm_debug=security` to the portal URL to trace ACL evaluations in ServiceNow.
3. For each page/section, verify visibility matches the matrix.
4. Full-access users (`admin`, `cmdb_read` or equivalent) should see unchanged behavior vs. pre-ACL work.

## Test users (recommended)

| Role | Purpose |
|------|---------|
| **Full access** | Baseline — all sections visible, all layout fields present |
| **Restricted CMDB read** | Custom role with table/field ACLs limiting CI fields, `task_ci`, or `cmdb_rel_ci` |
| **No business app read** | Deny read on `cmdb_ci_business_app` — App Home 3-level hierarchy hidden |

Create restricted roles in **System Security → ACL** and assign to dedicated test users before running the matrix.

## UX rules (implemented)

| Condition | UI behavior |
|-----------|-------------|
| Table read **403** | Section/tab/card group **hidden** (no banner) |
| Table readable, **zero rows** | Empty-state message shown |
| Field read denied | Column/cell/label **omitted** (layout is candidate only) |

---

## Page × section matrix

| Page | Section / table | Full access | Table 403 | Field ACL (partial) |
|------|-----------------|:-----------:|:---------:|:-------------------:|
| **App Home** | Stats — instances (`cmdb_ci_service_auto` / `cmdb_ci_service`) | Visible | Stat card hidden | N/A |
| | Stats — incidents/changes (`task_ci`) | Visible | Incident/change stat cards hidden | N/A |
| | Hierarchy cards (`cmdb_ci_business_app`, `cmdb_rel_ci`, …) | Visible | Entire hierarchy empty/hidden | Instance card fields filtered |
| | Instance INC/CHG badges (`task_ci`) | Visible if data | Badges absent (count 0) | N/A |
| **App Detail** | Overview panel (app record table) | Visible | Section hidden | Only readable overview fields |
| | Related servers (`cmdb_rel_ci` + CI table) | Visible | Accordion hidden | List columns filtered |
| | Related databases | Visible | Accordion hidden | List columns filtered |
| | Related netgear | Visible | Accordion hidden | List columns filtered |
| | Active incidents (`task_ci`) | Visible | Accordion hidden | Compact/card columns filtered |
| | Change requests (`task_ci`) | Visible | Accordion hidden | Compact/card columns filtered |
| **CI Search** | Inventory pills (per CI class table) | All 4 pills | Denied class pill hidden | N/A |
| | Search tab (per class) | Visible | Tab hidden on 403 | Result columns filtered |
| | All Results merge | Visible | Denied classes excluded from merge | Columns filtered per row set |
| **CI Detail** | Overview form (record table) | Visible | Form block hidden | Only readable fields |
| | Contact form | Visible | Section hidden if record 403 | Only readable fields |
| | Related applications (`cmdb_rel_ci`, …) | Visible | Section hidden | Instance card fields filtered |
| | Incidents tab (`task_ci`) | Visible | Tab + section hidden if both INC/CHG denied | Card columns filtered |
| | Changes tab (`task_ci`) | Visible | Tab hidden if denied | Card columns filtered |
| | Trend chart (`task_ci`) | Visible | Section hidden | N/A |
| | CMDB health (`cmdb_health_result`) | Visible | Section hidden | Card columns filtered |

---

## Regression checklist (full-access user)

- [ ] App Home loads hierarchy with instance cards and stats
- [ ] App Detail overview shows all configured overview fields
- [ ] App Detail related CI accordions expand with data
- [ ] CI Search pills show counts; search returns paginated results
- [ ] CI Detail overview/contact forms show layout fields
- [ ] CI Detail related apps, INC/CR, trend, and health sections render

## Restricted-user spot checks

- [ ] Remove a sensitive field ACL (e.g. `cmdb_ci_server.ip_address`) — column disappears from CI Search and detail form
- [ ] Deny `task_ci` read — INC/CR sections and trend hidden on CI Detail; incident stat hidden on App Home
- [ ] Deny `cmdb_health_result` read — health section hidden on CI Detail
- [ ] Deny `cmdb_rel_ci` read — related applications hidden on CI Detail; App Detail infrastructure lists hidden

---

## API layer notes

- All data queries use `queryTableWithAccess()` where ACL-aware behavior is required.
- **403** → `access: 'denied'`
- Other errors → `access: 'error'` (empty state, section remains unless explicitly hidden)
- Legacy `queryTable()` retained for metadata (`sys_ui_*`, `sys_properties`) where broader read is expected.

Phase 2 (deferred): server ACL probe API for edit-mode `canWrite` checks.

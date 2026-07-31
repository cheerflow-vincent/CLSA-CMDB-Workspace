# Relationship Change table setup (ServiceNow)

The table is defined in Fluent and deploys with the app:

- [`src/fluent/tables/relationship-change.now.ts`](../src/fluent/tables/relationship-change.now.ts)

Run `npm run deploy` to create/update the table on your instance.

## Table

**Name:** `x_citi4_clsa_cmd_0_relationship_change`  
**Label:** Relationship Change  
**Extends:** None  
**Web service access:** enabled (`allowWebServiceAccess: true`)

## Fields

| Element | Type | Purpose |
|---------|------|---------|
| `action` | choice | `create`, `delete` |
| `state` | choice | `pending_approval`, `completed`, `rejected`, `cancelled` |
| `relationship` | reference → `cmdb_rel_ci` | Relationship row |
| `rel_type` | string (255) | Exact relationship type name |
| `parent_ci` | reference → `cmdb_ci` | Parent CI |
| `child_ci` | reference → `cmdb_ci` | Child CI |
| `source_ci` | reference → `cmdb_ci` | Center app (editor context) |
| `target_ci` | reference → `cmdb_ci` | Remote app (approver lookup) |
| `direction` | choice | `upstream`, `downstream`, `bidirectional` |
| `requested_by` | reference → `sys_user` | Requester |
| `requested_at` | datetime | Request timestamp |
| `approver` | reference → `sys_user` | Delete approver |
| `approval_comments` | string (1000) | Approve/reject/cancel comments |
| `completed_at` | datetime | Completion timestamp |

## ACLs (recommended after deploy)

- **read:** users with CMDB workspace role
- **create:** same (also created via scripted REST)
- **write:** approver on record, requester for cancel while pending, admin
- **delete:** admin only

## Duplicate guards

Server-side validation is implemented in [`relationship-change.js`](../src/fluent/scripts/relationship-change.js) (REST POST handler).

Optional Business Rule on insert (same logic as below) can be added manually in ServiceNow if you want protection outside REST as well.

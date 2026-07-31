import '@servicenow/sdk/global'
import {
  Table,
  StringColumn,
  ReferenceColumn,
  DateTimeColumn,
} from '@servicenow/sdk/core'

export const x_citi4_clsa_cmd_0_relationship_change = Table({
  name: 'x_citi4_clsa_cmd_0_relationship_change',
  label: 'Relationship Change',
  display: 'rel_type',
  audit: true,
  allowWebServiceAccess: true,
  actions: ['read', 'create', 'update', 'delete'],
  schema: {
    action: StringColumn({
      label: 'Action',
      mandatory: true,
      dropdown: 'dropdown_without_none',
      choices: {
        create: 'Create',
        delete: 'Delete',
      },
    }),
    state: StringColumn({
      label: 'State',
      mandatory: true,
      dropdown: 'dropdown_without_none',
      choices: {
        pending_approval: 'Pending approval',
        completed: 'Completed',
        rejected: 'Rejected',
        cancelled: 'Cancelled',
      },
    }),
    relationship: ReferenceColumn({
      label: 'Relationship',
      referenceTable: 'cmdb_rel_ci',
    }),
    rel_type: StringColumn({
      label: 'Relationship type',
      maxLength: 255,
    }),
    parent_ci: ReferenceColumn({
      label: 'Parent CI',
      referenceTable: 'cmdb_ci',
    }),
    child_ci: ReferenceColumn({
      label: 'Child CI',
      referenceTable: 'cmdb_ci',
    }),
    source_ci: ReferenceColumn({
      label: 'Source CI',
      referenceTable: 'cmdb_ci',
    }),
    target_ci: ReferenceColumn({
      label: 'Target CI',
      referenceTable: 'cmdb_ci',
    }),
    direction: StringColumn({
      label: 'Direction',
      dropdown: 'dropdown_without_none',
      choices: {
        upstream: 'Upstream',
        downstream: 'Downstream',
        bidirectional: 'Bi-directional',
      },
    }),
    requested_by: ReferenceColumn({
      label: 'Requested by',
      referenceTable: 'sys_user',
    }),
    requested_at: DateTimeColumn({
      label: 'Requested at',
    }),
    approver: ReferenceColumn({
      label: 'Approver',
      referenceTable: 'sys_user',
    }),
    approval_comments: StringColumn({
      label: 'Approval comments',
      maxLength: 1000,
    }),
    completed_at: DateTimeColumn({
      label: 'Completed at',
    }),
  },
})

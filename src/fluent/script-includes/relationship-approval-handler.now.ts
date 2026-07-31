import '@servicenow/sdk/global'
import { ScriptInclude } from '@servicenow/sdk/core'

export const relationship_approval_handler = ScriptInclude({
  $id: Now.ID['relationship-approval-handler'],
  name: 'RelationshipApprovalHandler',
  active: true,
  description: 'OOTB sysapproval_approver queries and decisions for relationship changes',
  script: Now.include('../scripts/relationship-approval-handler.js'),
})

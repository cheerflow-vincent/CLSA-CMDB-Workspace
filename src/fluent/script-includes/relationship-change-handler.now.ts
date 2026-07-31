import '@servicenow/sdk/global'
import { ScriptInclude } from '@servicenow/sdk/core'

export const relationship_change_handler = ScriptInclude({
  $id: Now.ID['relationship-change-handler'],
  name: 'RelationshipChangeHandler',
  active: true,
  description: 'Shared handler for relationship change REST endpoints',
  script: Now.include('../scripts/relationship-change-handler.js'),
})

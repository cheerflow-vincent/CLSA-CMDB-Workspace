import '@servicenow/sdk/global'
import { ScriptInclude } from '@servicenow/sdk/core'

export const application_home_handler = ScriptInclude({
  $id: Now.ID['application-home-handler'],
  name: 'ApplicationHomeHandler',
  active: true,
  description: 'App Home filter resolve, family paging, and hierarchy mapping',
  script: Now.include('../scripts/application-home-handler.js'),
})

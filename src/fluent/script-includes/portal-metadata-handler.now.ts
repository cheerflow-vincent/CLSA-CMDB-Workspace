import '@servicenow/sdk/global'
import { ScriptInclude } from '@servicenow/sdk/core'

export const portal_metadata_handler = ScriptInclude({
  $id: Now.ID['portal-metadata-handler'],
  name: 'PortalMetadataHandler',
  active: true,
  description: 'Portal metadata broker — choices, properties, and UI view layouts',
  script: Now.include('../scripts/portal-metadata-handler.js'),
})

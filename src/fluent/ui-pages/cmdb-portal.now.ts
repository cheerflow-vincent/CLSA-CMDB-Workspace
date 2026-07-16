import '@servicenow/sdk/global'
import { UiPage } from '@servicenow/sdk/core'
import page from '../../client/index.html'

export const cmdb_portal = UiPage({
  $id: Now.ID['cmdb-portal'],
  endpoint: 'x_citi4_clsa_cmd_0_cmdb_portal.do',
  description: 'CMDB Portal — Application and CI Management',
  html: page,
  direct: true,
})

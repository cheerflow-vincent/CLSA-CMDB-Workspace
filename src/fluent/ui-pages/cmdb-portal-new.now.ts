import '@servicenow/sdk/global'
import { UiPage } from '@servicenow/sdk/core'
import page from '../../client/index.html'

export const cmdb_portal_new = UiPage({
  $id: Now.ID['cmdb-portal-new'],
  endpoint: 'x_citi4_clsa_cmd_0_cmdb_portal_v2.do',
  description: 'CMDB Portal — Application and CI Management (Portal)',
  html: page,
  direct: true,
})

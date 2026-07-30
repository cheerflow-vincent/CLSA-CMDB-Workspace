import '@servicenow/sdk/global'
import { RestApi } from '@servicenow/sdk/core'

export const portal_rest_api = RestApi({
  $id: Now.ID['portal-rest-api'],
  name: 'CLSA CMDB Portal API',
  serviceId: 'portal',
  active: true,
  consumes: 'application/json',
  produces: 'application/json',
  shortDescription: 'Portal backend endpoints for ACL-aware record editing',
  routes: [
    {
      $id: Now.ID['field-access-route'],
      name: 'Field access probe',
      method: 'GET',
      path: '/field_access',
      authentication: true,
      authorization: true,
      active: true,
      produces: 'application/json',
      parameters: [
        { $id: Now.ID['field-access-param-table'], name: 'table', required: true, shortDescription: 'Table name' },
        { $id: Now.ID['field-access-param-sys-id'], name: 'sys_id', required: true, shortDescription: 'Record sys_id' },
        { $id: Now.ID['field-access-param-fields'], name: 'fields', required: true, shortDescription: 'Comma-separated field names' },
      ],
      script: Now.include('../scripts/field-access.js'),
    },
  ],
})

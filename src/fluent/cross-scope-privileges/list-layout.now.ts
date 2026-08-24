import '@servicenow/sdk/global'
import { CrossScopePrivilege } from '@servicenow/sdk/core'

const GLOBAL = 'global'

/** Personal list layout: read shared + user sys_ui_list records. */
export const cross_read_sys_ui_list = CrossScopePrivilege({
  $id: Now.ID['cross-read-sys-ui-list'],
  status: 'allowed',
  operation: 'read',
  targetName: 'sys_ui_list',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

export const cross_create_sys_ui_list = CrossScopePrivilege({
  $id: Now.ID['cross-create-sys-ui-list'],
  status: 'allowed',
  operation: 'create',
  targetName: 'sys_ui_list',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

export const cross_write_sys_ui_list = CrossScopePrivilege({
  $id: Now.ID['cross-write-sys-ui-list'],
  status: 'allowed',
  operation: 'write',
  targetName: 'sys_ui_list',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

export const cross_delete_sys_ui_list = CrossScopePrivilege({
  $id: Now.ID['cross-delete-sys-ui-list'],
  status: 'allowed',
  operation: 'delete',
  targetName: 'sys_ui_list',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

/** List column elements for personal layouts. */
export const cross_read_sys_ui_list_element = CrossScopePrivilege({
  $id: Now.ID['cross-read-sys-ui-list-element'],
  status: 'allowed',
  operation: 'read',
  targetName: 'sys_ui_list_element',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

export const cross_create_sys_ui_list_element = CrossScopePrivilege({
  $id: Now.ID['cross-create-sys-ui-list-element'],
  status: 'allowed',
  operation: 'create',
  targetName: 'sys_ui_list_element',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

export const cross_write_sys_ui_list_element = CrossScopePrivilege({
  $id: Now.ID['cross-write-sys-ui-list-element'],
  status: 'allowed',
  operation: 'write',
  targetName: 'sys_ui_list_element',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

export const cross_delete_sys_ui_list_element = CrossScopePrivilege({
  $id: Now.ID['cross-delete-sys-ui-list-element'],
  status: 'allowed',
  operation: 'delete',
  targetName: 'sys_ui_list_element',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

/** Resolve view sys_id when shared list is unavailable. */
export const cross_read_sys_ui_view = CrossScopePrivilege({
  $id: Now.ID['cross-read-sys-ui-view'],
  status: 'allowed',
  operation: 'read',
  targetName: 'sys_ui_view',
  targetScope: GLOBAL,
  targetType: 'sys_db_object',
})

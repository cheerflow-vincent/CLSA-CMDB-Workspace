/** Search config for application instance pickers in relationship edit. */

export interface ApplicationReferenceSearch {
  table: string;
  referenceQuery: string;
}

/**
 * 2-level hierarchy: cmdb_ci_service where u_service_type=instance
 * 3-level hierarchy: cmdb_ci_service_auto and child classes (via cmdb_ci + INSTANCEOF)
 */
export function getApplicationReferenceSearch(
  hierarchyMode: boolean,
  excludeSysId?: string,
): ApplicationReferenceSearch {
  const filters: string[] = [];

  if (hierarchyMode) {
    filters.push('sys_class_nameINSTANCEOFcmdb_ci_service_auto');
  } else {
    filters.push('u_service_type=instance');
  }

  if (excludeSysId) {
    filters.push(`sys_id!=${excludeSysId}`);
  }

  return {
    table: hierarchyMode ? 'cmdb_ci' : 'cmdb_ci_service',
    referenceQuery: filters.join('^'),
  };
}

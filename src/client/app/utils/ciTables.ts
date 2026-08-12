import { queryTable } from '../../api/servicenow';
import { raw } from './viewFields';

/** CI Search base tables (V2 tabs + All Results parent). */
export const CI_SEARCH_BASE_TABLES = [
  'cmdb_ci_server',
  'cmdb_ci_netgear',
  'cmdb_ci_db_instance',
  'cmdb_ci_network_link',
] as const;

export const CI_ALL_TABLE = 'cmdb_ci';

export const CI_OVERVIEW_VIEW = 'CLSA CMDB Workspace Overview';
export const CI_CONTACT_VIEW = 'CLSA CMDB Workspace Contact';

/**
 * Map a record table to the CI-search parent used for view/layout fallbacks.
 * 1. Exact match on a CI Search base table
 * 2. Walk sys_db_object.super_class chain toward a base table or cmdb_ci
 * 3. Fallback → cmdb_ci
 */
export async function resolveCiSearchParentTable(recordTable: string): Promise<string> {
  if ((CI_SEARCH_BASE_TABLES as readonly string[]).includes(recordTable)) {
    return recordTable;
  }

  try {
    let current = recordTable;
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      if (seen.has(current)) break;
      seen.add(current);
      if ((CI_SEARCH_BASE_TABLES as readonly string[]).includes(current)) {
        return current;
      }
      if (current === CI_ALL_TABLE) return CI_ALL_TABLE;

      const { result } = await queryTable<{ 'super_class.name': unknown }>({
        table: 'sys_db_object',
        query: `name=${current}`,
        fields: ['super_class.name'],
        limit: 1,
      });
      const parent = result[0] ? raw(result[0]['super_class.name']) : '';
      if (!parent || parent === current) break;
      current = parent;
    }
  } catch {
    // fall through
  }

  return CI_ALL_TABLE;
}

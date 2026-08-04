import { queryTableWithAccess, type TableAccess } from '../../api/servicenow';
import { filterColumnsByRecords } from './acl';
import { loadListFields, raw, str, type ViewField } from './viewFields';
import { fetchCITaskFlagCounts } from './relatedCIFlags';

export const LIST_VIEW_TITLE = 'CLSA CMDB Workspace Overview';
export const RELATED_CI_PAGE_SIZE = 10;

export interface RelatedCIConfig {
  relType: string;
  baseClass: string;
  /** Parent CI table used to fetch record field values (includes subclasses). */
  ciTable: string;
  listTitle: string;
  defaultColumns: ViewField[];
}

export interface RelatedCIRow {
  sysId: string;
  sysClass: string;
  values: Record<string, string>;
  incidents: number;
  changes: number;
}

export interface RelatedCIPage {
  rows: RelatedCIRow[];
  columns: ViewField[];
  totalCount: number;
  access: TableAccess;
}

export const SERVER_REL_CONFIG: RelatedCIConfig = {
  relType: 'Runs on::Runs',
  baseClass: 'cmdb_ci_server',
  ciTable: 'cmdb_ci_server',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'name',        label: 'Name'        },
    { element: 'environment', label: 'Environment' },
    { element: 'os',          label: 'OS'          },
    { element: 'location',    label: 'Location'    },
  ],
};

export const DATABASE_REL_CONFIG: RelatedCIConfig = {
  relType: 'Depends on::Used by',
  baseClass: 'cmdb_ci_db_instance',
  ciTable: 'cmdb_ci_db_instance',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'name',        label: 'Name'        },
    { element: 'version',     label: 'Version'     },
    { element: 'environment', label: 'Environment' },
    { element: 'location',    label: 'Location'    },
  ],
};

export const NETGEAR_REL_CONFIG: RelatedCIConfig = {
  relType: 'Runs on::Runs',
  baseClass: 'cmdb_ci_netgear',
  ciTable: 'cmdb_ci_netgear',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'name',        label: 'Name'        },
    { element: 'environment', label: 'Environment' },
    { element: 'model_id',    label: 'Model'       },
    { element: 'location',    label: 'Location'    },
  ],
};

function buildRelQuery(appSysId: string, config: RelatedCIConfig): string {
  return `type.name=${config.relType}^parent.sys_id=${appSysId}^child.sys_class_nameINSTANCEOF${config.baseClass}`;
}

export async function fetchRelatedCICount(
  appSysId: string,
  config: RelatedCIConfig,
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!appSysId) return { totalCount: 0, access: 'ok' };
  const { totalCount, access } = await queryTableWithAccess({
    table: 'cmdb_rel_ci',
    query: buildRelQuery(appSysId, config),
    fields: ['sys_id'],
    limit: 1,
  });
  return { totalCount, access };
}

export async function fetchRelatedCIPage(
  appSysId: string,
  config: RelatedCIConfig,
  page: number,
  pageSize = RELATED_CI_PAGE_SIZE,
): Promise<RelatedCIPage> {
  const layoutColumns = await loadListFields(
    config.baseClass,
    config.listTitle,
    config.defaultColumns,
  );

  if (!appSysId) {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'ok' };
  }

  const { result: relRows = [], totalCount, access: relAccess } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'cmdb_rel_ci',
    query: `${buildRelQuery(appSysId, config)}^ORDERBYchild.name`,
    fields: ['child.sys_id', 'child.name', 'child.sys_class_name'],
    limit: pageSize,
    offset: page * pageSize,
    displayValue: 'all',
  });

  if (relAccess === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: relAccess };
  }

  const seen = new Set<string>();
  const childIds: string[] = [];
  const classById = new Map<string, string>();

  for (const r of relRows) {
    const id = raw(r['child.sys_id']);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    childIds.push(id);
    classById.set(id, raw(r['child.sys_class_name']) || config.baseClass);
  }

  if (!childIds.length) {
    return { rows: [], columns: layoutColumns, totalCount, access: relAccess };
  }

  const fields = [...new Set(['sys_id', 'name', 'sys_class_name', ...layoutColumns.map(c => c.element)])];
  const { result: ciRows = [], access: ciAccess } = await queryTableWithAccess<Record<string, unknown>>({
    table: config.ciTable,
    query: `sys_idIN${childIds.join(',')}`,
    fields,
    limit: childIds.length + 5,
    displayValue: true,
  });

  if (ciAccess === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount, access: 'denied' };
  }

  const access: TableAccess = relAccess === 'error' || ciAccess === 'error' ? 'error' : 'ok';

  const columns = filterColumnsByRecords(layoutColumns, ciRows);

  const ciById = new Map(ciRows.map(r => [raw(r.sys_id), r]));

  const rows: RelatedCIRow[] = childIds.map(id => {
    const rec = ciById.get(id);
    const sysClass = rec
      ? (raw(rec.sys_class_name) || classById.get(id) || config.baseClass)
      : (classById.get(id) || config.baseClass);
    const values: Record<string, string> = {};
    for (const col of columns) {
      if (rec && col.element in rec) {
        values[col.element] = str(rec[col.element]);
      }
    }
    if (!values.name && rec && 'name' in rec) values.name = str(rec.name);
    return { sysId: id, sysClass, values, incidents: 0, changes: 0 };
  });

  const flagCounts = await fetchCITaskFlagCounts(childIds);
  for (const row of rows) {
    const flags = flagCounts.get(row.sysId);
    if (flags) {
      row.incidents = flags.incidents;
      row.changes = flags.changes;
    }
  }

  return { rows, columns, totalCount, access };
}

import { queryTable } from '../../api/servicenow';
import { loadListFields, raw, str, type ViewField } from './viewFields';

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
}

export interface RelatedCIPage {
  rows: RelatedCIRow[];
  columns: ViewField[];
  totalCount: number;
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

function buildRelQuery(appSysId: string, config: RelatedCIConfig): string {
  return `type.name=${config.relType}^parent.sys_id=${appSysId}^child.sys_class_nameINSTANCEOF${config.baseClass}`;
}

export async function fetchRelatedCICount(
  appSysId: string,
  config: RelatedCIConfig,
): Promise<number> {
  if (!appSysId) return 0;
  const { totalCount } = await queryTable({
    table: 'cmdb_rel_ci',
    query: buildRelQuery(appSysId, config),
    fields: ['sys_id'],
    limit: 1,
  });
  return totalCount;
}

export async function fetchRelatedCIPage(
  appSysId: string,
  config: RelatedCIConfig,
  page: number,
  pageSize = RELATED_CI_PAGE_SIZE,
): Promise<RelatedCIPage> {
  const columns = await loadListFields(
    config.baseClass,
    config.listTitle,
    config.defaultColumns,
  );

  if (!appSysId) {
    return { rows: [], columns, totalCount: 0 };
  }

  const { result: relRows = [], totalCount } = await queryTable<Record<string, unknown>>({
    table: 'cmdb_rel_ci',
    query: `${buildRelQuery(appSysId, config)}^ORDERBYchild.name`,
    fields: ['child.sys_id', 'child.name', 'child.sys_class_name'],
    limit: pageSize,
    offset: page * pageSize,
    displayValue: 'all',
  });

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
    return { rows: [], columns, totalCount };
  }

  const fields = [...new Set(['sys_id', 'name', 'sys_class_name', ...columns.map(c => c.element)])];
  const { result: ciRows = [] } = await queryTable<Record<string, unknown>>({
    table: config.ciTable,
    query: `sys_idIN${childIds.join(',')}`,
    fields,
    limit: childIds.length + 5,
    displayValue: true,
  });

  const ciById = new Map(ciRows.map(r => [raw(r.sys_id), r]));

  const rows: RelatedCIRow[] = childIds.map(id => {
    const rec = ciById.get(id);
    const sysClass = rec
      ? (raw(rec.sys_class_name) || classById.get(id) || config.baseClass)
      : (classById.get(id) || config.baseClass);
    const values: Record<string, string> = {};
    for (const col of columns) {
      values[col.element] = rec ? str(rec[col.element]) : '';
    }
    if (!values.name && rec) values.name = str(rec.name);
    return { sysId: id, sysClass, values };
  });

  return { rows, columns, totalCount };
}

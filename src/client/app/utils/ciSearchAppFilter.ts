import { queryTableWithAccess, type TableAccess } from '../../api/servicenow';
import {
  chunkedINParallel,
  resolveInstanceIdsForFamily,
  CHUNK_SIZE,
} from './appHomeLoader';
import {
  INFRA_REL_CONFIGS,
  type RelatedCIConfig,
} from './relatedCIs';
import { raw } from './viewFields';
import { buildMultiFieldAndLikeQuery, tokenizeSearchTerms, appendEncodedQuery, buildColumnFiltersQuery, escapeLikeTerm, joinOrEncodedQueries, appendOrderByToQuery, DEFAULT_COLUMN_SORT } from './searchQuery';
import { CI_INVENTORY_TABS, type CISearchInventoryTab } from './ciSearchTabs';

export const CI_INVENTORY_CLASSES = [
  'cmdb_ci_server',
  'cmdb_ci_netgear',
  'cmdb_ci_db_instance',
  'cmdb_ci_network_link',
] as const;

export type AppFilterKind = 'family' | 'instance';

export interface AppFilterSelection {
  sysId: string;
  name: string;
  kind: AppFilterKind;
}

export interface AppRelatedIdsByTab {
  servers: string[];
  switches: string[];
  databases: string[];
  network_links: string[];
}

export interface AppFamilyInstanceOption {
  sysId: string;
  name: string;
  kind: AppFilterKind;
}

export const EMPTY_RELATED: AppRelatedIdsByTab = {
  servers: [],
  switches: [],
  databases: [],
  network_links: [],
};

const TAB_TO_CI_TYPE: Record<keyof AppRelatedIdsByTab, RelatedCIConfig['ciType']> = {
  servers: 'server',
  switches: 'netgear',
  databases: 'database',
  network_links: 'network_link',
};

function infraSideField(config: RelatedCIConfig): 'child.sys_id' | 'parent.sys_id' {
  return (config.appRole ?? 'parent') === 'child' ? 'parent.sys_id' : 'child.sys_id';
}

function appSideInField(config: RelatedCIConfig): 'parent.sys_id' | 'child.sys_id' {
  return (config.appRole ?? 'parent') === 'child' ? 'child.sys_id' : 'parent.sys_id';
}

function relExtraQuery(config: RelatedCIConfig): string {
  const infraSide = (config.appRole ?? 'parent') === 'child' ? 'parent' : 'child';
  return `type.name=${config.relType}^${infraSide}.sys_class_nameINSTANCEOF${config.baseClass}`;
}

export function familyKindLabel(hierarchyMode: boolean): string {
  return hierarchyMode ? 'Business App' : 'App Family';
}

export async function searchAppFamilyInstanceOptions(
  term: string,
  hierarchyMode: boolean,
  limit = 8,
): Promise<AppFamilyInstanceOption[]> {
  const q = escapeLikeTerm(term.trim());
  if (q.length < 2) return [];

  const familyTable = hierarchyMode ? 'cmdb_ci_business_app' : 'cmdb_ci_service';
  const familyQuery = hierarchyMode
    ? `nameLIKE${q}^ORDERBYname`
    : `u_service_type=service^nameLIKE${q}^ORDERBYname`;

  const instanceTable = hierarchyMode ? 'cmdb_ci_service_auto' : 'cmdb_ci_service';
  const instanceQuery = hierarchyMode
    ? `nameLIKE${q}^ORDERBYname`
    : `u_service_type=instance^nameLIKE${q}^ORDERBYname`;

  const perTableLimit = Math.ceil(limit / 2) + 1;

  const [familyRes, instanceRes] = await Promise.all([
    queryTableWithAccess<{ sys_id: string; name: string }>({
      table: familyTable,
      query: familyQuery,
      fields: ['sys_id', 'name'],
      limit: perTableLimit,
      orderBy: 'name',
    }),
    queryTableWithAccess<{ sys_id: string; name: string }>({
      table: instanceTable,
      query: instanceQuery,
      fields: ['sys_id', 'name'],
      limit: perTableLimit,
      orderBy: 'name',
    }),
  ]);

  const options: AppFamilyInstanceOption[] = [];

  for (const row of familyRes.result ?? []) {
    options.push({
      sysId: raw(row.sys_id),
      name: raw(row.name) || raw(row.sys_id),
      kind: 'family',
    });
  }

  for (const row of instanceRes.result ?? []) {
    options.push({
      sysId: raw(row.sys_id),
      name: raw(row.name) || raw(row.sys_id),
      kind: 'instance',
    });
  }

  options.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return options.slice(0, limit);
}

export async function resolveInstanceIdsForAppSelection(
  selection: AppFilterSelection,
  hierarchyMode: boolean,
): Promise<string[]> {
  if (!selection.sysId) return [];
  if (selection.kind === 'instance') return [selection.sysId];
  return resolveInstanceIdsForFamily(selection.sysId, hierarchyMode);
}

async function fetchInfraIdsForConfig(
  instanceIds: string[],
  config: RelatedCIConfig,
): Promise<{ ids: string[]; access: TableAccess }> {
  if (!instanceIds.length) return { ids: [], access: 'ok' };

  const inField = appSideInField(config);
  const sideField = infraSideField(config);
  const { rows, access } = await chunkedINParallel<Record<string, unknown>>(
    'cmdb_rel_ci',
    inField,
    instanceIds,
    relExtraQuery(config),
    [sideField],
    5000,
    { displayValue: 'all' },
  );

  if (access === 'denied') return { ids: [], access: 'denied' };

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of rows) {
    const id = raw(row[sideField]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return { ids, access };
}

export async function fetchRelatedInfraCiIdsByTable(
  instanceIds: string[],
): Promise<{ idsByTab: AppRelatedIdsByTab; access: TableAccess }> {
  if (!instanceIds.length) {
    return { idsByTab: { ...EMPTY_RELATED }, access: 'ok' };
  }

  const results = await Promise.all(
    INFRA_REL_CONFIGS.map(async config => {
      const result = await fetchInfraIdsForConfig(instanceIds, config);
      return { config, ...result };
    }),
  );

  let access: TableAccess = 'ok';
  const idsByTab: AppRelatedIdsByTab = { ...EMPTY_RELATED };

  for (const { config, ids, access: cfgAccess } of results) {
    if (cfgAccess === 'denied') access = 'denied';
    else if (cfgAccess === 'error' && access !== 'denied') access = 'error';

    const tab = (Object.entries(TAB_TO_CI_TYPE) as [keyof AppRelatedIdsByTab, RelatedCIConfig['ciType']][])
      .find(([, ciType]) => ciType === config.ciType)?.[0];
    if (tab) idsByTab[tab] = ids;
  }

  return { idsByTab, access };
}

export const EMPTY_CI_QUERY = 'sys_id=-1';

export function buildAppScopedCiQuery(
  relatedIds: string[],
  keyword: string,
  ciFilter: string,
  searchFields: string[],
  columnFilterPart = '',
): string {
  if (!relatedIds.length) return EMPTY_CI_QUERY;

  const tokens = tokenizeSearchTerms(keyword);
  const fields = searchFields.length ? searchFields : ['name'];
  const keywordPart = tokens.length ? buildMultiFieldAndLikeQuery(fields, tokens) : '';
  const idPart = `sys_idIN${relatedIds.slice(0, CHUNK_SIZE).join(',')}`;
  const base = [idPart, ciFilter, keywordPart].filter(Boolean).join('^');
  return appendEncodedQuery(base, columnFilterPart);
}

/** Combined encoded query for the All Results tab against cmdb_ci. */
export function buildAllTabSnQuery(
  snQueriesByTab: Record<CISearchInventoryTab, string>,
  colFilters: Record<string, string>,
  allowedFieldsByTab: Record<CISearchInventoryTab, string[]>,
  appFilterActive: boolean,
): string {
  const tabTable: Record<CISearchInventoryTab, string> = {
    servers: 'cmdb_ci_server',
    switches: 'cmdb_ci_netgear',
    databases: 'cmdb_ci_db_instance',
    network_links: 'cmdb_ci_network_link',
  };
  const branches = CI_INVENTORY_TABS.map(({ tab }) => {
    let base = snQueriesByTab[tab];
    if (!appFilterActive) {
      base = appendEncodedQuery(`sys_class_nameINSTANCEOF${tabTable[tab]}`, base);
    }
    return buildResultSnQueryForTab(base, colFilters, allowedFieldsByTab[tab]);
  }).filter(Boolean);
  return joinOrEncodedQueries(branches);
}

/** Append column header filters to a base encoded query. */
export function buildResultSnQueryForTab(
  baseQuery: string,
  filters: Record<string, string>,
  allowedFields: string[],
): string {
  return appendEncodedQuery(baseQuery, buildColumnFiltersQuery(filters, allowedFields));
}

export function buildSnQueriesByTab(
  idsByTab: AppRelatedIdsByTab | null,
  keyword: string,
  ciFilter: string,
  searchFields: string[],
  appFilterActive: boolean,
): Record<CISearchInventoryTab, string> {
  const keywordOnly = (() => {
    const tokens = tokenizeSearchTerms(keyword);
    if (!tokens.length) return ciFilter;
    const fields = searchFields.length ? searchFields : ['name'];
    const likeGroup = buildMultiFieldAndLikeQuery(fields, tokens);
    return likeGroup ? `${likeGroup}^${ciFilter}` : ciFilter;
  })();

  if (!appFilterActive || !idsByTab) {
    return {
      servers: keywordOnly,
      switches: keywordOnly,
      databases: keywordOnly,
      network_links: keywordOnly,
    };
  }

  const buildForTab = (tab: CISearchInventoryTab): string => {
    return buildAppScopedCiQuery(idsByTab[tab], keyword, ciFilter, searchFields);
  };

  return {
    servers: buildForTab('servers'),
    switches: buildForTab('switches'),
    databases: buildForTab('databases'),
    network_links: buildForTab('network_links'),
  };
}

export interface FetchOptions {
  keyword: string;
  ciFilter: string;
  searchFields: string[];
  fields: string[];
  columnFilterPart?: string;
  sort?: typeof DEFAULT_COLUMN_SORT;
}

/** Fetch all CIs matching scoped query when related ID count exceeds single IN chunk. */
export async function fetchAllScopedCiRows<T extends Record<string, unknown>>(
  table: string,
  relatedIds: string[],
  options: FetchOptions,
): Promise<{ rows: T[]; access: TableAccess }> {
  const { keyword, ciFilter, searchFields, fields, columnFilterPart = '', sort = DEFAULT_COLUMN_SORT } = options;
  if (!relatedIds.length) return { rows: [], access: 'ok' };

  if (relatedIds.length <= CHUNK_SIZE) {
    const query = buildAppScopedCiQuery(relatedIds, keyword, ciFilter, searchFields, columnFilterPart);
    const { result, access } = await queryTableWithAccess<T>({
      table,
      query: appendOrderByToQuery(query, sort),
      fields,
      limit: relatedIds.length + 5,
      displayValue: true,
    });
    return { rows: result ?? [], access };
  }

  const all: T[] = [];
  let access: TableAccess = 'ok';
  for (let i = 0; i < relatedIds.length; i += CHUNK_SIZE) {
    const chunk = relatedIds.slice(i, i + CHUNK_SIZE);
    const query = buildAppScopedCiQuery(chunk, keyword, ciFilter, searchFields, columnFilterPart);
    const { result, access: chunkAccess } = await queryTableWithAccess<T>({
      table,
      query: appendOrderByToQuery(query, sort),
      fields,
      limit: chunk.length + 5,
      displayValue: true,
    });
    if (chunkAccess === 'denied') return { rows: [], access: 'denied' };
    if (chunkAccess === 'error') access = 'error';
    all.push(...(result ?? []));
  }

  const sortField = sort.field || 'name';
  const dir = sort.direction === 'desc' ? -1 : 1;
  const sortStr = (x: unknown): string =>
    typeof x === 'object' && x !== null ? JSON.stringify(x) : String((x ?? '') as string | number | boolean);
  all.sort((a, b) => {
    const cmp = sortStr(a[sortField]).localeCompare(
      sortStr(b[sortField]),
      undefined,
      { sensitivity: 'base', numeric: true },
    );
    return cmp * dir;
  });
  return { rows: all, access };
}

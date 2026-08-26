import {
  queryTableWithAccess,
  fetchApplicationHomePage,
  type ApplicationHomeRequest,
  type ThreeLevelMappingDto,
  type TwoLevelMappingDto,
  type TableAccess,
} from '../../api/servicenow';
import { filterColumnsByProbe } from './acl';
import { fetchCITaskFlagCounts, type CITaskFlagCounts } from './relatedCIFlags';
import {
  CHANGE_TASK_CONFIG,
  INCIDENT_TASK_CONFIG,
  countDistinctRelatedTasksFromBranches,
  taskCiQuery,
  type RelatedTaskConfig,
} from './relatedTasks';
import { loadListFields, raw, str, type ViewField } from './viewFields';
import type { IncidentRecord, ChangeRecord } from '../components/FlagDetailPanel';

export const CHUNK_SIZE = 150;
/** cmdb_rel_ci IN lists hit URL/query length limits on some instances (use smaller slices). */
export const REL_CI_IN_CHUNK_SIZE = 50;
export const CHUNK_CONCURRENCY = 5;
export const FAMILY_PAGE_SIZE = 50;
export const VIEW_TITLE = 'CLSA CMDB Workspace';
export const SEARCH_DEBOUNCE_MS = 500;

/** Synthetic family for instances with no app-family / business-app relationship. */
export const OTHERS_FAMILY_ID = '__others__';
export const OTHERS_SERVICE_ID = '__others_svc__';
export const OTHERS_FAMILY_NAME = '[Others]';

export const DEFAULT_VIEW_FIELDS: ViewField[] = [
  { element: 'department',         label: 'Department' },
  { element: 'environment',        label: 'Environment' },
  { element: 'operational_status', label: 'Operational Status' },
  { element: 'owned_by',           label: 'Owner' },
  { element: 'support_group',      label: 'Support Group' },
];

export const CATALOG_FIELDS = [
  'sys_id', 'name', 'sys_class_name', 'operational_status', 'environment',
  'department', 'u_tier', 'owned_by', 'support_group',
];

export interface LiveInstance {
  sys_id: string;
  name: string;
  sys_class_name: string;
  operational_status: string;
  environment: string;
  fieldValues: Record<string, string>;
  viewFields: ViewField[];
  incidentRecords: IncidentRecord[];
  changeRecords: ChangeRecord[];
  incidents: number;
  changes: number;
}

import {
  type LiveFilterCriteria,
  type SidebarFilterState,
  type ResolvedAppHomeFilter,
  mergeFilterCriteria,
  hasActiveLiveFilters,
  sidebarFiltersEqual,
  buildRelCiInstanceEdgeQuery,
  buildInstanceFilterQuery,
} from './appHomeFilterConfig';

export type { LiveFilterCriteria, SidebarFilterState as SidebarFilterCriteria, ResolvedAppHomeFilter };
export {
  mergeFilterCriteria,
  hasActiveLiveFilters,
  sidebarFiltersEqual,
  buildRelCiInstanceEdgeQuery,
  buildInstanceFilterQuery,
};

export interface FamilyMeta {
  sys_id: string;
  name: string;
  short_description: string;
}

export interface TwoLevelMapping {
  appFamilyMeta: Map<string, { name: string; short_description: string }>;
  appToInstances: Map<string, Set<string>>;
  instanceSvcIds: string[];
}

export interface ThreeLevelMapping {
  bApps: FamilyMeta[];
  svcMap: Map<string, { name: string; short_description: string }>;
  bAppToSvcs: Map<string, string[]>;
  svcToInstIds: Map<string, string[]>;
  instanceIds: string[];
}

export interface FamilyPageResult<T> {
  mapping: T | null;
  totalFamilies: number;
  page: number;
  access: TableAccess;
}

const viewFieldsCache = new Map<string, ViewField[]>();

const refId = (f: unknown): string => {
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object' && 'value' in f) return String((f as Record<string, unknown>).value ?? '');
  return raw(f);
};

export async function getCachedViewFields(tableName: string): Promise<ViewField[]> {
  const cached = viewFieldsCache.get(tableName);
  if (cached) return cached;
  const vf = await loadListFields(tableName, VIEW_TITLE, DEFAULT_VIEW_FIELDS);
  viewFieldsCache.set(tableName, vf);
  return vf;
}

export async function chunkedINParallel<T>(
  table: string,
  inField: string,
  ids: string[],
  extraQuery: string,
  fields: string[],
  limitPerChunk: number,
  options?: { displayValue?: boolean | 'all' },
): Promise<{ rows: T[]; access: TableAccess }> {
  if (!ids.length) return { rows: [], access: 'ok' };

  const chunkSize = table === 'cmdb_rel_ci' ? REL_CI_IN_CHUNK_SIZE : CHUNK_SIZE;
  const slices: string[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    slices.push(ids.slice(i, i + chunkSize).join(','));
  }

  const all: T[] = [];
  let access: TableAccess = 'ok';

  for (let i = 0; i < slices.length; i += CHUNK_CONCURRENCY) {
    const batch = slices.slice(i, i + CHUNK_CONCURRENCY);
    const results = await Promise.all(
      batch.map(slice => {
        const q = extraQuery ? `${inField}IN${slice}^${extraQuery}` : `${inField}IN${slice}`;
        return queryTableWithAccess<T>({
          table,
          query: q,
          fields,
          limit: limitPerChunk,
          ...(options?.displayValue ? { displayValue: options.displayValue } : {}),
        });
      }),
    );
    for (const result of results) {
      if (result.access === 'denied') return { rows: [], access: 'denied' };
      if (result.access === 'error') access = 'error';
      all.push(...(result.result ?? []));
    }
  }

  return { rows: all, access };
}

export async function fetchFlagCountsForIds(
  ciSysIds: string[],
): Promise<Map<string, CITaskFlagCounts>> {
  const merged = new Map<string, CITaskFlagCounts>();
  if (!ciSysIds.length) return merged;

  for (let i = 0; i < ciSysIds.length; i += CHUNK_SIZE) {
    const slice = ciSysIds.slice(i, i + CHUNK_SIZE);
    const part = await fetchCITaskFlagCounts(slice);
    for (const [id, counts] of part) merged.set(id, counts);
  }
  return merged;
}

function recordToLiveInstance(
  rec: Record<string, unknown>,
  viewFieldMap: Map<string, ViewField[]>,
  flagCounts: Map<string, CITaskFlagCounts>,
): LiveInstance | null {
  const sysId = raw(rec.sys_id);
  if (!sysId) return null;

  const tableName = raw(rec.sys_class_name);
  const layoutFields = viewFieldMap.get(tableName) ?? DEFAULT_VIEW_FIELDS;
  const readableFields = filterColumnsByProbe(layoutFields, rec);
  const fieldValues: Record<string, string> = {};
  for (const field of CATALOG_FIELDS) {
    if (field in rec) fieldValues[field] = str(rec[field]);
  }

  const flags = flagCounts.get(sysId);
  return {
    sys_id: sysId,
    name: str(rec.name),
    sys_class_name: tableName,
    operational_status: str(rec.operational_status),
    environment: str(rec.environment),
    fieldValues,
    viewFields: readableFields,
    incidentRecords: [],
    changeRecords: [],
    incidents: flags?.incidents ?? 0,
    changes: flags?.changes ?? 0,
  };
}

export async function loadInstanceCatalog(
  instanceIds: string[],
  table: string,
): Promise<Map<string, LiveInstance>> {
  const result = new Map<string, LiveInstance>();
  if (!instanceIds.length) return result;

  const uniqueIds = [...new Set(instanceIds)];
  const [catalogRes, flagCounts] = await Promise.all([
    chunkedINParallel<Record<string, unknown>>(
      table, 'sys_id', uniqueIds, '', CATALOG_FIELDS, uniqueIds.length + 5,
      { displayValue: 'all' },
    ),
    fetchFlagCountsForIds(uniqueIds),
  ]);

  if (catalogRes.access === 'denied') return result;

  const tableNames = [...new Set(
    catalogRes.rows.map(r => raw(r.sys_class_name)).filter(Boolean),
  )];
  const viewEntries = await Promise.all(
    tableNames.map(async t => ({ table: t, vf: await getCachedViewFields(t) })),
  );
  const viewFieldMap = new Map(viewEntries.map(({ table, vf }) => [table, vf]));

  for (const rec of catalogRes.rows) {
    const inst = recordToLiveInstance(rec, viewFieldMap, flagCounts);
    if (inst) result.set(inst.sys_id, inst);
  }

  return result;
}

export function buildInstanceFilterQueryLegacy(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
  twoLevel: boolean,
): string {
  return buildInstanceFilterQuery(criteria, filterDefs, twoLevel);
}

export function buildRelCiInstanceEdgeQueryLegacy(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
  twoLevel: boolean,
): string {
  return buildRelCiInstanceEdgeQuery(criteria, filterDefs, twoLevel);
}

/** @deprecated unused — filters are hierarchy-specific via config property */
export function criteriaForHierarchy(
  criteria: LiveFilterCriteria,
  _hierarchyMode: boolean,
): LiveFilterCriteria {
  return criteria;
}

/** 2-level: filter instance edges on cmdb_rel_ci, then walk to app-family services. */
export async function resolveFilteredTwoLevelFromRelCi(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
): Promise<FilterResolveResult> {
  const edgeQuery = buildRelCiInstanceEdgeQuery(criteria, filterDefs, true);

  const edgeRes = await queryTableWithAccess<{ parent: unknown; child: unknown }>({
    table: 'cmdb_rel_ci',
    query: `${edgeQuery}^ORDERBYchild.name`,
    fields: ['parent', 'child'],
    limit: 10000,
  });

  if (edgeRes.access === 'denied') {
    return { instanceIds: new Set(), families: [], access: 'denied' };
  }

  const instanceIds = new Set<string>();
  const intermediateIds = new Set<string>();
  for (const r of edgeRes.result ?? []) {
    const inst = refId(r.child);
    const mid = refId(r.parent);
    if (inst) instanceIds.add(inst);
    if (mid) intermediateIds.add(mid);
  }

  if (!intermediateIds.size) {
    return { instanceIds, families: [], access: edgeRes.access };
  }

  const hop1Res = await chunkedINParallel<{
    parent: unknown; child: unknown;
    'parent.name': unknown; 'parent.short_description': unknown;
  }>(
    'cmdb_rel_ci', 'child.sys_id', [...intermediateIds],
    'type.name=Connects to::Connected by^parent.ref_cmdb_ci_service.u_service_type=service',
    ['parent', 'parent.name', 'parent.short_description', 'child'], 5000,
  );

  if (hop1Res.access === 'denied') {
    return { instanceIds, families: [], access: 'denied' };
  }

  const familyMap = new Map<string, FamilyMeta>();
  for (const r of hop1Res.rows) {
    const p = refId(r.parent);
    if (!p || familyMap.has(p)) continue;
    familyMap.set(p, {
      sys_id: p,
      name: str(r['parent.name']) || p,
      short_description: str(r['parent.short_description']),
    });
  }

  return {
    instanceIds,
    families: [...familyMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    access: hop1Res.access,
  };
}

/** 3-level: filter instance edges on cmdb_rel_ci, then walk to business apps. */
export async function resolveFilteredThreeLevelFromRelCi(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
): Promise<FilterResolveResult> {
  const edgeQuery = buildRelCiInstanceEdgeQuery(criteria, filterDefs, false);

  const edgeRes = await queryTableWithAccess<{ parent: unknown; child: unknown }>({
    table: 'cmdb_rel_ci',
    query: `${edgeQuery}^ORDERBYchild.name`,
    fields: ['parent', 'child'],
    limit: 10000,
  });

  if (edgeRes.access === 'denied') {
    return { instanceIds: new Set(), families: [], access: 'denied' };
  }

  const instanceIds = new Set<string>();
  const serviceIds = new Set<string>();
  for (const r of edgeRes.result ?? []) {
    const inst = refId(r.child);
    const svc = refId(r.parent);
    if (inst) instanceIds.add(inst);
    if (svc) serviceIds.add(svc);
  }

  if (!serviceIds.size) {
    return { instanceIds, families: [], access: edgeRes.access };
  }

  const consumesRes = await chunkedINParallel<{
    parent: unknown; child: unknown;
    'parent.name': unknown; 'parent.short_description': unknown;
  }>(
    'cmdb_rel_ci', 'child.sys_id', [...serviceIds],
    'type.name=Consumes::Consumed by',
    ['parent', 'parent.name', 'parent.short_description', 'child'], 5000,
  );

  if (consumesRes.access === 'denied') {
    return { instanceIds, families: [], access: 'denied' };
  }

  const familyMap = new Map<string, FamilyMeta>();
  for (const r of consumesRes.rows) {
    const p = refId(r.parent);
    if (!p || familyMap.has(p)) continue;
    familyMap.set(p, {
      sys_id: p,
      name: str(r['parent.name']) || p,
      short_description: str(r['parent.short_description']),
    });
  }

  return {
    instanceIds,
    families: [...familyMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    access: consumesRes.access,
  };
}

export interface FilterResolveResult {
  instanceIds: Set<string>;
  families: FamilyMeta[];
  access: TableAccess;
}

export function buildAppHomeHierarchyTaskPrefix(hierarchyMode: boolean): string {
  return hierarchyMode
    ? 'ci_item.sys_class_nameINSTANCEOFcmdb_ci_service_auto'
    : 'ci_item.sys_class_name=cmdb_ci_service^ci_item.ref_cmdb_ci_service.u_service_type=instance';
}

/** Encoded task_ci query branches for app-home summary stats / sidebar panel. */
export function buildAppHomeTaskSummaryBranches(
  instanceIds: string[] | null,
  hierarchyMode: boolean,
  config: RelatedTaskConfig,
): string[] {
  if (instanceIds === null) {
    const branch = taskCiQuery(buildAppHomeHierarchyTaskPrefix(hierarchyMode), config);
    return branch ? [branch] : [];
  }
  if (!instanceIds.length) return [];

  const branches: string[] = [];
  for (let i = 0; i < instanceIds.length; i += CHUNK_SIZE) {
    const chunk = instanceIds.slice(i, i + CHUNK_SIZE);
    branches.push(`ci_item.sys_idIN${chunk.join(',')}^${config.extraQuery}`);
  }
  return branches;
}

export interface AppHomeStats {
  total: number;
  operational: number;
  incidents: number;
  changes: number;
  access: {
    total: TableAccess;
    operational: TableAccess;
    incidents: TableAccess;
    changes: TableAccess;
  };
}

async function countTableRows(
  table: string,
  query?: string,
): Promise<{ totalCount: number; access: TableAccess }> {
  const { totalCount, access } = await queryTableWithAccess({
    table,
    query,
    fields: ['sys_id'],
    limit: 1,
  });
  return { totalCount, access };
}

async function countInstancesBySysIds(
  table: string,
  baseQuery: string,
  ids: string[],
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!ids.length) return { totalCount: 0, access: 'ok' };

  let totalCount = 0;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    const idPart = `sys_idIN${chunk.join(',')}`;
    const query = baseQuery ? `${baseQuery}^${idPart}` : idPart;
    const result = await countTableRows(table, query);
    if (result.access === 'denied') return { totalCount: 0, access: 'denied' };
    totalCount += result.totalCount;
  }
  return { totalCount, access: 'ok' };
}

/** Top-of-page stats — global when unfiltered, scoped to resolved instance IDs when filtered. */
export async function fetchAppHomeStats(
  hierarchyMode: boolean,
  filtersActive: boolean,
  filteredInstIds: Set<string> | null,
): Promise<AppHomeStats> {
  if (filtersActive) {
    const ids = filteredInstIds ? [...filteredInstIds] : [];
    const instanceTable = hierarchyMode ? 'cmdb_ci_service_auto' : 'cmdb_ci_service';
    const operationalBase = hierarchyMode
      ? 'operational_status=1'
      : 'u_service_type=instance^operational_status=1';

    const [operationalR, incidentsR, changesR] = await Promise.all([
      countInstancesBySysIds(instanceTable, operationalBase, ids),
      countDistinctRelatedTasksFromBranches(
        buildAppHomeTaskSummaryBranches(ids, hierarchyMode, INCIDENT_TASK_CONFIG),
      ),
      countDistinctRelatedTasksFromBranches(
        buildAppHomeTaskSummaryBranches(ids, hierarchyMode, CHANGE_TASK_CONFIG),
      ),
    ]);

    return {
      total: ids.length,
      operational: operationalR.access === 'denied' ? 0 : operationalR.totalCount,
      incidents: incidentsR.access === 'denied' ? 0 : incidentsR.totalCount,
      changes: changesR.access === 'denied' ? 0 : changesR.totalCount,
      access: {
        total: 'ok',
        operational: operationalR.access,
        incidents: incidentsR.access,
        changes: changesR.access,
      },
    };
  }

  if (hierarchyMode) {
    const [totalR, operationalR, incidentsR, changesR] = await Promise.all([
      countTableRows('cmdb_ci_service_auto'),
      countTableRows('cmdb_ci_service_auto', 'operational_status=1'),
      countTableRows(
        'task_ci',
        taskCiQuery(buildAppHomeHierarchyTaskPrefix(true), INCIDENT_TASK_CONFIG),
      ),
      countTableRows(
        'task_ci',
        taskCiQuery(buildAppHomeHierarchyTaskPrefix(true), CHANGE_TASK_CONFIG),
      ),
    ]);
    return {
      total: totalR.access === 'denied' ? 0 : totalR.totalCount,
      operational: operationalR.access === 'denied' ? 0 : operationalR.totalCount,
      incidents: incidentsR.access === 'denied' ? 0 : incidentsR.totalCount,
      changes: changesR.access === 'denied' ? 0 : changesR.totalCount,
      access: {
        total: totalR.access,
        operational: operationalR.access,
        incidents: incidentsR.access,
        changes: changesR.access,
      },
    };
  }

  const [totalR, operationalR, incidentsR, changesR] = await Promise.all([
    countTableRows('cmdb_ci_service', 'u_service_type=instance'),
    countTableRows('cmdb_ci_service', 'u_service_type=instance^operational_status=1'),
    countTableRows(
      'task_ci',
      taskCiQuery(buildAppHomeHierarchyTaskPrefix(false), INCIDENT_TASK_CONFIG),
    ),
    countTableRows(
      'task_ci',
      taskCiQuery(buildAppHomeHierarchyTaskPrefix(false), CHANGE_TASK_CONFIG),
    ),
  ]);
  return {
    total: totalR.access === 'denied' ? 0 : totalR.totalCount,
    operational: operationalR.access === 'denied' ? 0 : operationalR.totalCount,
    incidents: incidentsR.access === 'denied' ? 0 : incidentsR.totalCount,
    changes: changesR.access === 'denied' ? 0 : changesR.totalCount,
    access: {
      total: totalR.access,
      operational: operationalR.access,
      incidents: incidentsR.access,
      changes: changesR.access,
    },
  };
}

export async function fetchFilteredInstanceIds(
  table: string,
  query: string,
): Promise<{ ids: Set<string>; access: TableAccess }> {
  if (!query) return { ids: new Set(), access: 'ok' };

  const { result = [], access } = await queryTableWithAccess<Record<string, unknown>>({
    table,
    query: `${query}^ORDERBYname`,
    fields: ['sys_id'],
    limit: 10000,
  });

  if (access === 'denied') return { ids: new Set(), access };

  const ids = new Set<string>();
  for (const r of result) {
    const id = raw(r.sys_id);
    if (id) ids.add(id);
  }
  return { ids, access };
}

export function sumFlagCounts(
  ids: string[],
  flagCounts: Map<string, CITaskFlagCounts>,
  instCache: Map<string, LiveInstance>,
): { incidents: number; changes: number } {
  let incidents = 0;
  let changes = 0;
  for (const id of ids) {
    const cached = instCache.get(id);
    if (cached) {
      incidents += cached.incidents;
      changes += cached.changes;
    } else {
      const flags = flagCounts.get(id);
      incidents += flags?.incidents ?? 0;
      changes += flags?.changes ?? 0;
    }
  }
  return { incidents, changes };
}

export function isOthersFamilyId(id: string): boolean {
  return id === OTHERS_FAMILY_ID;
}

export function appendOthersToTwoLevelMapping(
  mapping: TwoLevelMapping | null,
  orphanIds: string[],
): TwoLevelMapping | null {
  if (!orphanIds.length) return mapping;

  if (!mapping) {
    return {
      appFamilyMeta: new Map([[OTHERS_FAMILY_ID, { name: OTHERS_FAMILY_NAME, short_description: '' }]]),
      appToInstances: new Map([[OTHERS_FAMILY_ID, new Set(orphanIds)]]),
      instanceSvcIds: [...orphanIds],
    };
  }

  mapping.appFamilyMeta.set(OTHERS_FAMILY_ID, { name: OTHERS_FAMILY_NAME, short_description: '' });
  mapping.appToInstances.set(OTHERS_FAMILY_ID, new Set(orphanIds));
  mapping.instanceSvcIds = [...new Set([...mapping.instanceSvcIds, ...orphanIds])];
  return mapping;
}

export function appendOthersToThreeLevelMapping(
  mapping: ThreeLevelMapping | null,
  orphanIds: string[],
): ThreeLevelMapping | null {
  if (!orphanIds.length) return mapping;

  if (!mapping) {
    return {
      bApps: [{ sys_id: OTHERS_FAMILY_ID, name: OTHERS_FAMILY_NAME, short_description: '' }],
      svcMap: new Map([[OTHERS_SERVICE_ID, { name: OTHERS_FAMILY_NAME, short_description: '' }]]),
      bAppToSvcs: new Map([[OTHERS_FAMILY_ID, [OTHERS_SERVICE_ID]]]),
      svcToInstIds: new Map([[OTHERS_SERVICE_ID, [...orphanIds]]]),
      instanceIds: [...orphanIds],
    };
  }

  if (!mapping.bApps.some(a => a.sys_id === OTHERS_FAMILY_ID)) {
    mapping.bApps.push({ sys_id: OTHERS_FAMILY_ID, name: OTHERS_FAMILY_NAME, short_description: '' });
  }
  mapping.bAppToSvcs.set(OTHERS_FAMILY_ID, [OTHERS_SERVICE_ID]);
  mapping.svcMap.set(OTHERS_SERVICE_ID, { name: OTHERS_FAMILY_NAME, short_description: '' });
  mapping.svcToInstIds.set(OTHERS_SERVICE_ID, [...orphanIds]);
  mapping.instanceIds = [...new Set([...mapping.instanceIds, ...orphanIds])];
  return mapping;
}

async function fetchAllInstanceSysIds(
  hierarchyMode: boolean,
): Promise<{ ids: Set<string>; access: TableAccess }> {
  const table = hierarchyMode ? 'cmdb_ci_service_auto' : 'cmdb_ci_service';
  const baseQuery = hierarchyMode ? undefined : 'u_service_type=instance';
  const ids = new Set<string>();
  let access: TableAccess = 'ok';
  let offset = 0;
  const pageSize = 5000;

  while (true) {
    const res = await queryTableWithAccess<Record<string, unknown>>({
      table,
      query: baseQuery,
      fields: ['sys_id'],
      limit: pageSize,
      offset,
    });
    access = res.access;
    if (access === 'denied') return { ids: new Set(), access };
    for (const row of res.result ?? []) {
      const id = raw(row.sys_id);
      if (id) ids.add(id);
    }
    const batchLen = res.result?.length ?? 0;
    if (batchLen < pageSize) break;
    offset += batchLen;
  }

  return { ids, access };
}

/** Instances with no app-family link — grouped into [Others] on the home page. */
async function fetchAllFamilyIds(hierarchyMode: boolean): Promise<string[]> {
  if (hierarchyMode) {
    const res = await queryTableWithAccess<{ sys_id: string }>({
      table: 'cmdb_ci_business_app',
      fields: ['sys_id'],
      limit: 10000,
    });
    if (res.access === 'denied') return [];
    return (res.result ?? []).map(r => raw(r.sys_id)).filter(Boolean);
  }

  const res = await queryTableWithAccess<{ sys_id: string }>({
    table: 'cmdb_ci_service',
    query: 'u_service_type=service',
    fields: ['sys_id'],
    limit: 10000,
  });
  if (res.access === 'denied') return [];
  return (res.result ?? []).map(r => raw(r.sys_id)).filter(Boolean);
}

async function fetchLinkedInstanceIds(
  hierarchyMode: boolean,
  restrictToInstanceIds: Set<string> | null,
): Promise<Set<string>> {
  const linked = new Set<string>();
  const familyIds = await fetchAllFamilyIds(hierarchyMode);
  if (!familyIds.length) return linked;

  const families: FamilyMeta[] = familyIds.map(id => ({
    sys_id: id,
    name: '',
    short_description: '',
  }));

  const mapping = hierarchyMode
    ? await buildThreeLevelMappingForApps(families, restrictToInstanceIds)
    : await buildTwoLevelMappingForFamilies(families, restrictToInstanceIds);

  if (!mapping) return linked;

  const mappedIds = hierarchyMode
    ? (mapping as ThreeLevelMapping).instanceIds
    : (mapping as TwoLevelMapping).instanceSvcIds;
  for (const id of mappedIds) linked.add(id);
  return linked;
}

export async function computeOrphanInstanceIds(
  hierarchyMode: boolean,
  restrictToInstanceIds: Set<string> | null,
): Promise<string[]> {
  let universe: Set<string>;
  if (restrictToInstanceIds) {
    universe = restrictToInstanceIds;
  } else {
    const res = await fetchAllInstanceSysIds(hierarchyMode);
    if (res.access === 'denied' || !res.ids.size) return [];
    universe = res.ids;
  }

  if (!universe.size) return [];

  const linked = await fetchLinkedInstanceIds(hierarchyMode, restrictToInstanceIds);
  return [...universe].filter(id => !linked.has(id));
}

// ─── 2-level paged loaders ────────────────────────────────────────────────────

async function buildTwoLevelMappingForFamilies(
  families: FamilyMeta[],
  restrictToInstanceIds: Set<string> | null,
): Promise<TwoLevelMapping | null> {
  if (!families.length) return null;

  const appFamilyMeta = new Map(
    families.map(f => [f.sys_id, { name: f.name, short_description: f.short_description ?? '' }]),
  );
  const familyIds = families.map(f => f.sys_id);

  const hop1Res = await chunkedINParallel<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'parent.sys_id', familyIds,
    'type.name=Connects to::Connected by', ['parent', 'child'], 5000,
  );
  if (hop1Res.access === 'denied') return null;

  const hop1Map = new Map<string, string[]>();
  for (const r of hop1Res.rows) {
    const p = refId(r.parent), c = refId(r.child);
    if (!p || !c) continue;
    if (!hop1Map.has(p)) hop1Map.set(p, []);
    hop1Map.get(p)!.push(c);
  }

  const intermediateIds = [...new Set(hop1Res.rows.map(r => refId(r.child)).filter(Boolean))];
  if (!intermediateIds.length) return null;

  const hop2Res = await chunkedINParallel<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'parent.sys_id', intermediateIds,
    'type.name=Connects to::Connected by^child.ref_cmdb_ci_service.u_service_type=instance',
    ['parent', 'child'], 5000,
  );
  if (hop2Res.access === 'denied') return null;

  const hop2Map = new Map<string, string[]>();
  for (const r of hop2Res.rows) {
    const p = refId(r.parent), c = refId(r.child);
    if (!p || !c) continue;
    if (!hop2Map.has(p)) hop2Map.set(p, []);
    hop2Map.get(p)!.push(c);
  }

  const appToInstances = new Map<string, Set<string>>();
  for (const appId of familyIds) {
    const instSet = new Set<string>();
    for (const intId of hop1Map.get(appId) ?? []) {
      for (const instId of hop2Map.get(intId) ?? []) {
        if (!restrictToInstanceIds || restrictToInstanceIds.has(instId)) {
          instSet.add(instId);
        }
      }
    }
    if (instSet.size > 0) appToInstances.set(appId, instSet);
  }

  const instanceSvcIds = [...new Set([...appToInstances.values()].flatMap(s => [...s]))];
  const prunedMeta = new Map(
    [...appToInstances.keys()].map(id => [id, appFamilyMeta.get(id)!]),
  );
  if (!appToInstances.size) return null;
  return { appFamilyMeta: prunedMeta, appToInstances, instanceSvcIds };
}

export async function resolveTwoLevelMatchingFamilies(
  filteredInstIds: Set<string>,
): Promise<{ families: FamilyMeta[]; access: TableAccess }> {
  const ids = [...filteredInstIds];
  if (!ids.length) return { families: [], access: 'ok' };

  const hop2Res = await chunkedINParallel<{
    parent: unknown; child: unknown;
  }>(
    'cmdb_rel_ci', 'child.sys_id', ids,
    'type.name=Connects to::Connected by', ['parent', 'child'], 5000,
  );
  if (hop2Res.access === 'denied') return { families: [], access: 'denied' };

  const intermediateIds = [...new Set(hop2Res.rows.map(r => refId(r.parent)).filter(Boolean))];
  if (!intermediateIds.length) return { families: [], access: 'ok' };

  const hop1Res = await chunkedINParallel<{
    parent: unknown; child: unknown;
    'parent.name': unknown; 'parent.short_description': unknown;
  }>(
    'cmdb_rel_ci', 'child.sys_id', intermediateIds,
    'type.name=Connects to::Connected by^parent.ref_cmdb_ci_service.u_service_type=service',
    ['parent', 'parent.name', 'parent.short_description', 'child'], 5000,
  );
  if (hop1Res.access === 'denied') return { families: [], access: 'denied' };

  const familyMap = new Map<string, FamilyMeta>();
  for (const r of hop1Res.rows) {
    const p = refId(r.parent);
    if (!p || familyMap.has(p)) continue;
    familyMap.set(p, {
      sys_id: p,
      name: str(r['parent.name']) || p,
      short_description: str(r['parent.short_description']),
    });
  }

  return {
    families: [...familyMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    access: hop1Res.access,
  };
}

export async function fetchTwoLevelFamilyPage(
  page: number,
  pageSize: number,
  filteredInstIds: Set<string> | null,
  matchingFamilies: FamilyMeta[] | null,
): Promise<FamilyPageResult<TwoLevelMapping>> {
  let families: FamilyMeta[];
  let totalFamilies: number;
  let access: TableAccess = 'ok';

  if (filteredInstIds) {
    const list = matchingFamilies ?? [];
    totalFamilies = list.length;
    families = list.slice(page * pageSize, (page + 1) * pageSize);
  } else {
    const res = await queryTableWithAccess<FamilyMeta>({
      table: 'cmdb_ci_service',
      query: 'u_service_type=service',
      fields: ['sys_id', 'name', 'short_description'],
      limit: pageSize,
      offset: page * pageSize,
      orderBy: 'name',
    });
    access = res.access;
    if (access === 'denied') {
      return { mapping: null, totalFamilies: 0, page, access };
    }
    families = res.result ?? [];
    totalFamilies = res.totalCount;
  }

  const mapping = await buildTwoLevelMappingForFamilies(families, filteredInstIds);
  const orphanIds = await computeOrphanInstanceIds(false, filteredInstIds);
  const mappingWithOthers = appendOthersToTwoLevelMapping(mapping, orphanIds);
  if (!mappingWithOthers && access === 'ok' && families.length > 0 && !orphanIds.length) access = 'error';

  return { mapping: mappingWithOthers, totalFamilies, page, access };
}

// ─── 3-level paged loaders ──────────────────────────────────────────────────

async function buildThreeLevelMappingForApps(
  bApps: FamilyMeta[],
  restrictToInstanceIds: Set<string> | null,
): Promise<ThreeLevelMapping | null> {
  if (!bApps.length) return null;

  const bAppIds = bApps.map(a => a.sys_id);

  const consumesRes = await chunkedINParallel<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'parent.sys_id', bAppIds,
    'type.name=Consumes::Consumed by', ['parent', 'child'], 5000,
  );
  if (consumesRes.access === 'denied') return null;

  const serviceIds = [...new Set(consumesRes.rows.map(r => refId(r.child)).filter(Boolean))];
  if (!serviceIds.length) {
    return {
      bApps,
      svcMap: new Map(),
      bAppToSvcs: new Map(),
      svcToInstIds: new Map(),
      instanceIds: [],
    };
  }

  const svcRes = await chunkedINParallel<{ sys_id: string; name: string; short_description: string }>(
    'cmdb_ci_service', 'sys_id', serviceIds, '',
    ['sys_id', 'name', 'short_description'], 500,
  );
  if (svcRes.access === 'denied') return null;

  const svcMap = new Map<string, { name: string; short_description: string }>();
  for (const s of svcRes.rows) svcMap.set(s.sys_id, s);

  const containsRes = await chunkedINParallel<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'parent.sys_id', serviceIds,
    'type.name=Contains::Contained by', ['parent', 'child'], 5000,
  );
  if (containsRes.access === 'denied') return null;

  const bAppToSvcs = new Map<string, string[]>();
  for (const r of consumesRes.rows) {
    const b = refId(r.parent), s = refId(r.child);
    if (!b || !s) continue;
    if (!bAppToSvcs.has(b)) bAppToSvcs.set(b, []);
    bAppToSvcs.get(b)!.push(s);
  }

  const svcToInstIds = new Map<string, string[]>();
  for (const r of containsRes.rows) {
    const s = refId(r.parent), i = refId(r.child);
    if (!s || !i) continue;
    if (restrictToInstanceIds && !restrictToInstanceIds.has(i)) continue;
    if (!svcToInstIds.has(s)) svcToInstIds.set(s, []);
    svcToInstIds.get(s)!.push(i);
  }

  const instanceIds = [...new Set(
    [...svcToInstIds.values()].flatMap(ids => ids),
  )];

  const visibleBApps = bApps.filter(app => {
    const svcs = (bAppToSvcs.get(app.sys_id) ?? []).filter(sId => (svcToInstIds.get(sId) ?? []).length > 0);
    if (!svcs.length) return false;
    bAppToSvcs.set(app.sys_id, svcs);
    return true;
  });
  if (!visibleBApps.length) return null;

  return { bApps: visibleBApps, svcMap, bAppToSvcs, svcToInstIds, instanceIds };
}

export async function resolveThreeLevelMatchingFamilies(
  filteredInstIds: Set<string>,
): Promise<{ families: FamilyMeta[]; access: TableAccess }> {
  const ids = [...filteredInstIds];
  if (!ids.length) return { families: [], access: 'ok' };

  const containsRes = await chunkedINParallel<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'child.sys_id', ids,
    'type.name=Contains::Contained by', ['parent', 'child'], 5000,
  );
  if (containsRes.access === 'denied') return { families: [], access: 'denied' };

  const serviceIds = [...new Set(containsRes.rows.map(r => refId(r.parent)).filter(Boolean))];
  if (!serviceIds.length) return { families: [], access: 'ok' };

  const consumesRes = await chunkedINParallel<{
    parent: unknown; child: unknown;
    'parent.name': unknown; 'parent.short_description': unknown;
  }>(
    'cmdb_rel_ci', 'child.sys_id', serviceIds,
    'type.name=Consumes::Consumed by',
    ['parent', 'parent.name', 'parent.short_description', 'child'], 5000,
  );
  if (consumesRes.access === 'denied') return { families: [], access: 'denied' };

  const familyMap = new Map<string, FamilyMeta>();
  for (const r of consumesRes.rows) {
    const p = refId(r.parent);
    if (!p || familyMap.has(p)) continue;
    familyMap.set(p, {
      sys_id: p,
      name: str(r['parent.name']) || p,
      short_description: str(r['parent.short_description']),
    });
  }

  return {
    families: [...familyMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
    access: consumesRes.access,
  };
}

export async function fetchThreeLevelFamilyPage(
  page: number,
  pageSize: number,
  filteredInstIds: Set<string> | null,
  matchingFamilies: FamilyMeta[] | null,
): Promise<FamilyPageResult<ThreeLevelMapping>> {
  let bApps: FamilyMeta[];
  let totalFamilies: number;
  let access: TableAccess = 'ok';

  if (filteredInstIds) {
    const list = matchingFamilies ?? [];
    totalFamilies = list.length;
    bApps = list.slice(page * pageSize, (page + 1) * pageSize);
  } else {
    const res = await queryTableWithAccess<FamilyMeta>({
      table: 'cmdb_ci_business_app',
      fields: ['sys_id', 'name', 'short_description'],
      limit: pageSize,
      offset: page * pageSize,
      orderBy: 'name',
    });
    access = res.access;
    if (access === 'denied') {
      return { mapping: null, totalFamilies: 0, page, access };
    }
    bApps = res.result ?? [];
    totalFamilies = res.totalCount;
  }

  const mapping = await buildThreeLevelMappingForApps(bApps, filteredInstIds);
  const orphanIds = await computeOrphanInstanceIds(true, filteredInstIds);
  const mappingWithOthers = appendOthersToThreeLevelMapping(mapping, orphanIds);
  if (!mappingWithOthers && access === 'ok' && bApps.length > 0 && !orphanIds.length) access = 'error';

  return { mapping: mappingWithOthers, totalFamilies, page, access };
}

/** Load business app → service → instance tree (same rel_ci walks as app home). */
export async function loadThreeLevelHierarchyForBusinessApp(
  bApp: FamilyMeta,
): Promise<{ mapping: ThreeLevelMapping; instances: Map<string, LiveInstance> } | null> {
  const mapping = await buildThreeLevelMappingForApps([bApp], null);
  if (!mapping) return null;

  const instances = mapping.instanceIds.length
    ? await loadInstanceCatalog(mapping.instanceIds, 'cmdb_ci_service_auto')
    : new Map<string, LiveInstance>();

  return { mapping, instances };
}

export type AppFamilyCenterLevel = 'business' | 'family' | 'service' | 'instance';

export interface AppFamilyHierarchyData {
  hierarchyMode: boolean;
  centerSysId: string;
  centerLevel: AppFamilyCenterLevel;
  rootId: string;
  rootName: string;
  threeLevel?: ThreeLevelMapping;
  twoLevel?: TwoLevelMapping;
  instances: Map<string, LiveInstance>;
}

async function resolveBusinessAppForService(serviceId: string): Promise<FamilyMeta | null> {
  const res = await chunkedINParallel<{
    parent: unknown;
    'parent.name': unknown;
    'parent.short_description': unknown;
  }>(
    'cmdb_rel_ci', 'child.sys_id', [serviceId],
    'type.name=Consumes::Consumed by',
    ['parent', 'parent.name', 'parent.short_description'], 5000,
  );
  if (res.access === 'denied' || !res.rows.length) return null;
  const row = res.rows[0];
  const sys_id = refId(row.parent);
  if (!sys_id) return null;
  return {
    sys_id,
    name: str(row['parent.name']) || sys_id,
    short_description: str(row['parent.short_description']),
  };
}

async function resolveServiceForInstance(instanceId: string): Promise<FamilyMeta | null> {
  const res = await chunkedINParallel<{
    parent: unknown;
    'parent.name': unknown;
    'parent.short_description': unknown;
  }>(
    'cmdb_rel_ci', 'child.sys_id', [instanceId],
    'type.name=Contains::Contained by',
    ['parent', 'parent.name', 'parent.short_description'], 5000,
  );
  if (res.access === 'denied' || !res.rows.length) return null;
  const row = res.rows[0];
  const sys_id = refId(row.parent);
  if (!sys_id) return null;
  return {
    sys_id,
    name: str(row['parent.name']) || sys_id,
    short_description: str(row['parent.short_description']),
  };
}

export async function fetchServiceType(
  sysId: string,
): Promise<'service' | 'instance' | null> {
  const { result, access } = await queryTableWithAccess<{ u_service_type: unknown }>({
    table: 'cmdb_ci_service',
    query: `sys_id=${sysId}`,
    fields: ['u_service_type'],
    limit: 1,
  });
  if (access === 'denied' || !result?.[0]) return null;
  const st = raw(result[0].u_service_type).toLowerCase();
  if (st === 'instance') return 'instance';
  if (st === 'service') return 'service';
  return null;
}

/** Resolve app-family tree for any business app, service, or instance record. */
export async function loadAppFamilyHierarchyForRecord(
  sysId: string,
  table: string,
  name: string,
  hierarchyMode: boolean,
  serviceType?: 'service' | 'instance' | null,
): Promise<AppFamilyHierarchyData | null> {
  if (!sysId) return null;

  if (hierarchyMode) {
    if (table === 'cmdb_ci_business_app') {
      const loaded = await loadThreeLevelHierarchyForBusinessApp({
        sys_id: sysId, name, short_description: '',
      });
      if (!loaded) return null;
      return {
        hierarchyMode: true,
        centerSysId: sysId,
        centerLevel: 'business',
        rootId: sysId,
        rootName: name,
        threeLevel: loaded.mapping,
        instances: loaded.instances,
      };
    }

    if (table === 'cmdb_ci_service') {
      const bApp = await resolveBusinessAppForService(sysId);
      if (!bApp) return null;
      const loaded = await loadThreeLevelHierarchyForBusinessApp(bApp);
      if (!loaded) return null;
      return {
        hierarchyMode: true,
        centerSysId: sysId,
        centerLevel: 'service',
        rootId: bApp.sys_id,
        rootName: bApp.name,
        threeLevel: loaded.mapping,
        instances: loaded.instances,
      };
    }

    if (table.startsWith('cmdb_ci_service')) {
      const svc = await resolveServiceForInstance(sysId);
      if (!svc) return null;
      const bApp = await resolveBusinessAppForService(svc.sys_id);
      if (!bApp) return null;
      const loaded = await loadThreeLevelHierarchyForBusinessApp(bApp);
      if (!loaded) return null;
      return {
        hierarchyMode: true,
        centerSysId: sysId,
        centerLevel: 'instance',
        rootId: bApp.sys_id,
        rootName: bApp.name,
        threeLevel: loaded.mapping,
        instances: loaded.instances,
      };
    }

    return null;
  }

  const st = serviceType ?? await fetchServiceType(sysId);
  if (!st) return null;

  if (st === 'service') {
    const family: FamilyMeta = { sys_id: sysId, name, short_description: '' };
    const mapping = await buildTwoLevelMappingForFamilies([family], null);
    if (!mapping) return null;
    const instIds = [...(mapping.appToInstances.get(sysId) ?? [])];
    const instances = instIds.length
      ? await loadInstanceCatalog(instIds, 'cmdb_ci_service')
      : new Map<string, LiveInstance>();
    return {
      hierarchyMode: false,
      centerSysId: sysId,
      centerLevel: 'family',
      rootId: sysId,
      rootName: name,
      twoLevel: mapping,
      instances,
    };
  }

  const { families, access } = await resolveTwoLevelMatchingFamilies(new Set([sysId]));
  if (access === 'denied' || !families.length) return null;
  const family = families[0];
  const mapping = await buildTwoLevelMappingForFamilies([family], null);
  if (!mapping) return null;
  const instIds = [...(mapping.appToInstances.get(family.sys_id) ?? [])];
  const instances = instIds.length
    ? await loadInstanceCatalog(instIds, 'cmdb_ci_service')
    : new Map<string, LiveInstance>();
  return {
    hierarchyMode: false,
    centerSysId: sysId,
    centerLevel: 'instance',
    rootId: family.sys_id,
    rootName: family.name,
    twoLevel: mapping,
    instances,
  };
}

/** Resolve all instance sys_ids under a single app family / business app (2- or 3-level). */
export async function resolveInstanceIdsForFamily(
  familySysId: string,
  hierarchyMode: boolean,
): Promise<string[]> {
  if (!familySysId) return [];

  const family: FamilyMeta = { sys_id: familySysId, name: '', short_description: '' };

  if (hierarchyMode) {
    const mapping = await buildThreeLevelMappingForApps([family], null);
    return mapping?.instanceIds ?? [];
  }

  const mapping = await buildTwoLevelMappingForFamilies([family], null);
  const instSet = mapping?.appToInstances.get(familySysId);
  return instSet ? [...instSet] : [];
}

export function hydrateTwoLevelMapping(dto: TwoLevelMappingDto): TwoLevelMapping {
  const appFamilyMeta = new Map<string, { name: string; short_description: string }>();
  for (const [id, meta] of Object.entries(dto.app_family_meta ?? {})) {
    appFamilyMeta.set(id, meta);
  }
  const appToInstances = new Map<string, Set<string>>();
  for (const [id, instIds] of Object.entries(dto.app_to_instances ?? {})) {
    appToInstances.set(id, new Set(instIds));
  }
  return {
    appFamilyMeta,
    appToInstances,
    instanceSvcIds: dto.instance_svc_ids ?? [],
  };
}

export function hydrateThreeLevelMapping(dto: ThreeLevelMappingDto): ThreeLevelMapping {
  const svcMap = new Map<string, { name: string; short_description: string }>();
  for (const [id, meta] of Object.entries(dto.svc_map ?? {})) {
    svcMap.set(id, meta);
  }
  const bAppToSvcs = new Map<string, string[]>();
  for (const [id, svcIds] of Object.entries(dto.b_app_to_svcs ?? {})) {
    bAppToSvcs.set(id, svcIds);
  }
  const svcToInstIds = new Map<string, string[]>();
  for (const [id, instIds] of Object.entries(dto.svc_to_inst_ids ?? {})) {
    svcToInstIds.set(id, instIds);
  }
  return {
    bApps: dto.b_apps ?? [],
    svcMap,
    bAppToSvcs,
    svcToInstIds,
    instanceIds: dto.instance_ids ?? [],
  };
}

export interface ApplicationHomePageResult {
  twoLevelMapping: TwoLevelMapping | null;
  threeLevelMapping: ThreeLevelMapping | null;
  totalFamilies: number;
  page: number;
  access: TableAccess;
  instanceIds: Set<string> | null;
  filterToken: string | null;
  truncated: boolean;
}

async function fetchApplicationHomePageLegacy(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
  hierarchyMode: boolean,
  page: number,
  pageSize: number,
): Promise<ApplicationHomePageResult> {
  const filtersActive = hasActiveLiveFilters(criteria);

  if (filtersActive) {
    const resolved = hierarchyMode
      ? await resolveFilteredThreeLevelFromRelCi(criteria, filterDefs)
      : await resolveFilteredTwoLevelFromRelCi(criteria, filterDefs);

    if (resolved.access === 'denied') {
      return {
        twoLevelMapping: null,
        threeLevelMapping: null,
        totalFamilies: 0,
        page,
        access: 'denied',
        instanceIds: new Set(),
        filterToken: null,
        truncated: false,
      };
    }

    const pageResult = hierarchyMode
      ? await fetchThreeLevelFamilyPage(page, pageSize, resolved.instanceIds, resolved.families)
      : await fetchTwoLevelFamilyPage(page, pageSize, resolved.instanceIds, resolved.families);

    return {
      twoLevelMapping: hierarchyMode ? null : (pageResult.mapping as TwoLevelMapping | null),
      threeLevelMapping: hierarchyMode ? (pageResult.mapping as ThreeLevelMapping | null) : null,
      totalFamilies: pageResult.totalFamilies,
      page: pageResult.page,
      access: pageResult.access,
      instanceIds: resolved.instanceIds,
      filterToken: null,
      truncated: false,
    };
  }

  const pageResult = hierarchyMode
    ? await fetchThreeLevelFamilyPage(page, pageSize, null, null)
    : await fetchTwoLevelFamilyPage(page, pageSize, null, null);

  return {
    twoLevelMapping: hierarchyMode ? null : (pageResult.mapping as TwoLevelMapping | null),
    threeLevelMapping: hierarchyMode ? (pageResult.mapping as ThreeLevelMapping | null) : null,
    totalFamilies: pageResult.totalFamilies,
    page: pageResult.page,
    access: pageResult.access,
    instanceIds: null,
    filterToken: null,
    truncated: false,
  };
}

export async function fetchApplicationHomePageUnified(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
  hierarchyMode: boolean,
  page: number,
  pageSize: number,
  filterToken: string | null,
): Promise<ApplicationHomePageResult> {
  const filtersActive = hasActiveLiveFilters(criteria);
  const body: ApplicationHomeRequest = {
    hierarchy_mode: hierarchyMode ? 'three_level' : 'two_level',
    page,
    page_size: pageSize,
    search: criteria.search,
    filters: criteria.filters,
  };
  if (filtersActive && filterToken) {
    body.filter_token = filterToken;
  }

  const res = await fetchApplicationHomePage(body);

  const shouldFallback = res.access === 'denied'
    || res.access === 'error'
    || (!res.mapping && res.total_families === 0 && !filtersActive);

  if (shouldFallback) {
    return fetchApplicationHomePageLegacy(criteria, filterDefs, hierarchyMode, page, pageSize);
  }

  if (res.access === 'denied') {
    return {
      twoLevelMapping: null,
      threeLevelMapping: null,
      totalFamilies: 0,
      page,
      access: 'denied',
      instanceIds: filtersActive ? new Set() : null,
      filterToken: null,
      truncated: false,
    };
  }

  const instanceIds = filtersActive ? new Set(res.instance_ids) : null;
  let twoLevelMapping: TwoLevelMapping | null = null;
  let threeLevelMapping: ThreeLevelMapping | null = null;

  if (res.mapping) {
    if (hierarchyMode) {
      threeLevelMapping = hydrateThreeLevelMapping(res.mapping as ThreeLevelMappingDto);
    } else {
      twoLevelMapping = hydrateTwoLevelMapping(res.mapping as TwoLevelMappingDto);
    }
  }

  let access: TableAccess = res.access === 'error' ? 'error' : 'ok';
  if (access === 'ok' && res.total_families > 0 && !res.mapping) access = 'error';

  return {
    twoLevelMapping,
    threeLevelMapping,
    totalFamilies: res.total_families,
    page: res.page,
    access,
    instanceIds,
    filterToken: res.filter_token,
    truncated: Boolean(res.truncated),
  };
}

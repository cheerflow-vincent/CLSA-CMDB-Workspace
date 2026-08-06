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
import { loadListFields, raw, str, type ViewField } from './viewFields';
import type { IncidentRecord, ChangeRecord } from '../components/FlagDetailPanel';

export const CHUNK_SIZE = 150;
/** cmdb_rel_ci IN lists hit URL/query length limits on some instances (use smaller slices). */
export const REL_CI_IN_CHUNK_SIZE = 50;
export const CHUNK_CONCURRENCY = 5;
export const FAMILY_PAGE_SIZE = 50;
export const VIEW_TITLE = 'CLSA CMDB Workspace';
export const SEARCH_DEBOUNCE_MS = 500;

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

export interface LiveFilterCriteria {
  search: string;
  env: string[];
  status: string[];
  dept: string[];
  bizUnit: string[];
  tier: string[];
}

export interface SidebarFilterCriteria {
  env: string[];
  status: string[];
  dept: string[];
  bizUnit: string[];
  tier: string[];
}

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

export function buildInstanceFilterQuery(
  criteria: LiveFilterCriteria,
  twoLevel: boolean,
): string {
  const parts: string[] = [];
  if (twoLevel) {
    parts.push('u_service_type=instance');
  }

  const q = criteria.search.trim();
  if (q) parts.push(`nameLIKE${q}`);

  if (criteria.env.length) {
    parts.push(`environmentIN${criteria.env.join(',')}`);
  }
  if (criteria.status.length) {
    parts.push(`operational_statusIN${criteria.status.join(',')}`);
  }
  if (criteria.dept.length) {
    parts.push(`departmentIN${criteria.dept.join(',')}`);
  }
  if (criteria.bizUnit.length) {
    parts.push(`business_unitIN${criteria.bizUnit.join(',')}`);
  }
  if (criteria.tier.length) {
    parts.push(`u_tierIN${criteria.tier.join(',')}`);
  }

  return parts.join('^');
}

/** Filter on cmdb_rel_ci instance edge via child.* dot-walk (hierarchy-aware). */
export function buildRelCiInstanceEdgeQuery(
  criteria: LiveFilterCriteria,
  twoLevel: boolean,
): string {
  const parts = [
    twoLevel
      ? 'type.name=Connects to::Connected by'
      : 'type.name=Contains::Contained by',
  ];

  const child = 'child.';
  // u_service_type / u_tier exist only on specific CI tables — use ref_* dot-walk.
  const childRef = twoLevel ? 'child.ref_cmdb_ci_service.' : 'child.ref_cmdb_ci_service_auto.';
  if (twoLevel) {
    parts.push(`${childRef}u_service_type=instance`);
  }

  const q = criteria.search.trim();
  if (q) parts.push(`${child}nameLIKE${q}`);
  if (criteria.env.length) parts.push(`${child}environmentIN${criteria.env.join(',')}`);
  if (criteria.status.length) parts.push(`${child}operational_statusIN${criteria.status.join(',')}`);
  if (criteria.dept.length) parts.push(`${child}departmentIN${criteria.dept.join(',')}`);
  if (criteria.bizUnit.length) parts.push(`${child}business_unitIN${criteria.bizUnit.join(',')}`);
  if (criteria.tier.length) parts.push(`${childRef}u_tierIN${criteria.tier.join(',')}`);

  return parts.join('^');
}

export interface FilterResolveResult {
  instanceIds: Set<string>;
  families: FamilyMeta[];
  access: TableAccess;
}

/** 2-level: filter instance edges on cmdb_rel_ci, then walk to app-family services. */
export async function resolveFilteredTwoLevelFromRelCi(
  criteria: LiveFilterCriteria,
): Promise<FilterResolveResult> {
  const edgeQuery = buildRelCiInstanceEdgeQuery(criteria, true);

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
): Promise<FilterResolveResult> {
  const edgeQuery = buildRelCiInstanceEdgeQuery(criteria, false);

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

export function hasActiveLiveFilters(criteria: LiveFilterCriteria): boolean {
  return Boolean(
    criteria.search.trim()
    || criteria.env.length
    || criteria.status.length
    || criteria.dept.length
    || criteria.bizUnit.length
    || criteria.tier.length,
  );
}

export function sidebarFiltersEqual(a: SidebarFilterCriteria, b: SidebarFilterCriteria): boolean {
  const norm = (arr: string[]) => [...arr].sort().join('\0');
  return norm(a.env) === norm(b.env)
    && norm(a.status) === norm(b.status)
    && norm(a.dept) === norm(b.dept)
    && norm(a.bizUnit) === norm(b.bizUnit)
    && norm(a.tier) === norm(b.tier);
}

export function mergeFilterCriteria(
  search: string,
  sidebar: SidebarFilterCriteria,
): LiveFilterCriteria {
  return {
    search,
    env: sidebar.env,
    status: sidebar.status,
    dept: sidebar.dept,
    bizUnit: sidebar.bizUnit,
    tier: sidebar.tier,
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
  if (!mapping && access === 'ok' && families.length > 0) access = 'error';

  return { mapping, totalFamilies, page, access };
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
  if (!mapping && access === 'ok' && bApps.length > 0) access = 'error';

  return { mapping, totalFamilies, page, access };
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
  hierarchyMode: boolean,
  page: number,
  pageSize: number,
): Promise<ApplicationHomePageResult> {
  const filtersActive = hasActiveLiveFilters(criteria);

  if (filtersActive) {
    const resolved = hierarchyMode
      ? await resolveFilteredThreeLevelFromRelCi(criteria)
      : await resolveFilteredTwoLevelFromRelCi(criteria);

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
    env: criteria.env,
    status: criteria.status,
    dept: criteria.dept,
    biz_unit: criteria.bizUnit,
    tier: criteria.tier,
  };
  if (filtersActive && filterToken) {
    body.filter_token = filterToken;
  }

  const res = await fetchApplicationHomePage(body);

  const shouldFallback = res.access === 'denied'
    || res.access === 'error'
    || (!res.mapping && res.total_families === 0 && !filtersActive);

  if (shouldFallback) {
    return fetchApplicationHomePageLegacy(criteria, hierarchyMode, page, pageSize);
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

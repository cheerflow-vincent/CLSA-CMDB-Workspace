import { queryTableWithAccess, type TableAccess } from '../../api/servicenow';
import { filterColumnsByProbe } from './acl';
import { fetchCITaskFlagCounts, type CITaskFlagCounts } from './relatedCIFlags';
import { loadListFields, raw, str, type ViewField } from './viewFields';
import type { IncidentRecord, ChangeRecord } from '../components/FlagDetailPanel';

export const CHUNK_SIZE = 150;
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

  const slices: string[] = [];
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    slices.push(ids.slice(i, i + CHUNK_SIZE).join(','));
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
  if (!intermediateIds.length) {
    return { appFamilyMeta, appToInstances: new Map(), instanceSvcIds: [] };
  }

  const hop2Res = await chunkedINParallel<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'parent.sys_id', intermediateIds,
    'type.name=Connects to::Connected by^child.u_service_type=instance',
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
  return { appFamilyMeta, appToInstances, instanceSvcIds };
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
    'type.name=Connects to::Connected by^parent.u_service_type=service',
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
  if (!mapping && access === 'ok') access = 'error';

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

  return { bApps, svcMap, bAppToSvcs, svcToInstIds, instanceIds };
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
  if (!mapping && access === 'ok') access = 'error';

  return { mapping, totalFamilies, page, access };
}

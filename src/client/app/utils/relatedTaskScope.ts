import { fetchCiTaskScopeFlagCountsBatch, queryTableWithAccess, type TableAccess } from '../../api/servicenow';
import {
  INFRA_REL_CONFIGS,
  type RelatedCIConfig,
} from './relatedCIs';
import {
  countDistinctRelatedTasksFromBranches,
  fetchDistinctRelatedTaskPageByQuery,
  taskCiQuery,
  type RelatedTaskConfig,
  type RelatedTaskPage,
  RELATED_TASK_PAGE_SIZE,
} from './relatedTasks';
import { joinOrEncodedQueries } from './searchQuery';
import { raw } from './viewFields';

export const TASK_SCOPE_CI_CHUNK = 150;
export const TASK_SCOPE_REL_CI_CHUNK = 50;
export const TASK_SCOPE_CONCURRENCY = 5;
export const TASK_SCOPE_BATCH_SIZE = 100;

export const TASK_SCOPE_INCLUDE_INFRA_TOOLTIP =
  'Includes tasks linked to this application and related infrastructure (servers, databases, network).';

export interface TaskScopeCounts {
  incidents: number;
  changes: number;
}

export interface TaskScopeDefinition {
  scopeId: string;
  ciSysIds: string[];
}

function appRole(config: RelatedCIConfig): 'parent' | 'child' {
  return config.appRole ?? 'parent';
}

function infraSide(config: RelatedCIConfig): 'child' | 'parent' {
  return appRole(config) === 'child' ? 'parent' : 'child';
}

function refId(f: unknown): string {
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object' && 'value' in f) {
    const val = (f as Record<string, unknown>).value;
    return typeof val === 'object' && val !== null ? JSON.stringify(val) : String((val ?? '') as string | number | boolean);
  }
  return raw(f);
}

function buildRelQueryForInstances(instanceIds: string[], config: RelatedCIConfig): string {
  const idPart = instanceIds.join(',');
  if (appRole(config) === 'child') {
    return `type.name=${config.relType}^child.sys_idIN${idPart}^parent.sys_class_nameINSTANCEOF${config.baseClass}`;
  }
  return `type.name=${config.relType}^parent.sys_idIN${idPart}^child.sys_class_nameINSTANCEOF${config.baseClass}`;
}

async function chunkedRelQuery(
  instanceIds: string[],
  config: RelatedCIConfig,
): Promise<{ rows: Record<string, unknown>[]; access: TableAccess }> {
  if (!instanceIds.length) return { rows: [], access: 'ok' };

  const fields = ['parent', 'child'];
  const all: Record<string, unknown>[] = [];
  let access: TableAccess = 'ok';

  for (let i = 0; i < instanceIds.length; i += TASK_SCOPE_REL_CI_CHUNK) {
    const slice = instanceIds.slice(i, i + TASK_SCOPE_REL_CI_CHUNK);
    const q = buildRelQueryForInstances(slice, config);
    const result = await queryTableWithAccess<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: q,
      fields,
      limit: 5000,
    });
    if (result.access === 'denied') return { rows: [], access: 'denied' };
    if (result.access === 'error') access = 'error';
    all.push(...(result.result ?? []));
  }

  return { rows: all, access };
}

/** Bulk-resolve infra peer sys_ids per application instance via INFRA_REL_CONFIGS. */
export async function resolveInfraPeersByInstance(
  instanceIds: string[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const unique = [...new Set(instanceIds.filter(Boolean))];
  for (const id of unique) result.set(id, new Set());

  if (!unique.length) return result;

  let access: TableAccess = 'ok';

  for (const config of INFRA_REL_CONFIGS) {
    const { rows, access: chunkAccess } = await chunkedRelQuery(unique, config);
    if (chunkAccess === 'denied') return new Map();
    if (chunkAccess === 'error') access = 'error';

    const appSide = appRole(config);
    const peerSide = infraSide(config);
    for (const row of rows) {
      const instId = refId(row[appSide]);
      const peerId = refId(row[`${peerSide}.sys_id`] ?? row[peerSide]);
      if (!instId || !peerId || !result.has(instId)) continue;
      result.get(instId)!.add(peerId);
    }
  }

  if (access === 'error' && [...result.values()].every(s => s.size === 0)) {
    return result;
  }
  return result;
}

export function scopeIdInst(sysId: string): string {
  return `inst:${sysId}`;
}

export function scopeIdSvc(sysId: string): string {
  return `svc:${sysId}`;
}

export function scopeIdFam(sysId: string): string {
  return `fam:${sysId}`;
}

export function buildScopeCiIds(
  instanceId: string,
  infraMap: Map<string, Set<string>>,
): string[] {
  const peers = infraMap.get(instanceId);
  const ids = new Set<string>([instanceId]);
  if (peers) for (const p of peers) ids.add(p);
  return [...ids];
}

export function unionScopeCiIds(
  instanceIds: string[],
  infraMap: Map<string, Set<string>>,
): string[] {
  const ids = new Set<string>();
  for (const instId of instanceIds) {
    for (const id of buildScopeCiIds(instId, infraMap)) ids.add(id);
  }
  return [...ids];
}

export function buildTaskScopeBranches(
  ciIds: string[],
  config: RelatedTaskConfig,
): string[] {
  if (!ciIds.length) return [];
  const branches: string[] = [];
  for (let i = 0; i < ciIds.length; i += TASK_SCOPE_CI_CHUNK) {
    const chunk = ciIds.slice(i, i + TASK_SCOPE_CI_CHUNK);
    branches.push(`ci_item.sys_idIN${chunk.join(',')}^${config.extraQuery}`);
  }
  return branches;
}

export function buildTaskScopeEncodedQueries(
  ciIds: string[],
  config: RelatedTaskConfig,
): string[] {
  return buildTaskScopeBranches(ciIds, config);
}

export function buildTaskScopeCombinedQuery(
  ciIds: string[],
  config: RelatedTaskConfig,
): string {
  return joinOrEncodedQueries(buildTaskScopeBranches(ciIds, config));
}

export async function countTasksInScope(
  ciIds: string[],
  config: RelatedTaskConfig,
): Promise<{ totalCount: number; access: TableAccess }> {
  return countDistinctRelatedTasksFromBranches(buildTaskScopeBranches(ciIds, config));
}

export async function fetchTaskPageInScope(
  ciIds: string[],
  config: RelatedTaskConfig,
  page: number,
  pageSize = RELATED_TASK_PAGE_SIZE,
): Promise<RelatedTaskPage> {
  const encodedQuery = buildTaskScopeCombinedQuery(ciIds, config);
  return fetchDistinctRelatedTaskPageByQuery(encodedQuery, config, page, pageSize);
}

export async function resolveApplicationTaskScope(
  instanceSysId: string,
): Promise<string[]> {
  if (!instanceSysId) return [];
  const infraMap = await resolveInfraPeersByInstance([instanceSysId]);
  return buildScopeCiIds(instanceSysId, infraMap);
}

/** Legacy single-CI prefix for callers that only need instance id without infra. */
export function buildSingleCiTaskQuery(
  ciSysId: string,
  config: RelatedTaskConfig,
): string {
  return taskCiQuery(`ci_item.sys_id=${ciSysId}`, config);
}

export async function fetchTaskScopeCountsBatch(
  scopes: TaskScopeDefinition[],
): Promise<Map<string, TaskScopeCounts>> {
  const result = new Map<string, TaskScopeCounts>();
  if (!scopes.length) return result;

  for (let i = 0; i < scopes.length; i += TASK_SCOPE_BATCH_SIZE) {
    const slice = scopes.slice(i, i + TASK_SCOPE_BATCH_SIZE);
    const batch = await fetchCiTaskScopeFlagCountsBatch(
      slice.map(s => ({ scope_id: s.scopeId, ci_sys_ids: s.ciSysIds })),
    );
    for (const scope of slice) {
      const entry = batch.counts[scope.scopeId];
      result.set(scope.scopeId, {
        incidents: batch.access.incidents === 'denied' ? 0 : (entry?.incidents ?? 0),
        changes: batch.access.changes === 'denied' ? 0 : (entry?.changes ?? 0),
      });
    }
  }

  return result;
}

export async function fetchInstanceScopeCounts(
  instanceIds: string[],
  infraMap?: Map<string, Set<string>>,
): Promise<Map<string, TaskScopeCounts>> {
  const unique = [...new Set(instanceIds.filter(Boolean))];
  const result = new Map<string, TaskScopeCounts>();
  if (!unique.length) return result;

  const peers = infraMap ?? await resolveInfraPeersByInstance(unique);
  const batch = await fetchTaskScopeCountsBatch(buildTaskScopeDefinitions(unique, peers));
  for (const id of unique) {
    result.set(id, batch.get(scopeIdInst(id)) ?? { incidents: 0, changes: 0 });
  }
  return result;
}

export function buildTaskScopeDefinitions(
  instanceIds: string[],
  infraMap: Map<string, Set<string>>,
  groupScopes?: Array<{ scopeId: string; instanceIds: string[] }>,
): TaskScopeDefinition[] {
  const defs: TaskScopeDefinition[] = [];
  const seen = new Set<string>();

  for (const instId of instanceIds) {
    const id = scopeIdInst(instId);
    if (seen.has(id)) continue;
    seen.add(id);
    defs.push({ scopeId: id, ciSysIds: buildScopeCiIds(instId, infraMap) });
  }

  if (groupScopes) {
    for (const group of groupScopes) {
      if (seen.has(group.scopeId)) continue;
      seen.add(group.scopeId);
      defs.push({
        scopeId: group.scopeId,
        ciSysIds: unionScopeCiIds(group.instanceIds, infraMap),
      });
    }
  }

  return defs;
}

import { queryTableWithAccess, type TableAccess } from '../../api/servicenow';
import { filterColumnsByRecords } from './acl';
import { loadListFields, raw, str, type ViewField } from './viewFields';
import { LIST_VIEW_TITLE, RELATED_CI_PAGE_SIZE } from './relatedCIs';

export { RELATED_CI_PAGE_SIZE as RELATED_TASK_PAGE_SIZE };

export type RelatedTaskRecordContext = 'application' | 'ci';

export interface RelatedTaskConfig {
  /** task.sys_class_name filter value */
  taskClass: string;
  /** Table used for list-view column lookup */
  taskTable: string;
  /** Encoded query suffix after ci_item.sys_id (includes task.sys_class_name) */
  extraQuery: string;
  listTitle: string;
  defaultColumns: ViewField[];
  /** Empty-state copy keyed by record context (app detail vs CI detail). */
  emptyMessages?: Partial<Record<RelatedTaskRecordContext, string>>;
}

export interface RelatedTaskRow {
  sysId: string;
  values: Record<string, string>;
}

export interface RelatedTaskPage {
  rows: RelatedTaskRow[];
  columns: ViewField[];
  totalCount: number;
  access: TableAccess;
}

export const INCIDENT_TASK_CONFIG: RelatedTaskConfig = {
  taskClass: 'incident',
  taskTable: 'incident',
  extraQuery: 'task.sys_class_name=incident^task.active=true',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'number',            label: 'Number'            },
    { element: 'priority',          label: 'Priority'          },
    { element: 'state',             label: 'State'             },
    { element: 'short_description', label: 'Short description' },
    { element: 'opened_at',         label: 'Opened'            },
  ],
  emptyMessages: {
    application: 'No active incidents linked to this application.',
    ci: 'No active incidents linked to this CI.',
  },
};

/** Incidents opened on/after a date — all states (active + inactive), for trend reporting. */
export interface TaskTrendQueryConfig {
  taskClass: string;
  /** task_ci encoded suffix: class + opened_at lower bound. */
  openedSinceExtraQuery(rangeStart: string): string;
}

export const INCIDENT_TREND_CONFIG: TaskTrendQueryConfig = {
  taskClass: 'incident',
  openedSinceExtraQuery: (rangeStart) =>
    `task.sys_class_name=incident^task.opened_at>=${rangeStart}`,
};

export const CHANGE_TREND_CONFIG: TaskTrendQueryConfig = {
  taskClass: 'change_request',
  openedSinceExtraQuery: (rangeStart) =>
    `task.sys_class_name=change_request^task.opened_at>=${rangeStart}`,
};

/** Build a task_ci trend query for one CI (opened_at range, optional order). */
export function taskCiTrendQuery(
  ciSysId: string,
  config: TaskTrendQueryConfig,
  rangeStart: string,
  orderBy = 'ORDERBYtask.opened_at',
): string {
  return `ci_item.sys_id=${ciSysId}^${config.openedSinceExtraQuery(rangeStart)}^${orderBy}`;
}

export const CHANGE_TASK_CONFIG: RelatedTaskConfig = {
  taskClass: 'change_request',
  taskTable: 'change_request',
  // `javascript:gs.beginningOfToday()` is a ServiceNow server-side GlideScript expression
  // evaluated by the Table API — it is not a browser JavaScript URI.
  extraQuery:
    'task.sys_class_name=change_request^task.active=true^task.ref_change_request.start_date>=javascript:gs.beginningOfToday()', // NOSONAR: ServiceNow GlideScript server-side expression, not a browser URI
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'number',            label: 'Number'            },
    { element: 'type',              label: 'Type'              },
    { element: 'state',             label: 'State'             },
    { element: 'short_description', label: 'Short description' },
    { element: 'start_date',        label: 'Scheduled'         },
  ],
  emptyMessages: {
    application: 'No upcoming change requests linked to this application.',
    ci: 'No upcoming change requests linked to this CI.',
  },
};

/** Build a task_ci encoded query: optional prefix + config filter suffix. */
export function taskCiQuery(prefix: string, config: RelatedTaskConfig): string {
  return prefix ? `${prefix}^${config.extraQuery}` : config.extraQuery;
}

function buildTaskQuery(appSysId: string, config: RelatedTaskConfig): string {
  return taskCiQuery(`ci_item.sys_id=${appSysId}`, config);
}

export async function fetchRelatedTaskCountByQuery(
  queryPrefix: string,
  config: RelatedTaskConfig,
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!queryPrefix) return { totalCount: 0, access: 'ok' };
  const { totalCount, access } = await queryTableWithAccess({
    table: 'task_ci',
    query: taskCiQuery(queryPrefix, config),
    fields: ['sys_id'],
    limit: 1,
  });
  return { totalCount, access };
}

export async function fetchRelatedTaskPageByQuery(
  encodedQuery: string,
  config: RelatedTaskConfig,
  page: number,
  pageSize = RELATED_CI_PAGE_SIZE,
): Promise<RelatedTaskPage> {
  const layoutColumns = await loadListFields(
    config.taskTable,
    config.listTitle,
    config.defaultColumns,
  );

  if (!encodedQuery) {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'ok' };
  }

  const taskFields = [...new Set(['task.sys_id', ...layoutColumns.map(c => `task.${c.element}`)])];

  const { result: taskRows = [], totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'task_ci',
    query: `${encodedQuery}^ORDERBYtask.number`,
    fields: taskFields,
    limit: pageSize,
    offset: page * pageSize,
    displayValue: true,
  });

  if (access === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount: 0, access };
  }

  const { rows, columns } = mapTaskCiResultRows(taskRows, layoutColumns);

  return { rows, columns, totalCount, access };
}

const BRANCH_FETCH_CAP = 500;

function mapTaskCiResultRows(
  taskRows: Record<string, unknown>[],
  layoutColumns: ViewField[],
): { rows: RelatedTaskRow[]; columns: ViewField[] } {
  const columns = filterColumnsByRecords(layoutColumns, taskRows, 'task.');
  const seen = new Set<string>();
  const rows: RelatedTaskRow[] = [];

  for (const r of taskRows) {
    const sysId = raw(r['task.sys_id']);
    if (!sysId || seen.has(sysId)) continue;
    seen.add(sysId);

    const values: Record<string, string> = {};
    for (const col of columns) {
      if (col.element in r || `task.${col.element}` in r) {
        values[col.element] = str(r[`task.${col.element}`]);
      }
    }
    rows.push({ sysId, values });
  }

  return { rows, columns };
}

function mergeAccess(current: TableAccess, next: TableAccess): TableAccess {
  if (next === 'denied' || current === 'denied') return 'denied';
  if (next === 'error' || current === 'error') return 'error';
  return 'ok';
}

/** Fetch tasks for multiple encoded-query branches, merge distinct tasks, paginate client-side. */
export async function fetchRelatedTasksFromBranches(
  branches: string[],
  config: RelatedTaskConfig,
  page: number,
  pageSize = RELATED_CI_PAGE_SIZE,
): Promise<RelatedTaskPage> {
  const layoutColumns = await loadListFields(
    config.taskTable,
    config.listTitle,
    config.defaultColumns,
  );

  if (!branches.length) {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'ok' };
  }

  if (branches.length === 1) {
    return fetchAllTasksForBranch(branches[0], config, layoutColumns, page, pageSize);
  }

  const taskFields = [...new Set(['task.sys_id', ...layoutColumns.map(c => `task.${c.element}`)])];
  let access: TableAccess = 'ok';
  const merged: RelatedTaskRow[] = [];
  const seenTasks = new Set<string>();
  let columns = layoutColumns;

  for (const encodedQuery of branches) {
    const branchResult = await loadAllTasksForBranch(encodedQuery, taskFields, layoutColumns);
    access = mergeAccess(access, branchResult.access);
    if (branchResult.access === 'denied') {
      return { rows: [], columns: layoutColumns, totalCount: 0, access: 'denied' };
    }
    if (branchResult.columns.length) columns = branchResult.columns;
    for (const row of branchResult.rows) {
      if (seenTasks.has(row.sysId)) continue;
      seenTasks.add(row.sysId);
      merged.push(row);
    }
  }

  merged.sort((a, b) =>
    (a.values.number || '').localeCompare(b.values.number || '', undefined, { numeric: true }),
  );

  const totalCount = merged.length;
  const rows = merged.slice(page * pageSize, (page + 1) * pageSize);
  return { rows, columns, totalCount, access };
}

async function loadDistinctTaskIdsForBranch(
  encodedQuery: string,
): Promise<{ taskIds: string[]; access: TableAccess }> {
  const countRes = await queryTableWithAccess({
    table: 'task_ci',
    query: `${encodedQuery}^ORDERBYtask.number`,
    fields: ['sys_id'],
    limit: 1,
  });
  if (countRes.access === 'denied') {
    return { taskIds: [], access: 'denied' };
  }
  if (!countRes.totalCount) {
    return { taskIds: [], access: countRes.access };
  }

  const { result = [], access } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'task_ci',
    query: `${encodedQuery}^ORDERBYtask.number`,
    fields: ['task.sys_id'],
    limit: Math.min(countRes.totalCount, BRANCH_FETCH_CAP),
    displayValue: true,
  });

  const seen = new Set<string>();
  for (const r of result) {
    const id = raw(r['task.sys_id']);
    if (id) seen.add(id);
  }
  return { taskIds: [...seen], access };
}

/** Count distinct tasks across encoded-query branches (matches sidebar dedupe). */
export async function countDistinctRelatedTasksFromBranches(
  branches: string[],
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!branches.length) return { totalCount: 0, access: 'ok' };

  let access: TableAccess = 'ok';
  const seen = new Set<string>();

  for (const encodedQuery of branches) {
    const branchResult = await loadDistinctTaskIdsForBranch(encodedQuery);
    access = mergeAccess(access, branchResult.access);
    if (branchResult.access === 'denied') {
      return { totalCount: 0, access: 'denied' };
    }
    for (const id of branchResult.taskIds) seen.add(id);
  }

  return { totalCount: seen.size, access };
}

async function loadAllTasksForBranch(
  encodedQuery: string,
  taskFields: string[],
  layoutColumns: ViewField[],
): Promise<{ rows: RelatedTaskRow[]; columns: ViewField[]; access: TableAccess }> {
  const countRes = await queryTableWithAccess({
    table: 'task_ci',
    query: `${encodedQuery}^ORDERBYtask.number`,
    fields: ['sys_id'],
    limit: 1,
  });
  if (countRes.access === 'denied') {
    return { rows: [], columns: layoutColumns, access: 'denied' };
  }
  if (!countRes.totalCount) {
    return { rows: [], columns: layoutColumns, access: countRes.access };
  }

  const { result = [], access } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'task_ci',
    query: `${encodedQuery}^ORDERBYtask.number`,
    fields: taskFields,
    limit: Math.min(countRes.totalCount, BRANCH_FETCH_CAP),
    displayValue: true,
  });

  const mapped = mapTaskCiResultRows(result, layoutColumns);
  return { ...mapped, access };
}

async function fetchAllTasksForBranch(
  encodedQuery: string,
  config: RelatedTaskConfig,
  layoutColumns: ViewField[],
  page: number,
  pageSize: number,
): Promise<RelatedTaskPage> {
  const taskFields = [...new Set(['task.sys_id', ...layoutColumns.map(c => `task.${c.element}`)])];
  const branchResult = await loadAllTasksForBranch(encodedQuery, taskFields, layoutColumns);
  if (branchResult.access === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'denied' };
  }
  const totalCount = branchResult.rows.length;
  const rows = branchResult.rows.slice(page * pageSize, (page + 1) * pageSize);
  return { rows, columns: branchResult.columns, totalCount, access: branchResult.access };
}

export async function fetchRelatedTaskCount(
  appSysId: string,
  config: RelatedTaskConfig,
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!appSysId) return { totalCount: 0, access: 'ok' };
  const { totalCount, access } = await queryTableWithAccess({
    table: 'task_ci',
    query: buildTaskQuery(appSysId, config),
    fields: ['sys_id'],
    limit: 1,
  });
  return { totalCount, access };
}

export async function fetchRelatedTasksForRecord(
  recordSysId: string,
  config: RelatedTaskConfig,
): Promise<RelatedTaskPage> {
  const { totalCount, access } = await fetchRelatedTaskCount(recordSysId, config);
  if (access === 'denied' || !totalCount) {
    return { rows: [], columns: [], totalCount: 0, access };
  }
  return fetchRelatedTaskPage(recordSysId, config, 0, Math.min(totalCount, 100));
}

export async function fetchRelatedTaskPage(
  appSysId: string,
  config: RelatedTaskConfig,
  page: number,
  pageSize = RELATED_CI_PAGE_SIZE,
): Promise<RelatedTaskPage> {
  const layoutColumns = await loadListFields(
    config.taskTable,
    config.listTitle,
    config.defaultColumns,
  );

  if (!appSysId) {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'ok' };
  }

  const taskFields = [...new Set(['task.sys_id', ...layoutColumns.map(c => `task.${c.element}`)])];

  const { result: taskRows = [], totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'task_ci',
    query: `${buildTaskQuery(appSysId, config)}^ORDERBYtask.number`,
    fields: taskFields,
    limit: pageSize,
    offset: page * pageSize,
    displayValue: true,
  });

  if (access === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount: 0, access };
  }

  const { rows, columns } = mapTaskCiResultRows(taskRows, layoutColumns);
  return { rows, columns, totalCount, access };
}

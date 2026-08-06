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
  extraQuery:
    'task.sys_class_name=change_request^task.active=true^task.ref_change_request.start_date>=javascript:gs.beginningOfToday()',
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

  return { rows, columns, totalCount, access };
}

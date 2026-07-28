import { queryTable } from '../../api/servicenow';
import { raw } from './viewFields';

export interface TrendMonthBucket {
  monthKey: string;
  label: string;
  start: Date;
  end: Date;
}

export interface TrendMonthPoint {
  month: string;
  monthKey: string;
  incidents: number;
  changes: number;
  incidentListUrl: string;
  changeListUrl: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatSNDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatSNDateTimeStart(d: Date): string {
  return `${formatSNDate(d)} 00:00:00`;
}

function formatSNDateTimeEnd(d: Date): string {
  return `${formatSNDate(d)} 23:59:59`;
}

/** Last 6 calendar months ending with the current month. */
export function getLast6MonthBuckets(now = new Date()): TrendMonthBucket[] {
  const buckets: TrendMonthBucket[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthKey = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`;
    const label = start.toLocaleString('en-US', { month: 'short' });
    buckets.push({ monthKey, label, start, end });
  }
  return buckets;
}

function parseOpenedAt(value: string): Date | null {
  if (!value) return null;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function monthKeyForDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

function buildTaskListUrl(
  table: 'incident' | 'change_request',
  taskSysIds: string[],
  bucket: TrendMonthBucket,
): string {
  const start = formatSNDateTimeStart(bucket.start);
  const end = formatSNDateTimeEnd(bucket.end);

  const query = taskSysIds.length > 0
    ? `sys_idIN${taskSysIds.join(',')}`
    : `opened_at>=${start}^opened_at<=${end}^sys_id=00000000000000000000000000000000`;

  return `/${table}_list.do?sysparm_query=${encodeURIComponent(query)}`;
}

async function fetchOpenedTasksForCi(
  ciSysId: string,
  taskClass: 'incident' | 'change_request',
  rangeStart: Date,
): Promise<Map<string, string[]>> {
  const byMonth = new Map<string, string[]>();
  const seen = new Set<string>();
  const rangeStartStr = formatSNDateTimeStart(rangeStart);

  let offset = 0;
  const limit = 500;

  while (true) {
    const { result, totalCount } = await queryTable<Record<string, unknown>>({
      table: 'task_ci',
      query: `ci_item.sys_id=${ciSysId}^task.sys_class_name=${taskClass}^task.opened_at>=${rangeStartStr}^ORDERBYtask.opened_at`,
      fields: ['task.sys_id', 'task.opened_at'],
      limit,
      offset,
      displayValue: false,
    });

    for (const row of result ?? []) {
      const taskId = raw(row['task.sys_id']);
      const openedRaw = raw(row['task.opened_at']);
      if (!taskId || seen.has(taskId)) continue;
      seen.add(taskId);

      const opened = parseOpenedAt(openedRaw);
      if (!opened) continue;

      const key = monthKeyForDate(opened);
      const list = byMonth.get(key) ?? [];
      list.push(taskId);
      byMonth.set(key, list);
    }

    offset += limit;
    if (!result?.length || offset >= totalCount) break;
  }

  return byMonth;
}

export async function fetchCITaskTrend(ciSysId: string): Promise<TrendMonthPoint[]> {
  const buckets = getLast6MonthBuckets();
  if (!ciSysId) {
    return buckets.map(b => ({
      month: b.label,
      monthKey: b.monthKey,
      incidents: 0,
      changes: 0,
      incidentListUrl: buildTaskListUrl('incident', [], b),
      changeListUrl: buildTaskListUrl('change_request', [], b),
    }));
  }

  const rangeStart = buckets[0].start;
  const [incidentByMonth, changeByMonth] = await Promise.all([
    fetchOpenedTasksForCi(ciSysId, 'incident', rangeStart),
    fetchOpenedTasksForCi(ciSysId, 'change_request', rangeStart),
  ]);

  return buckets.map(bucket => {
    const incIds = incidentByMonth.get(bucket.monthKey) ?? [];
    const chgIds = changeByMonth.get(bucket.monthKey) ?? [];
    return {
      month: bucket.label,
      monthKey: bucket.monthKey,
      incidents: incIds.length,
      changes: chgIds.length,
      incidentListUrl: buildTaskListUrl('incident', incIds, bucket),
      changeListUrl: buildTaskListUrl('change_request', chgIds, bucket),
    };
  });
}

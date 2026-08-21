import { queryTableWithAccess } from '../../api/servicenow';
import { CHANGE_TASK_CONFIG, INCIDENT_TASK_CONFIG } from './relatedTasks';
import { raw } from './viewFields';

export interface CITaskFlagCounts {
  incidents: number;
  changes: number;
}

function emptyCounts(): CITaskFlagCounts {
  return { incidents: 0, changes: 0 };
}

function countTasksByCi(rows: Record<string, unknown>[]): Map<string, number> {
  const perCi = new Map<string, Set<string>>();
  for (const r of rows) {
    const ciId = raw(r['ci_item.sys_id']);
    const taskId = raw(r['task.sys_id']);
    if (!ciId || !taskId) continue;
    if (!perCi.has(ciId)) perCi.set(ciId, new Set());
    perCi.get(ciId)!.add(taskId);
  }
  const counts = new Map<string, number>();
  for (const [ciId, tasks] of perCi) counts.set(ciId, tasks.size);
  return counts;
}

async function fetchTaskCiRowsForQuery(
  query: string,
): Promise<{ rows: Record<string, unknown>[]; access: 'ok' | 'denied' | 'error' }> {
  const countRes = await queryTableWithAccess<Record<string, unknown>>({
    table: 'task_ci',
    query,
    fields: ['ci_item.sys_id', 'task.sys_id'],
    limit: 1,
  });
  if (countRes.access === 'denied') {
    return { rows: [], access: 'denied' };
  }
  if (!countRes.totalCount) {
    return { rows: [], access: countRes.access };
  }

  const { result = [], access } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'task_ci',
    query,
    fields: ['ci_item.sys_id', 'task.sys_id'],
    limit: countRes.totalCount,
  });
  return { rows: result, access };
}

/** Active incident / upcoming change counts per CI (task_ci affected items). */
export async function fetchCITaskFlagCounts(
  ciSysIds: string[],
): Promise<Map<string, CITaskFlagCounts>> {
  const result = new Map<string, CITaskFlagCounts>();
  if (!ciSysIds.length) return result;

  for (const id of ciSysIds) result.set(id, emptyCounts());

  const idsQuery = ciSysIds.join(',');

  const [incRes, chgRes] = await Promise.all([
    fetchTaskCiRowsForQuery(`ci_item.sys_idIN${idsQuery}^${INCIDENT_TASK_CONFIG.extraQuery}`),
    fetchTaskCiRowsForQuery(`ci_item.sys_idIN${idsQuery}^${CHANGE_TASK_CONFIG.extraQuery}`),
  ]);

  if (incRes.access !== 'denied') {
    for (const [ciId, count] of countTasksByCi(incRes.rows)) {
      const entry = result.get(ciId);
      if (entry) entry.incidents = count;
    }
  }

  if (chgRes.access !== 'denied') {
    for (const [ciId, count] of countTasksByCi(chgRes.rows)) {
      const entry = result.get(ciId);
      if (entry) entry.changes = count;
    }
  }

  return result;
}

/** Attach live task_ci flag counts to rows (e.g. search / related list pages). */
export async function enrichRowsWithTaskFlags<T extends { sysId: string }>(
  rows: T[],
): Promise<Array<T & { incidents: number; changes: number }>> {
  if (!rows.length) return [];
  const counts = await fetchCITaskFlagCounts(rows.map(r => r.sysId));
  return rows.map(row => {
    const flags = counts.get(row.sysId);
    return {
      ...row,
      incidents: flags?.incidents ?? 0,
      changes: flags?.changes ?? 0,
    };
  });
}

import { queryTableWithAccess } from '../../api/servicenow';
import { raw } from './viewFields';

const ACTIVE_INCIDENT_QUERY = 'task.sys_class_name=incident^task.active=true';
const APPROVED_CHANGE_QUERY = 'task.sys_class_name=change_request^task.state=-2';

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

/** Active incident / approved change counts per CI (task_ci affected items). */
export async function fetchCITaskFlagCounts(
  ciSysIds: string[],
): Promise<Map<string, CITaskFlagCounts>> {
  const result = new Map<string, CITaskFlagCounts>();
  if (!ciSysIds.length) return result;

  for (const id of ciSysIds) result.set(id, emptyCounts());

  const idsQuery = ciSysIds.join(',');

  const [incRes, chgRes] = await Promise.all([
    queryTableWithAccess<Record<string, unknown>>({
      table: 'task_ci',
      query: `ci_item.sys_idIN${idsQuery}^${ACTIVE_INCIDENT_QUERY}`,
      fields: ['ci_item.sys_id', 'task.sys_id'],
      limit: 500,
    }),
    queryTableWithAccess<Record<string, unknown>>({
      table: 'task_ci',
      query: `ci_item.sys_idIN${idsQuery}^${APPROVED_CHANGE_QUERY}`,
      fields: ['ci_item.sys_id', 'task.sys_id'],
      limit: 500,
    }),
  ]);

  if (incRes.access !== 'denied') {
    for (const [ciId, count] of countTasksByCi(incRes.result ?? [])) {
      const entry = result.get(ciId);
      if (entry) entry.incidents = count;
    }
  }

  if (chgRes.access !== 'denied') {
    for (const [ciId, count] of countTasksByCi(chgRes.result ?? [])) {
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

import { fetchCiTaskFlagCountsBatch } from '../../api/servicenow';

export interface CITaskFlagCounts {
  incidents: number;
  changes: number;
}

const CI_FLAG_COUNT_CHUNK = 150;

function emptyCounts(): CITaskFlagCounts {
  return { incidents: 0, changes: 0 };
}

/** Active incident / upcoming change counts per CI (distinct tasks via GlideAggregate). */
export async function fetchCITaskFlagCounts(
  ciSysIds: string[],
): Promise<Map<string, CITaskFlagCounts>> {
  const result = new Map<string, CITaskFlagCounts>();
  if (!ciSysIds.length) return result;

  for (const id of ciSysIds) result.set(id, emptyCounts());

  for (let i = 0; i < ciSysIds.length; i += CI_FLAG_COUNT_CHUNK) {
    const slice = ciSysIds.slice(i, i + CI_FLAG_COUNT_CHUNK);
    const batch = await fetchCiTaskFlagCountsBatch(slice);

    for (const id of slice) {
      const entry = batch.counts[id];
      const target = result.get(id);
      if (!target) continue;
      if (batch.access.incidents !== 'denied') {
        target.incidents = entry?.incidents ?? 0;
      }
      if (batch.access.changes !== 'denied') {
        target.changes = entry?.changes ?? 0;
      }
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

import { queryTableWithAccess, type TableAccess } from '../../api/servicenow';
import { filterColumnsByRecords } from './acl';
import { loadListFields, raw, str, type ViewField } from './viewFields';
import { LIST_VIEW_TITLE } from './relatedCIs';

export const CMDB_HEALTH_TABLE = 'cmdb_health_result';

export const HEALTH_DEFAULT_COLUMNS: ViewField[] = [
  { element: 'name',         label: 'Metric'       },
  { element: 'score',        label: 'Score'        },
  { element: 'status',       label: 'Status'       },
  { element: 'last_checked', label: 'Last checked' },
];

export interface HealthResultRow {
  sysId: string;
  values: Record<string, string>;
}

export interface HealthResultsPage {
  rows: HealthResultRow[];
  columns: ViewField[];
  totalCount: number;
  access: TableAccess;
}

function buildHealthQuery(ciSysId: string): string {
  return `active=true^ci=${ciSysId}^ORDERBYname`;
}

function buildHealthQueryByPrefix(queryPrefix: string): string {
  if (!queryPrefix) return 'active=true^sys_id=-1';
  // Full encoded queries from CI search summary already include active=true per ^NQ branch.
  if (queryPrefix.startsWith('active=true') || queryPrefix.includes('^NQ')) {
    return queryPrefix;
  }
  return `active=true^${queryPrefix}`;
}

export async function fetchCmdbHealthCountByQuery(
  queryPrefix: string,
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!queryPrefix) return { totalCount: 0, access: 'ok' };
  const { totalCount, access } = await queryTableWithAccess({
    table: CMDB_HEALTH_TABLE,
    query: buildHealthQueryByPrefix(queryPrefix),
    fields: ['sys_id'],
    limit: 1,
  });
  return { totalCount, access };
}

export async function fetchCmdbHealthPageByQuery(
  queryPrefix: string,
  page: number,
  pageSize = 10,
): Promise<HealthResultsPage> {
  const columns = await loadListFields(
    CMDB_HEALTH_TABLE,
    LIST_VIEW_TITLE,
    HEALTH_DEFAULT_COLUMNS,
  );

  if (!queryPrefix) {
    return { rows: [], columns, totalCount: 0, access: 'ok' };
  }

  const fields = [...new Set(['sys_id', ...columns.map(c => c.element)])];

  const { result = [], totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: CMDB_HEALTH_TABLE,
    query: `${buildHealthQueryByPrefix(queryPrefix)}^ORDERBYname`,
    fields,
    limit: pageSize,
    offset: page * pageSize,
    displayValue: true,
  });

  if (access === 'denied') {
    return { rows: [], columns, totalCount: 0, access };
  }

  const readableColumns = filterColumnsByRecords(columns, result);

  const rows: HealthResultRow[] = result.map(rec => {
    const sysId = raw(rec.sys_id);
    const values: Record<string, string> = {};
    for (const col of readableColumns) {
      if (col.element in rec) {
        values[col.element] = str(rec[col.element]);
      }
    }
    return { sysId, values };
  }).filter(r => r.sysId);

  return { rows, columns: readableColumns, totalCount, access };
}

const HEALTH_BRANCH_FETCH_CAP = 500;

function mergeHealthAccess(current: TableAccess, next: TableAccess): TableAccess {
  if (next === 'denied' || current === 'denied') return 'denied';
  if (next === 'error' || current === 'error') return 'error';
  return 'ok';
}

function mapHealthResultRows(
  records: Record<string, unknown>[],
  columns: ViewField[],
): { rows: HealthResultRow[]; columns: ViewField[] } {
  const readableColumns = filterColumnsByRecords(columns, records);
  const rows: HealthResultRow[] = records.map(rec => {
    const sysId = raw(rec.sys_id);
    const values: Record<string, string> = {};
    for (const col of readableColumns) {
      if (col.element in rec) {
        values[col.element] = str(rec[col.element]);
      }
    }
    return { sysId, values };
  }).filter(r => r.sysId);
  return { rows, columns: readableColumns };
}

/** Fetch health metrics for multiple query branches, merge, paginate client-side. */
export async function fetchCmdbHealthFromBranches(
  branches: string[],
  page: number,
  pageSize = 10,
): Promise<HealthResultsPage> {
  const columns = await loadListFields(
    CMDB_HEALTH_TABLE,
    LIST_VIEW_TITLE,
    HEALTH_DEFAULT_COLUMNS,
  );

  if (!branches.length) {
    return { rows: [], columns, totalCount: 0, access: 'ok' };
  }

  if (branches.length === 1) {
    return fetchAllHealthForBranch(branches[0], columns, page, pageSize);
  }

  const fields = [...new Set(['sys_id', ...columns.map(c => c.element)])];
  let access: TableAccess = 'ok';
  const merged: HealthResultRow[] = [];
  const seen = new Set<string>();
  let readableColumns = columns;

  for (const branchQuery of branches) {
    const branchResult = await loadAllHealthForBranch(branchQuery, fields, columns);
    access = mergeHealthAccess(access, branchResult.access);
    if (branchResult.access === 'denied') {
      return { rows: [], columns, totalCount: 0, access: 'denied' };
    }
    if (branchResult.columns.length) readableColumns = branchResult.columns;
    for (const row of branchResult.rows) {
      if (seen.has(row.sysId)) continue;
      seen.add(row.sysId);
      merged.push(row);
    }
  }

  merged.sort((a, b) =>
    (a.values.name || '').localeCompare(b.values.name || '', undefined, { sensitivity: 'base' }),
  );

  const totalCount = merged.length;
  const rows = merged.slice(page * pageSize, (page + 1) * pageSize);
  return { rows, columns: readableColumns, totalCount, access };
}

async function loadDistinctHealthIdsForBranch(
  branchQuery: string,
): Promise<{ ids: string[]; access: TableAccess }> {
  const query = `${buildHealthQueryByPrefix(branchQuery)}^ORDERBYname`;
  const countRes = await queryTableWithAccess({
    table: CMDB_HEALTH_TABLE,
    query,
    fields: ['sys_id'],
    limit: 1,
  });
  if (countRes.access === 'denied') {
    return { ids: [], access: 'denied' };
  }
  if (!countRes.totalCount) {
    return { ids: [], access: countRes.access };
  }

  const { result = [], access } = await queryTableWithAccess<Record<string, unknown>>({
    table: CMDB_HEALTH_TABLE,
    query,
    fields: ['sys_id'],
    limit: Math.min(countRes.totalCount, HEALTH_BRANCH_FETCH_CAP),
    displayValue: true,
  });

  const seen = new Set<string>();
  for (const r of result) {
    const id = raw(r.sys_id);
    if (id) seen.add(id);
  }
  return { ids: [...seen], access };
}

/** Count distinct health metrics across query branches (matches sidebar dedupe). */
export async function countDistinctHealthFromBranches(
  branches: string[],
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!branches.length) return { totalCount: 0, access: 'ok' };

  let access: TableAccess = 'ok';
  const seen = new Set<string>();

  for (const branchQuery of branches) {
    const branchResult = await loadDistinctHealthIdsForBranch(branchQuery);
    access = mergeHealthAccess(access, branchResult.access);
    if (branchResult.access === 'denied') {
      return { totalCount: 0, access: 'denied' };
    }
    for (const id of branchResult.ids) seen.add(id);
  }

  return { totalCount: seen.size, access };
}

async function loadAllHealthForBranch(
  branchQuery: string,
  fields: string[],
  columns: ViewField[],
): Promise<{ rows: HealthResultRow[]; columns: ViewField[]; access: TableAccess }> {
  const query = `${buildHealthQueryByPrefix(branchQuery)}^ORDERBYname`;
  const countRes = await queryTableWithAccess({
    table: CMDB_HEALTH_TABLE,
    query,
    fields: ['sys_id'],
    limit: 1,
  });
  if (countRes.access === 'denied') {
    return { rows: [], columns, access: 'denied' };
  }
  if (!countRes.totalCount) {
    return { rows: [], columns, access: countRes.access };
  }

  const { result = [], access } = await queryTableWithAccess<Record<string, unknown>>({
    table: CMDB_HEALTH_TABLE,
    query,
    fields,
    limit: Math.min(countRes.totalCount, HEALTH_BRANCH_FETCH_CAP),
    displayValue: true,
  });

  const mapped = mapHealthResultRows(result, columns);
  return { ...mapped, access };
}

async function fetchAllHealthForBranch(
  branchQuery: string,
  columns: ViewField[],
  page: number,
  pageSize: number,
): Promise<HealthResultsPage> {
  const fields = [...new Set(['sys_id', ...columns.map(c => c.element)])];
  const branchResult = await loadAllHealthForBranch(branchQuery, fields, columns);
  if (branchResult.access === 'denied') {
    return { rows: [], columns, totalCount: 0, access: 'denied' };
  }
  const totalCount = branchResult.rows.length;
  const rows = branchResult.rows.slice(page * pageSize, (page + 1) * pageSize);
  return { rows, columns: branchResult.columns, totalCount, access: branchResult.access };
}

export async function fetchCmdbHealthResults(ciSysId: string): Promise<HealthResultsPage> {
  const columns = await loadListFields(
    CMDB_HEALTH_TABLE,
    LIST_VIEW_TITLE,
    HEALTH_DEFAULT_COLUMNS,
  );

  if (!ciSysId) {
    return { rows: [], columns, totalCount: 0, access: 'ok' };
  }

  const fields = [...new Set(['sys_id', ...columns.map(c => c.element)])];

  const { result = [], totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: CMDB_HEALTH_TABLE,
    query: buildHealthQuery(ciSysId),
    fields,
    limit: 100,
    displayValue: true,
  });

  if (access === 'denied') {
    return { rows: [], columns, totalCount: 0, access };
  }

  const readableColumns = filterColumnsByRecords(columns, result);

  const rows: HealthResultRow[] = result.map(rec => {
    const sysId = raw(rec.sys_id);
    const values: Record<string, string> = {};
    for (const col of readableColumns) {
      if (col.element in rec) {
        values[col.element] = str(rec[col.element]);
      }
    }
    return { sysId, values };
  }).filter(r => r.sysId);

  return { rows, columns: readableColumns, totalCount, access };
}

export function healthRecordUrl(sysId: string): string {
  return `/${CMDB_HEALTH_TABLE}.do?sys_id=${sysId}`;
}

export function healthListUrl(ciSysId: string): string {
  const query = encodeURIComponent(`active=true^ci=${ciSysId}^ORDERBYname`);
  return `/${CMDB_HEALTH_TABLE}_list.do?sysparm_query=${query}`;
}

/** Parse a numeric score (0–100) from display or raw values. */
export function parseHealthScore(value: string): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (Number.isNaN(n)) return null;
  return n > 100 ? Math.min(100, n) : n;
}

export function healthStatusTone(status: string): 'good' | 'warning' | 'bad' | 'neutral' {
  const s = status.toLowerCase();
  if (!s) return 'neutral';
  if (s.includes('pass') || s.includes('good') || s.includes('ok') || s.includes('compliant') || s.includes('healthy')) {
    return 'good';
  }
  if (s.includes('warn') || s.includes('attention') || s.includes('degraded')) {
    return 'warning';
  }
  if (s.includes('fail') || s.includes('critical') || s.includes('error') || s.includes('non')) {
    return 'bad';
  }
  return 'neutral';
}

const BADGE_ELEMENTS = new Set(['status', 'state']);
const SCORE_ELEMENTS = new Set(['score', 'health_score', 'percentage', 'compliance_score', 'health']);

export function isBadgeElement(element: string): boolean {
  return BADGE_ELEMENTS.has(element);
}

export function isScoreElement(element: string): boolean {
  return SCORE_ELEMENTS.has(element);
}

export function statusBadgeClass(tone: 'good' | 'warning' | 'bad' | 'neutral'): string {
  switch (tone) {
    case 'good':    return 'bg-green-100 text-green-700';
    case 'warning': return 'bg-yellow-100 text-yellow-700';
    case 'bad':     return 'bg-red-100 text-red-700';
    default:        return 'bg-gray-100 text-gray-600';
  }
}

export function scoreBarClass(tone: 'good' | 'warning' | 'bad' | 'neutral'): string {
  switch (tone) {
    case 'good':    return 'bg-green-500';
    case 'warning': return 'bg-yellow-500';
    case 'bad':     return 'bg-red-500';
    default:        return 'bg-blue-500';
  }
}

export function scoreTextClass(tone: 'good' | 'warning' | 'bad' | 'neutral'): string {
  switch (tone) {
    case 'good':    return 'text-green-600';
    case 'warning': return 'text-yellow-600';
    case 'bad':     return 'text-red-600';
    default:        return 'text-gray-700';
  }
}

export function toneFromScore(score: number): 'good' | 'warning' | 'bad' | 'neutral' {
  if (score >= 80) return 'good';
  if (score >= 60) return 'warning';
  return 'bad';
}

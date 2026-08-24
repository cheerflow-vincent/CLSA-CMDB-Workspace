import { queryTableWithAccess, type TableAccess } from '../../api/servicenow';
import { filterColumnsByRecords } from './acl';
import { loadListFields, raw, str, type ViewField } from './viewFields';
import { LIST_VIEW_TITLE } from './relatedCIs';
import { joinOrEncodedQueries } from './searchQuery';

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

function buildCombinedHealthQuery(branches: string[]): string {
  return joinOrEncodedQueries(
    branches.map(branchQuery => buildHealthQueryByPrefix(branchQuery)),
  );
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

/** Fetch health metrics for query branches with server-backed pagination. */
export async function fetchCmdbHealthFromBranches(
  branches: string[],
  page: number,
  pageSize = 10,
): Promise<HealthResultsPage> {
  if (!branches.length) {
    const columns = await loadListFields(
      CMDB_HEALTH_TABLE,
      LIST_VIEW_TITLE,
      HEALTH_DEFAULT_COLUMNS,
    );
    return { rows: [], columns, totalCount: 0, access: 'ok' };
  }

  const combined = buildCombinedHealthQuery(branches);
  return fetchCmdbHealthPageByQuery(combined, page, pageSize);
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

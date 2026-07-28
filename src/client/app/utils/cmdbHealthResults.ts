import { queryTable } from '../../api/servicenow';
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
}

function buildHealthQuery(ciSysId: string): string {
  return `active=true^ci=${ciSysId}^ORDERBYname`;
}

export async function fetchCmdbHealthResults(ciSysId: string): Promise<HealthResultsPage> {
  const columns = await loadListFields(
    CMDB_HEALTH_TABLE,
    LIST_VIEW_TITLE,
    HEALTH_DEFAULT_COLUMNS,
  );

  if (!ciSysId) {
    return { rows: [], columns, totalCount: 0 };
  }

  const fields = [...new Set(['sys_id', ...columns.map(c => c.element)])];

  const { result = [], totalCount } = await queryTable<Record<string, unknown>>({
    table: CMDB_HEALTH_TABLE,
    query: buildHealthQuery(ciSysId),
    fields,
    limit: 100,
    displayValue: true,
  });

  const rows: HealthResultRow[] = result.map(rec => {
    const sysId = raw(rec.sys_id);
    const values: Record<string, string> = {};
    for (const col of columns) {
      values[col.element] = str(rec[col.element]);
    }
    return { sysId, values };
  }).filter(r => r.sysId);

  return { rows, columns, totalCount };
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

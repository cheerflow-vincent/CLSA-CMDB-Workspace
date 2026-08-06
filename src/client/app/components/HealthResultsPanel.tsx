import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Shield } from 'lucide-react';
import type { TableAccess } from '../../api/servicenow';
import { isAccessDenied } from '../utils/acl';
import type { ViewField } from '../utils/viewFields';
import {
  fetchCmdbHealthResults,
  healthRecordUrl,
  healthListUrl,
  parseHealthScore,
  healthStatusTone,
  isBadgeElement,
  isScoreElement,
  statusBadgeClass,
  scoreBarClass,
  scoreTextClass,
  toneFromScore,
  type HealthResultRow,
} from '../utils/cmdbHealthResults';

function val(row: HealthResultRow, key: string): string {
  if (!(key in row.values)) return '';
  const v = row.values[key];
  return v && v !== '—' ? v : '';
}

function resolveTone(row: HealthResultRow, columns: ViewField[]): 'good' | 'warning' | 'bad' | 'neutral' {
  for (const col of columns) {
    if (isBadgeElement(col.element)) {
      const statusVal = val(row, col.element);
      if (statusVal) return healthStatusTone(statusVal);
    }
  }
  for (const col of columns) {
    if (isScoreElement(col.element)) {
      const scoreNum = parseHealthScore(val(row, col.element));
      if (scoreNum != null) return toneFromScore(scoreNum);
    }
  }
  return 'neutral';
}

function BodyField({
  col,
  row,
  tone,
}: {
  col: ViewField;
  row: HealthResultRow;
  tone: 'good' | 'warning' | 'bad' | 'neutral';
}) {
  if (!(col.element in row.values)) return null;
  const value = val(row, col.element);
  if (!value) return null;

  if (isScoreElement(col.element)) {
    const scoreNum = parseHealthScore(value);
    const fieldTone = scoreNum != null ? toneFromScore(scoreNum) : tone;
    return (
      <div key={col.element} className="mb-3">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-gray-600">{col.label}</span>
          <span className={`font-semibold ${scoreTextClass(fieldTone)}`}>{value}</span>
        </div>
        {scoreNum != null && (
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${scoreBarClass(fieldTone)}`}
              style={{ width: `${Math.min(100, Math.max(0, scoreNum))}%` }}
            />
          </div>
        )}
      </div>
    );
  }

  if (isBadgeElement(col.element)) {
    const badgeTone = healthStatusTone(value);
    return (
      <div key={col.element} className="rf-field-row rf-field-row--badge">
        <span className="rf-field-row__label">{col.label}</span>
        <span className={`inline-flex text-[10px] font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(badgeTone)}`}>
          {value}
        </span>
      </div>
    );
  }

  return (
    <div key={col.element} className="rf-field-grid">
      <span className="rf-field-row__label">{col.label}</span>
      <span className="rf-field-row__value">{value}</span>
    </div>
  );
}

function HealthResultCard({
  row,
  columns,
}: {
  row: HealthResultRow;
  columns: ViewField[];
}) {
  if (!columns.length) return null;

  const headerCol = columns[0];
  const bodyCols = columns.slice(1);
  const title = val(row, headerCol.element) || 'Health metric';
  const tone = resolveTone(row, columns);

  return (
    <div className="card-stack border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow bg-white flex flex-col">
      <div className="mb-3">
        <a
          href={healthRecordUrl(row.sysId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-blue-700 hover:underline leading-snug"
        >
          {title}
        </a>
      </div>

      {bodyCols.length > 0 && (
        <div className="border-t border-gray-100 pt-3 flex-1 space-y-1">
          {bodyCols.map(col => (
            <BodyField key={col.element} col={col} row={row} tone={tone} />
          ))}
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-gray-50 flex items-center justify-between gap-2">
        <span className="text-xs text-gray-400 flex items-center gap-1">
          {tone === 'good'
            ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
            : tone === 'warning' || tone === 'bad'
              ? <AlertCircle className="w-3.5 h-3.5 text-yellow-500" />
              : <Shield className="w-3.5 h-3.5 text-gray-400" />}
          {tone === 'good' ? 'OK' : tone === 'warning' ? 'Needs attention' : tone === 'bad' ? 'Action required' : 'Metric'}
        </span>
        <a
          href={healthRecordUrl(row.sysId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" /> ServiceNow
        </a>
      </div>
    </div>
  );
}

export default function HealthResultsPanel({
  ciSysId,
  onAccessResolved,
  refreshKey = 0,
}: {
  ciSysId: string;
  onAccessResolved?: (access: TableAccess) => void;
  refreshKey?: number;
}) {
  const [rows, setRows] = useState<HealthResultRow[]>([]);
  const [columns, setColumns] = useState<ViewField[]>([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<TableAccess>('ok');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchCmdbHealthResults(ciSysId)
      .then(({ rows: pageRows, columns: pageCols, access: acc }) => {
        if (cancelled) return;
        setRows(pageRows);
        setColumns(pageCols);
        setAccess(acc);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setColumns([]);
          setAccess('error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ciSysId, refreshKey]);

  useEffect(() => {
    onAccessResolved?.(access);
  }, [access, onAccessResolved]);

  if (isAccessDenied(access)) {
    return null;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-400 gap-2 text-sm">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading health metrics…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-400 italic text-center py-12">
        No active health metrics found for this CI.
      </p>
    );
  }

  return (
    <div>
      <div className="cards-grid-responsive">
        {rows.map(row => (
          <HealthResultCard key={row.sysId} row={row} columns={columns} />
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
        <a
          href={healthListUrl(ciSysId)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          <ExternalLink className="w-3.5 h-3.5" /> View all in ServiceNow
        </a>
      </div>
    </div>
  );
}

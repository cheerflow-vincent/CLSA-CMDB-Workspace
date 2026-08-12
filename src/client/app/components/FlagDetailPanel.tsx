import { useState, useEffect } from 'react';
import { AlertCircle, Calendar, ChevronLeft, ChevronRight, Loader2, Shield, X } from 'lucide-react';
import { TaskCard } from './taskListCards';
import { HealthResultCard } from './HealthResultsPanel';
import {
  INCIDENT_TASK_CONFIG,
  CHANGE_TASK_CONFIG,
  fetchRelatedTaskPage,
  fetchRelatedTaskPageByQuery,
  fetchRelatedTasksFromBranches,
  RELATED_TASK_PAGE_SIZE,
  taskCiQuery,
  type RelatedTaskConfig,
  type RelatedTaskRow,
} from '../utils/relatedTasks';
import {
  fetchCmdbHealthFromBranches,
  fetchCmdbHealthResults,
  type HealthResultRow,
} from '../utils/cmdbHealthResults';
import type { ViewField } from '../utils/viewFields';
import { isAccessDenied } from '../utils/acl';

export type FlagType = 'incident' | 'change' | 'health';

/** @deprecated Legacy mock/demo shape — live panel uses recordSysId + API fetch */
export interface IncidentRecord {
  number: string;
  priority: string;
  state: string;
  short: string;
  opened: string;
  assignee: string;
}

/** @deprecated Legacy mock/demo shape — live panel uses recordSysId + API fetch */
export interface ChangeRecord {
  number: string;
  type: string;
  state: string;
  short: string;
  scheduled: string;
  implementer: string;
}

interface FlagDetailPanelProps {
  title: string;
  subtitle?: string;
  flagType: FlagType;
  /** CI / instance sys_id — fetches live tasks via task_ci */
  recordSysId?: string;
  /** Full encoded query (CI search summary) or CI-only prefix for legacy callers */
  queryPrefix?: string;
  encodedQuery?: string;
  /** Per-tab/chunk encoded queries — merged client-side for All Results sidebar. */
  encodedQueries?: string[];
  /** Demo/mock fallback when recordSysId is absent */
  records?: IncidentRecord[] | ChangeRecord[];
  onClose: () => void;
}

const priorityColor: Record<string, string> = {
  'P1 - Critical': 'bg-red-100 text-red-700',
  'P2 - High':     'bg-orange-100 text-red-700',
  'P3 - Medium':   'bg-yellow-100 text-yellow-700',
  'P4 - Low':      'bg-gray-100 text-gray-600',
};
const stateColor: Record<string, string> = {
  'New':         'bg-blue-100 text-blue-700',
  'In Progress': 'bg-purple-100 text-purple-700',
  'Resolved':    'bg-green-100 text-green-700',
  'Closed':      'bg-gray-100 text-gray-500',
  'Scheduled':   'bg-blue-100 text-blue-700',
  'Approved':    'bg-green-100 text-green-700',
};
const changeTypeColor: Record<string, string> = {
  'Standard':  'bg-gray-100 text-gray-600',
  'Normal':    'bg-blue-100 text-blue-700',
  'Emergency': 'bg-red-100 text-red-700',
};

function PanelPaginationFooter({
  loading,
  totalCount,
  page,
  pageSize,
  onPrev,
  onNext,
  footerLabel,
}: {
  loading: boolean;
  totalCount: number;
  page: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
  footerLabel: string;
}) {
  const start = totalCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalCount);
  const showPagination = totalCount > pageSize;
  const canPrev = page > 0;
  const canNext = (page + 1) * pageSize < totalCount;

  return (
    <div className="shrink-0 border-t border-gray-100 bg-gray-50">
      {showPagination && (
        <div className="px-5 py-2 border-b border-gray-100 flex items-center justify-between">
          <span className="typo-caption text-gray-500">
            {start}–{end} of {totalCount}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={onPrev}
              disabled={!canPrev || loading}
              className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={!canNext || loading}
              className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>
      )}
      <div className="px-5 py-3">
        <p className="typo-caption">{footerLabel}</p>
      </div>
    </div>
  );
}

function LiveFlagRecords({
  recordSysId,
  queryPrefix,
  encodedQuery,
  encodedQueries,
  flagType,
}: {
  recordSysId?: string;
  queryPrefix?: string;
  encodedQuery?: string;
  encodedQueries?: string[];
  flagType: 'incident' | 'change';
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RelatedTaskRow[]>([]);
  const [columns, setColumns] = useState<ViewField[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  const config: RelatedTaskConfig = flagType === 'incident' ? INCIDENT_TASK_CONFIG : CHANGE_TASK_CONFIG;
  const pageSize = RELATED_TASK_PAGE_SIZE;
  const scopeKey = encodedQueries?.join('|') ?? encodedQuery ?? queryPrefix ?? recordSysId ?? '';

  useEffect(() => {
    setPage(0);
  }, [scopeKey, flagType]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fetchPage = encodedQueries?.length
      ? fetchRelatedTasksFromBranches(encodedQueries, config, page, pageSize)
      : encodedQuery
        ? fetchRelatedTasksFromBranches([encodedQuery], config, page, pageSize)
        : queryPrefix
          ? fetchRelatedTaskPageByQuery(taskCiQuery(queryPrefix, config), config, page, pageSize)
          : fetchRelatedTaskPage(recordSysId!, config, page, pageSize);

    fetchPage
      .then(({ rows: pageRows, columns: pageCols, totalCount: count, access }) => {
        if (cancelled) return;
        if (isAccessDenied(access)) {
          setRows([]);
          setColumns([]);
          setTotalCount(0);
          return;
        }
        setRows(pageRows);
        setColumns(pageCols);
        setTotalCount(count);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setColumns([]);
          setTotalCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [scopeKey, encodedQueries, encodedQuery, queryPrefix, recordSysId, flagType, page, pageSize, config]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [totalCount, page, pageSize]);

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2 typo-body">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : !rows.length ? (
          <p className="typo-body text-gray-400 text-center mt-10">No records found.</p>
        ) : (
          rows.map(row => (
            <TaskCard key={row.sysId} row={row} config={config} columns={columns} />
          ))
        )}
      </div>

      <PanelPaginationFooter
        loading={loading}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPrev={() => setPage(p => p - 1)}
        onNext={() => setPage(p => p + 1)}
        footerLabel={
          totalCount > 0
            ? `${totalCount} linked task${totalCount !== 1 ? 's' : ''} from ServiceNow`
            : 'Linked tasks from ServiceNow'
        }
      />
    </>
  );
}

function LiveHealthRecords({
  recordSysId,
  queryPrefix,
  encodedQuery,
  encodedQueries,
}: {
  recordSysId?: string;
  queryPrefix?: string;
  encodedQuery?: string;
  encodedQueries?: string[];
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<HealthResultRow[]>([]);
  const [columns, setColumns] = useState<ViewField[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);

  const pageSize = RELATED_TASK_PAGE_SIZE;
  const scopeKey = encodedQueries?.join('|') ?? encodedQuery ?? queryPrefix ?? recordSysId ?? '';

  useEffect(() => {
    setPage(0);
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const fetchPage = encodedQueries?.length
      ? fetchCmdbHealthFromBranches(encodedQueries, page, pageSize)
      : (encodedQuery ?? queryPrefix)
        ? fetchCmdbHealthFromBranches([encodedQuery ?? queryPrefix!], page, pageSize)
        : fetchCmdbHealthResults(recordSysId!).then(result => ({
            ...result,
            totalCount: result.totalCount || result.rows.length,
          }));

    fetchPage
      .then(({ rows: pageRows, columns: pageCols, totalCount: count, access }) => {
        if (cancelled) return;
        if (isAccessDenied(access)) {
          setRows([]);
          setColumns([]);
          setTotalCount(0);
          return;
        }
        setRows(pageRows);
        setColumns(pageCols);
        setTotalCount(count);
      })
      .catch(() => {
        if (!cancelled) {
          setRows([]);
          setColumns([]);
          setTotalCount(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [scopeKey, encodedQueries, encodedQuery, queryPrefix, recordSysId, page, pageSize]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [totalCount, page, pageSize]);

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2 typo-body">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : !rows.length ? (
          <p className="typo-body text-gray-400 text-center mt-10">No health metrics found.</p>
        ) : (
          rows.map(row => (
            <HealthResultCard key={row.sysId} row={row} columns={columns} />
          ))
        )}
      </div>

      <PanelPaginationFooter
        loading={loading}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPrev={() => setPage(p => p - 1)}
        onNext={() => setPage(p => p + 1)}
        footerLabel={
          totalCount > 0
            ? `${totalCount} active health metric${totalCount !== 1 ? 's' : ''} from ServiceNow`
            : 'Health metrics from ServiceNow'
        }
      />
    </>
  );
}

function LegacyRecordList({
  flagType,
  records,
}: {
  flagType: 'incident' | 'change';
  records: IncidentRecord[] | ChangeRecord[];
}) {
  const [page, setPage] = useState(0);
  const pageSize = RELATED_TASK_PAGE_SIZE;

  useEffect(() => {
    setPage(0);
  }, [flagType, records]);

  const totalCount = records.length;
  const pageRows = records.slice(page * pageSize, (page + 1) * pageSize);
  const isIncident = flagType === 'incident';

  if (!records.length) {
    return (
      <>
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          <p className="typo-body text-gray-400 text-center mt-10">No records found.</p>
        </div>
        <div className="shrink-0 px-5 py-3 border-t border-gray-100 bg-gray-50">
          <p className="typo-caption">0 records linked</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto p-5 space-y-4 min-h-0">
        {isIncident ? (
          (pageRows as IncidentRecord[]).map((rec, i) => (
            <div key={`${rec.number}-${i}`} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="typo-body font-semibold text-blue-700">{rec.number}</span>
                <div className="flex gap-2">
                  <span className={`typo-badge px-2 py-0.5 rounded-full ${priorityColor[rec.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                    {rec.priority}
                  </span>
                  <span className={`typo-badge px-2 py-0.5 rounded-full ${stateColor[rec.state] ?? 'bg-gray-100 text-gray-600'}`}>
                    {rec.state}
                  </span>
                </div>
              </div>
              <p className="typo-body text-gray-800 mb-3">{rec.short}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 typo-body">
                <span className="text-gray-400">Opened</span>   <span className="text-gray-700">{rec.opened}</span>
                <span className="text-gray-400">Assignee</span> <span className="text-gray-700">{rec.assignee}</span>
              </div>
            </div>
          ))
        ) : (
          (pageRows as ChangeRecord[]).map((rec, i) => (
            <div key={`${rec.number}-${i}`} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="typo-body font-semibold text-blue-700">{rec.number}</span>
                <div className="flex gap-2">
                  <span className={`typo-badge px-2 py-0.5 rounded-full ${changeTypeColor[rec.type] ?? 'bg-gray-100 text-gray-600'}`}>
                    {rec.type}
                  </span>
                  <span className={`typo-badge px-2 py-0.5 rounded-full ${stateColor[rec.state] ?? 'bg-gray-100 text-gray-600'}`}>
                    {rec.state}
                  </span>
                </div>
              </div>
              <p className="typo-body text-gray-800 mb-3">{rec.short}</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 typo-body">
                <span className="text-gray-400">Scheduled</span>   <span className="text-gray-700">{rec.scheduled}</span>
                <span className="text-gray-400">Implementer</span> <span className="text-gray-700">{rec.implementer}</span>
              </div>
            </div>
          ))
        )}
      </div>

      <PanelPaginationFooter
        loading={false}
        totalCount={totalCount}
        page={page}
        pageSize={pageSize}
        onPrev={() => setPage(p => p - 1)}
        onNext={() => setPage(p => p + 1)}
        footerLabel={`${totalCount} record${totalCount !== 1 ? 's' : ''} linked`}
      />
    </>
  );
}

function panelHeaderClass(flagType: FlagType): string {
  switch (flagType) {
    case 'incident': return 'bg-red-50 border-red-100';
    case 'change':   return 'bg-yellow-50 border-yellow-100';
    case 'health':   return 'bg-blue-50 border-blue-100';
  }
}

function panelTitleClass(flagType: FlagType): string {
  switch (flagType) {
    case 'incident': return 'text-red-700';
    case 'change':   return 'text-yellow-700';
    case 'health':   return 'text-blue-700';
  }
}

function panelLabel(flagType: FlagType): string {
  switch (flagType) {
    case 'incident': return 'Active Incidents';
    case 'change':   return 'Scheduled Changes';
    case 'health':   return 'Active Health Metrics';
  }
}

export default function FlagDetailPanel({
  title,
  subtitle,
  flagType,
  recordSysId,
  queryPrefix,
  encodedQuery,
  encodedQueries,
  records = [],
  onClose,
}: FlagDetailPanelProps) {
  const useLive = Boolean(recordSysId || queryPrefix || encodedQuery || encodedQueries?.length);
  const isSummary = Boolean(encodedQueries?.length || encodedQuery || queryPrefix);

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />

      <div
        className="fixed right-0 top-0 h-full w-[420px] z-40 bg-white shadow-2xl flex flex-col"
        style={{ animation: 'slideIn 0.2s ease-out' }}
      >
        <div className={`px-5 py-4 border-b flex items-start justify-between shrink-0 ${panelHeaderClass(flagType)}`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              {flagType === 'incident' && <AlertCircle className="w-5 h-5 text-red-600" />}
              {flagType === 'change' && <Calendar className="w-5 h-5 text-yellow-600" />}
              {flagType === 'health' && <Shield className="w-5 h-5 text-blue-600" />}
              <span className={`typo-body font-semibold ${panelTitleClass(flagType)}`}>
                {panelLabel(flagType)}
              </span>
            </div>
            <p className="typo-caption text-gray-500">
              {isSummary ? (
                <>
                  {subtitle ?? 'Search results'}:{' '}
                  <span className="font-medium text-gray-800">{title}</span>
                </>
              ) : (
                <>
                  {subtitle ? <>{subtitle}: </> : 'CI: '}
                  <span className="font-medium text-gray-800">{title}</span>
                </>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/10 text-gray-500 hover:text-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {flagType === 'health' ? (
          useLive ? (
            <LiveHealthRecords
              recordSysId={recordSysId}
              queryPrefix={queryPrefix}
              encodedQuery={encodedQuery}
              encodedQueries={encodedQueries}
            />
          ) : (
            <div className="flex-1 overflow-y-auto p-5 min-h-0">
              <p className="typo-body text-gray-400 text-center mt-10">No records found.</p>
            </div>
          )
        ) : useLive ? (
          <LiveFlagRecords
            recordSysId={recordSysId}
            queryPrefix={queryPrefix}
            encodedQuery={encodedQuery}
            encodedQueries={encodedQueries}
            flagType={flagType}
          />
        ) : (
          <LegacyRecordList flagType={flagType} records={records} />
        )}
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}

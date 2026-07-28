import { useState, useEffect } from 'react';
import { AlertCircle, Calendar, Loader2, X } from 'lucide-react';
import { TaskCard } from './taskListCards';
import {
  INCIDENT_TASK_CONFIG,
  CHANGE_TASK_CONFIG,
  fetchRelatedTasksForRecord,
  type RelatedTaskRow,
} from '../utils/relatedTasks';
import type { ViewField } from '../utils/viewFields';
import { isAccessDenied } from '../utils/acl';

export type FlagType = 'incident' | 'change';

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
  /** Demo/mock fallback when recordSysId is absent */
  records?: IncidentRecord[] | ChangeRecord[];
  onClose: () => void;
}

const priorityColor: Record<string, string> = {
  'P1 - Critical': 'bg-red-100 text-red-700',
  'P2 - High':     'bg-orange-100 text-orange-700',
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

function LegacyRecordList({
  flagType,
  records,
}: {
  flagType: FlagType;
  records: IncidentRecord[] | ChangeRecord[];
}) {
  const isIncident = flagType === 'incident';

  if (!records.length) {
    return <p className="text-sm text-gray-400 text-center mt-10">No records found.</p>;
  }

  if (isIncident) {
    return (
      <>
        {(records as IncidentRecord[]).map((rec, i) => (
          <div key={i} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-blue-700">{rec.number}</span>
              <div className="flex gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColor[rec.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                  {rec.priority}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateColor[rec.state] ?? 'bg-gray-100 text-gray-600'}`}>
                  {rec.state}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-800 mb-3">{rec.short}</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <span className="text-gray-400">Opened</span>   <span className="text-gray-700">{rec.opened}</span>
              <span className="text-gray-400">Assignee</span> <span className="text-gray-700">{rec.assignee}</span>
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {(records as ChangeRecord[]).map((rec, i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-blue-700">{rec.number}</span>
            <div className="flex gap-2">
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${changeTypeColor[rec.type] ?? 'bg-gray-100 text-gray-600'}`}>
                {rec.type}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateColor[rec.state] ?? 'bg-gray-100 text-gray-600'}`}>
                {rec.state}
              </span>
            </div>
          </div>
          <p className="text-sm text-gray-800 mb-3">{rec.short}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-gray-400">Scheduled</span>   <span className="text-gray-700">{rec.scheduled}</span>
            <span className="text-gray-400">Implementer</span> <span className="text-gray-700">{rec.implementer}</span>
          </div>
        </div>
      ))}
    </>
  );
}

function LiveTaskList({
  recordSysId,
  flagType,
}: {
  recordSysId: string;
  flagType: FlagType;
}) {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RelatedTaskRow[]>([]);
  const [columns, setColumns] = useState<ViewField[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    const config = flagType === 'incident' ? INCIDENT_TASK_CONFIG : CHANGE_TASK_CONFIG;
    let cancelled = false;
    setLoading(true);
    fetchRelatedTasksForRecord(recordSysId, config)
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
  }, [recordSysId, flagType]);

  const config = flagType === 'incident' ? INCIDENT_TASK_CONFIG : CHANGE_TASK_CONFIG;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400 gap-2 text-sm">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading…
      </div>
    );
  }

  if (!rows.length) {
    return <p className="text-sm text-gray-400 text-center mt-10">No records found.</p>;
  }

  return (
    <>
      {rows.map(row => (
        <TaskCard key={row.sysId} row={row} config={config} columns={columns} />
      ))}
      {totalCount > rows.length && (
        <p className="text-xs text-gray-400 text-center pt-2">
          Showing {rows.length} of {totalCount} records
        </p>
      )}
    </>
  );
}

export default function FlagDetailPanel({
  title,
  subtitle,
  flagType,
  recordSysId,
  records = [],
  onClose,
}: FlagDetailPanelProps) {
  const isIncident = flagType === 'incident';
  const useLive = Boolean(recordSysId);
  const recordCount = useLive ? undefined : records.length;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />

      <div
        className="fixed right-0 top-0 h-full w-[420px] z-40 bg-white shadow-2xl flex flex-col"
        style={{ animation: 'slideIn 0.2s ease-out' }}
      >
        <div className={`px-5 py-4 border-b flex items-start justify-between ${isIncident ? 'bg-red-50 border-red-100' : 'bg-yellow-50 border-yellow-100'}`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              {isIncident
                ? <AlertCircle className="w-5 h-5 text-red-600" />
                : <Calendar    className="w-5 h-5 text-yellow-600" />}
              <span className={`text-sm font-semibold ${isIncident ? 'text-red-700' : 'text-yellow-700'}`}>
                {isIncident ? 'Active Incidents' : 'Scheduled Changes'}
              </span>
            </div>
            <p className="text-xs text-gray-500">
              {subtitle ? <>{subtitle}: </> : 'CI: '}
              <span className="font-medium text-gray-800">{title}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/10 text-gray-500 hover:text-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {useLive ? (
            <LiveTaskList recordSysId={recordSysId!} flagType={flagType} />
          ) : (
            <LegacyRecordList flagType={flagType} records={records} />
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">
            {useLive ? 'Linked tasks from ServiceNow' : `${recordCount ?? 0} record${recordCount !== 1 ? 's' : ''} linked`}
          </p>
        </div>
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

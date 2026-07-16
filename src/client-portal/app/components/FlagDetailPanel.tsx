import { AlertCircle, Calendar, Clock, X } from 'lucide-react';

export type FlagType = 'incident' | 'change';

export interface IncidentRecord {
  number: string;
  priority: string;
  state: string;
  short: string;
  opened: string;
  assignee: string;
}

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
  records: IncidentRecord[] | ChangeRecord[];
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

export default function FlagDetailPanel({ title, subtitle, flagType, records, onClose }: FlagDetailPanelProps) {
  const isIncident = flagType === 'incident';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />

      {/* Slide-in panel */}
      <div
        className="fixed right-0 top-0 h-full w-[420px] z-40 bg-white shadow-2xl flex flex-col"
        style={{ animation: 'slideIn 0.2s ease-out' }}
      >
        {/* Header */}
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

        {/* Records */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {records.length === 0 ? (
            <p className="text-sm text-gray-400 text-center mt-10">No records found.</p>
          ) : isIncident ? (
            (records as IncidentRecord[]).map((rec, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-blue-700 hover:underline cursor-pointer">{rec.number}</span>
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
            ))
          ) : (
            (records as ChangeRecord[]).map((rec, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-blue-700 hover:underline cursor-pointer">{rec.number}</span>
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
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">{records.length} record{records.length !== 1 ? 's' : ''} linked</p>
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

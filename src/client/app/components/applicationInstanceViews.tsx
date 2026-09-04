import {
  AlertCircle, Calendar, CheckCircle2, Clock, ExternalLink, ArrowRight,
} from 'lucide-react';
import { type AppItem } from '../data/appData';
import { str } from '../utils/viewFields';
import type { LiveInstance } from '../utils/applicationHierarchy';
import type { FlagType } from './FlagDetailPanel';
import { TASK_SCOPE_INCLUDE_INFRA_TOOLTIP } from '../utils/relatedTaskScope';

export const SVC_TABLE = 'cmdb_ci_service';

export const envAccent: Record<string, string> = {
  Production: 'border-t-green-500',
  'Non-Prod (UAT)': 'border-t-amber-400',
  Staging: 'border-t-blue-400',
  DR: 'border-t-purple-400',
};

export function opStatusBadge(status: unknown) {
  const s = str(status).toLowerCase();
  if ((s.includes('operational') && !s.includes('non')) || s === 'in use') {
    return { cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  }
  if (s.includes('repair') || s.includes('degraded') || s.includes('maintenance')) {
    return { cls: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3.5 h-3.5" /> };
  }
  return { cls: 'bg-red-100 text-red-700', icon: <AlertCircle className="w-3.5 h-3.5" /> };
}

export function instanceToAppItem(inst: LiveInstance, appName: string): AppItem {
  const statusRaw = str(inst.operational_status).toLowerCase();
  return {
    id: inst.sys_id,
    sysId: inst.sys_id,
    table: inst.sys_class_name || SVC_TABLE,
    name: str(inst.name) || inst.sys_id,
    app: appName,
    family: 'live',
    dept: inst.fieldValues.department ?? '',
    env: str(inst.environment) || 'Production',
    status: statusRaw.includes('operational') && !statusRaw.includes('non') ? 'Operational' : 'Degraded',
    incidents: inst.incidents,
    changes: inst.changes,
    criticality: 'Tier 1',
    servers: 0,
    lastUpdated: '',
  };
}

/** Label/value row — stacks vertically in narrow cards, horizontal when card is wide. */
export function InstanceFieldRow({ label, value }: { readonly label: string; readonly value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="rf-field-row rf-field-row--inline">
      <span className="rf-field-row__label">{label}</span>
      <span className="rf-field-row__value font-medium">{value}</span>
    </div>
  );
}

export function LiveInstanceCard({
  inst,
  svcName,
  onViewDetails,
  onFlagClick,
}: {
  readonly inst: LiveInstance;
  readonly svcName: string;
  readonly onViewDetails: () => void;
  readonly onFlagClick: (ft: FlagType) => void;
}) {
  const badge = opStatusBadge(inst.operational_status);
  const topCls = envAccent[inst.environment] ?? 'border-t-gray-300';

  return (
    <div className={`card-stack bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all group border-t-4 ${topCls} flex flex-col`}>
      <div className="p-5 flex-1">
        <div className="mb-3">
          <h3 className="typo-panel-title leading-snug mb-0.5">{inst.name}</h3>
          <p className="typo-caption break-words">{svcName}</p>
        </div>
        <div className="space-y-1.5 mb-4 border border-gray-100 rounded-lg p-3 bg-gray-50">
          {inst.viewFields.map(f => (
            <InstanceFieldRow key={f.element} label={f.label} value={inst.fieldValues[f.element]} />
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className={`inline-flex items-center gap-1 typo-badge px-2.5 py-1 rounded-full ${badge.cls}`}>
            {badge.icon}{inst.operational_status || 'Unknown'}
          </span>
        </div>
        {(inst.incidents > 0 || inst.changes > 0) && (
          <div className="flex gap-2 flex-wrap">
            {inst.incidents > 0 && (
              <button type="button" title={TASK_SCOPE_INCLUDE_INFRA_TOOLTIP} onClick={() => onFlagClick('incident')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded typo-badge border border-red-200 hover:bg-red-100 transition-colors">
                <AlertCircle className="w-3.5 h-3.5" />{inst.incidents} Incident{inst.incidents > 1 ? 's' : ''}
              </button>
            )}
            {inst.changes > 0 && (
              <button type="button" title={TASK_SCOPE_INCLUDE_INFRA_TOOLTIP} onClick={() => onFlagClick('change')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded typo-badge border border-yellow-200 hover:bg-yellow-100 transition-colors">
                <Calendar className="w-3.5 h-3.5" />Upcoming Change
              </button>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-xl gap-2">
        <a
          href={`/${inst.sys_class_name || SVC_TABLE}.do?sys_id=${inst.sys_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="typo-link transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" /> ServiceNow
        </a>
        <button type="button" onClick={onViewDetails}
          className="flex items-center gap-1 typo-body text-blue-600 hover:text-blue-800 font-medium transition-colors group-hover:underline">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function instanceEnvBarClass(environment: string | undefined): string {
  if (environment === 'Production') return 'bg-green-500';
  if (environment?.includes('UAT')) return 'bg-amber-400';
  return 'bg-blue-400';
}

export function LiveInstanceRow({
  inst,
  onViewDetails,
  onFlagClick,
}: {
  readonly inst: LiveInstance;
  readonly onViewDetails: () => void;
  readonly onFlagClick: (ft: FlagType) => void;
}) {
  const badge = opStatusBadge(inst.operational_status);

  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-sm transition-all px-5 py-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
      <div className={`w-1 h-12 rounded-full shrink-0 self-stretch sm:self-auto ${instanceEnvBarClass(inst.environment)}`} />
      <div className="flex-1 min-w-0">
        <p className="typo-panel-title break-words mb-2">{inst.name}</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {inst.viewFields.map(f => {
            const val = inst.fieldValues[f.element];
            return val ? (
              <div key={f.element} className="min-w-[7rem] max-w-full">
                <span className="typo-field-label block break-words">{f.label}</span>
                <span className="typo-field-value-emphasis block break-words whitespace-pre-line">{val}</span>
              </div>
            ) : null;
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0 flex-wrap sm:justify-end">
        <span className={`inline-flex items-center gap-1 typo-badge px-2.5 py-1 rounded-full ${badge.cls}`}>
          {badge.icon}{inst.operational_status || 'Unknown'}
        </span>
        {inst.incidents > 0 && (
          <button type="button" title={TASK_SCOPE_INCLUDE_INFRA_TOOLTIP} onClick={() => onFlagClick('incident')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 rounded typo-badge border border-red-200 hover:bg-red-100 transition-colors">
            <AlertCircle className="w-3 h-3" />{inst.incidents}
          </button>
        )}
        {inst.changes > 0 && (
          <button type="button" title={TASK_SCOPE_INCLUDE_INFRA_TOOLTIP} onClick={() => onFlagClick('change')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded typo-badge border border-yellow-200 hover:bg-yellow-100 transition-colors">
            <Calendar className="w-3 h-3" />CHG
          </button>
        )}
        <a
          href={`/${inst.sys_class_name || SVC_TABLE}.do?sys_id=${inst.sys_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="typo-link transition-colors"
          title="Open in ServiceNow"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button type="button" onClick={onViewDetails}
          className="flex items-center gap-1 typo-body text-blue-600 hover:text-blue-800 font-medium">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

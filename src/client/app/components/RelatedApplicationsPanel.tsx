import { useState, useEffect } from 'react';
import {
  AlertCircle, Calendar, CheckCircle2, Clock, ChevronDown, ChevronUp, ChevronRight,
  Layers, Building2, Package, LayoutGrid, List, Loader2, ExternalLink, ArrowRight,
} from 'lucide-react';
import { type AppItem } from '../data/appData';
import { str } from '../utils/viewFields';
import {
  loadRelatedApplicationsForCi,
  type LiveInstance, type LiveService, type LiveCoreApp, type LiveAppSvc,
} from '../utils/applicationHierarchy';
import FlagDetailPanel, { type FlagType, type IncidentRecord, type ChangeRecord } from './FlagDetailPanel';

const SVC_TABLE = 'cmdb_ci_service';

const envAccent: Record<string, string> = {
  Production: 'border-t-green-500',
  'Non-Prod (UAT)': 'border-t-amber-400',
  Staging: 'border-t-blue-400',
  DR: 'border-t-purple-400',
};

function opStatusBadge(status: unknown) {
  const s = str(status).toLowerCase();
  if ((s.includes('operational') && !s.includes('non')) || s === 'in use') {
    return { cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  }
  if (s.includes('repair') || s.includes('degraded') || s.includes('maintenance')) {
    return { cls: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3.5 h-3.5" /> };
  }
  return { cls: 'bg-red-100 text-red-700', icon: <AlertCircle className="w-3.5 h-3.5" /> };
}

function instanceToAppItem(inst: LiveInstance, appName: string): AppItem {
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

function FieldRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-1 text-xs">
      <span className="text-gray-400 shrink-0 w-28">{label}</span>
      <span className="text-gray-700 font-medium break-words min-w-0 whitespace-pre-line">{value}</span>
    </div>
  );
}

function LiveInstanceCard({ inst, svcName, onViewDetails, onFlagClick }: {
  inst: LiveInstance;
  svcName: string;
  onViewDetails: () => void;
  onFlagClick: (ft: FlagType) => void;
}) {
  const badge = opStatusBadge(inst.operational_status);
  const topCls = envAccent[inst.environment] ?? 'border-t-gray-300';
  return (
    <div className={`bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all group border-t-4 ${topCls} flex flex-col`}>
      <div className="p-5 flex-1">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug mb-0.5">{inst.name}</h3>
          <p className="text-xs text-gray-400 truncate">{svcName}</p>
        </div>
        <div className="space-y-1.5 mb-4 border border-gray-100 rounded-lg p-3 bg-gray-50">
          {inst.viewFields.map(f => (
            <FieldRow key={f.element} label={f.label} value={inst.fieldValues[f.element]} />
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${badge.cls}`}>
            {badge.icon}{inst.operational_status || 'Unknown'}
          </span>
        </div>
        {(inst.incidents > 0 || inst.changes > 0) && (
          <div className="flex gap-2 flex-wrap">
            {inst.incidents > 0 && (
              <button type="button" onClick={() => onFlagClick('incident')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
                <AlertCircle className="w-3.5 h-3.5" />{inst.incidents} Incident{inst.incidents > 1 ? 's' : ''}
              </button>
            )}
            {inst.changes > 0 && (
              <button type="button" onClick={() => onFlagClick('change')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
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
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" /> ServiceNow
        </a>
        <button type="button" onClick={onViewDetails}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors group-hover:underline">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function LiveInstanceRow({ inst, onViewDetails, onFlagClick }: {
  inst: LiveInstance;
  onViewDetails: () => void;
  onFlagClick: (ft: FlagType) => void;
}) {
  const badge = opStatusBadge(inst.operational_status);
  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-sm transition-all px-5 py-3 flex items-center gap-5">
      <div className={`w-1 h-12 rounded-full shrink-0 ${
        inst.environment === 'Production' ? 'bg-green-500' :
        inst.environment?.includes('UAT') ? 'bg-amber-400' : 'bg-blue-400'
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate mb-1">{inst.name}</p>
        <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(inst.viewFields.length, 4)}, minmax(0, 1fr))` }}>
          {inst.viewFields.map(f => {
            const val = inst.fieldValues[f.element];
            return val ? (
              <div key={f.element} className="flex flex-col min-w-0">
                <span className="text-[10px] text-gray-400 truncate">{f.label}</span>
                <span className="text-xs text-gray-700 truncate">{val}</span>
              </div>
            ) : null;
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${badge.cls}`}>
          {badge.icon}{inst.operational_status || 'Unknown'}
        </span>
        {inst.incidents > 0 && (
          <button type="button" onClick={() => onFlagClick('incident')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
            <AlertCircle className="w-3 h-3" />{inst.incidents}
          </button>
        )}
        {inst.changes > 0 && (
          <button type="button" onClick={() => onFlagClick('change')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
            <Calendar className="w-3 h-3" />CHG
          </button>
        )}
        <button type="button" onClick={onViewDetails}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium ml-1">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function LiveServiceGroup({ svc, viewMode, onSelectApp, onFlagClick }: {
  svc: LiveService;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, records: IncidentRecord[] | ChangeRecord[]) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-left">
        <Package className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="text-sm font-semibold text-gray-800 flex-1">{svc.name}</span>
        <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 shrink-0">
          {svc.instances.length} instance{svc.instances.length !== 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && svc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {svc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={svc.name}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, svc.name))}
                  onFlagClick={ft => onFlagClick(inst.name, ft, ft === 'incident' ? inst.incidentRecords : inst.changeRecords)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {svc.instances.map(inst => (
                <LiveInstanceRow
                  key={inst.sys_id}
                  inst={inst}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, svc.name))}
                  onFlagClick={ft => onFlagClick(inst.name, ft, ft === 'incident' ? inst.incidentRecords : inst.changeRecords)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveCoreAppSection({ app, viewMode, onSelectApp, onFlagClick }: {
  app: LiveCoreApp;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, records: IncidentRecord[] | ChangeRecord[]) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-6">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm">
        <div className="p-1.5 rounded-lg bg-blue-700 shrink-0">
          <Building2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{app.name}</p>
          {app.short_description && <p className="text-xs text-gray-400 truncate">{app.short_description}</p>}
        </div>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
          {app.totalInstances} instance{app.totalInstances !== 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && (
        <div className="mt-3 pl-4 border-l-2 border-blue-200 ml-3">
          {app.services.map(svc => (
            <LiveServiceGroup key={svc.sys_id} svc={svc} viewMode={viewMode} onSelectApp={onSelectApp} onFlagClick={onFlagClick} />
          ))}
        </div>
      )}
    </div>
  );
}

function LiveAppSvcSection({ appSvc, viewMode, onSelectApp, onFlagClick }: {
  appSvc: LiveAppSvc;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, records: IncidentRecord[] | ChangeRecord[]) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-6">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm">
        <div className="p-1.5 rounded-lg bg-indigo-700 shrink-0">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{appSvc.name}</p>
          {appSvc.short_description && <p className="text-xs text-gray-400 truncate">{appSvc.short_description}</p>}
        </div>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
          {appSvc.instances.length} instance{appSvc.instances.length !== 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && appSvc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {appSvc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={appSvc.name}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, appSvc.name))}
                  onFlagClick={ft => onFlagClick(inst.name, ft, ft === 'incident' ? inst.incidentRecords : inst.changeRecords)}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {appSvc.instances.map(inst => (
                <LiveInstanceRow
                  key={inst.sys_id}
                  inst={inst}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, appSvc.name))}
                  onFlagClick={ft => onFlagClick(inst.name, ft, ft === 'incident' ? inst.incidentRecords : inst.changeRecords)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RelatedApplicationsPanel({
  ciSysId,
  hierarchyMode,
  onSelectApp,
}: {
  ciSysId: string;
  hierarchyMode: boolean;
  onSelectApp?: (app: AppItem) => void;
}) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [loading, setLoading] = useState(true);
  const [threeLevel, setThreeLevel] = useState<LiveCoreApp[]>([]);
  const [twoLevel, setTwoLevel] = useState<LiveAppSvc[]>([]);
  const [panel, setPanel] = useState<{
    title: string;
    flagType: FlagType;
    records: IncidentRecord[] | ChangeRecord[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRelatedApplicationsForCi(ciSysId, hierarchyMode)
      .then(result => {
        if (cancelled) return;
        setThreeLevel(result.threeLevel);
        setTwoLevel(result.twoLevel);
      })
      .catch(() => {
        if (!cancelled) {
          setThreeLevel([]);
          setTwoLevel([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ciSysId, hierarchyMode]);

  const hasData = hierarchyMode ? threeLevel.length > 0 : twoLevel.length > 0;
  const handleSelect = onSelectApp ?? (() => {});

  return (
    <div className="p-5">
      <div className="flex items-center justify-end gap-2 mb-4">
        <button type="button" onClick={() => setViewMode('grid')}
          className={`p-2 rounded-lg border transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
          title="Card view">
          <LayoutGrid className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setViewMode('list')}
          className={`p-2 rounded-lg border transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
          title="List view">
          <List className="w-4 h-4" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-400 gap-2 text-sm">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading related applications…
        </div>
      )}

      {!loading && !hasData && (
        <p className="text-sm text-gray-400 italic text-center py-8">No related application instances found.</p>
      )}

      {!loading && hierarchyMode && threeLevel.map(app => (
        <LiveCoreAppSection
          key={app.sys_id}
          app={app}
          viewMode={viewMode}
          onSelectApp={handleSelect}
          onFlagClick={(title, ft, records) => setPanel({ title, flagType: ft, records })}
        />
      ))}

      {!loading && !hierarchyMode && twoLevel.map(appSvc => (
        <LiveAppSvcSection
          key={appSvc.sys_id}
          appSvc={appSvc}
          viewMode={viewMode}
          onSelectApp={handleSelect}
          onFlagClick={(title, ft, records) => setPanel({ title, flagType: ft, records })}
        />
      ))}

      {panel && (
        <FlagDetailPanel
          title={panel.title}
          flagType={panel.flagType}
          records={panel.records}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

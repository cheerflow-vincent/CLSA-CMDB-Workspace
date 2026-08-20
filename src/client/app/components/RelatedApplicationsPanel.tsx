import { useState, useEffect, useRef } from 'react';
import {
  ChevronDown, ChevronUp, ChevronRight,
  Layers, Building2, Package, LayoutGrid, List, Loader2,
} from 'lucide-react';
import { type AppItem } from '../data/appData';
import {
  loadRelatedApplicationsForCi,
  type LiveService, type LiveCoreApp, type LiveAppSvc,
} from '../utils/applicationHierarchy';
import type { TableAccess } from '../../api/servicenow';
import FlagDetailPanel, { type FlagType } from './FlagDetailPanel';
import { useEffectiveGridList, useNarrowContainer } from '../utils/useNarrowLayout';
import {
  LiveInstanceCard,
  LiveInstanceRow,
  instanceToAppItem,
} from './applicationInstanceViews';

function LiveServiceGroup({ svc, viewMode, onSelectApp, onFlagClick }: {
  svc: LiveService;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, recordSysId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-left">
        <Package className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="typo-panel-title text-gray-800 flex-1">{svc.name}</span>
        <span className="typo-badge text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 shrink-0">
          {svc.instances.length} instance{svc.instances.length !== 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && svc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="cards-grid-responsive">
              {svc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={svc.name}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, svc.name))}
                  onFlagClick={ft => onFlagClick(inst.name, ft, inst.sys_id)}
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
                  onFlagClick={ft => onFlagClick(inst.name, ft, inst.sys_id)}
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
  onFlagClick: (title: string, ft: FlagType, recordSysId: string) => void;
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
          <p className="typo-panel-title">{app.name}</p>
          {app.short_description && <p className="typo-caption truncate">{app.short_description}</p>}
        </div>
        <span className="typo-badge text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
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
  onFlagClick: (title: string, ft: FlagType, recordSysId: string) => void;
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
          <p className="typo-panel-title">{appSvc.name}</p>
          {appSvc.short_description && <p className="typo-caption truncate">{appSvc.short_description}</p>}
        </div>
        <span className="typo-badge text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
          {appSvc.instances.length} instance{appSvc.instances.length !== 1 ? 's' : ''}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>
      {open && appSvc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="cards-grid-responsive">
              {appSvc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={appSvc.name}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, appSvc.name))}
                  onFlagClick={ft => onFlagClick(inst.name, ft, inst.sys_id)}
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
                  onFlagClick={ft => onFlagClick(inst.name, ft, inst.sys_id)}
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
  onAccessResolved,
  refreshKey = 0,
}: {
  ciSysId: string;
  hierarchyMode: boolean;
  onSelectApp?: (app: AppItem) => void;
  onAccessResolved?: (access: TableAccess) => void;
  refreshKey?: number;
}) {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const { ref: narrowRef, narrow } = useNarrowContainer();
  const effectiveViewMode = useEffectiveGridList(viewMode, narrow);
  const [loading, setLoading] = useState(true);
  const [threeLevel, setThreeLevel] = useState<LiveCoreApp[]>([]);
  const [twoLevel, setTwoLevel] = useState<LiveAppSvc[]>([]);
  const [panel, setPanel] = useState<{
    title: string;
    flagType: FlagType;
    recordSysId: string;
  } | null>(null);

  const onAccessResolvedRef = useRef(onAccessResolved);
  onAccessResolvedRef.current = onAccessResolved;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadRelatedApplicationsForCi(ciSysId, hierarchyMode)
      .then(result => {
        if (cancelled) return;
        onAccessResolvedRef.current?.(result.access);
        setThreeLevel(result.threeLevel);
        setTwoLevel(result.twoLevel);
      })
      .catch(() => {
        if (!cancelled) {
          onAccessResolvedRef.current?.('error');
          setThreeLevel([]);
          setTwoLevel([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ciSysId, hierarchyMode, refreshKey]);

  const hasData = hierarchyMode ? threeLevel.length > 0 : twoLevel.length > 0;
  const handleSelect = onSelectApp ?? (() => {});

  return (
    <div ref={narrowRef} className="detail-pane p-5">
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
        <div className="flex items-center justify-center py-12 text-gray-400 gap-2 typo-body">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading related applications…
        </div>
      )}

      {!loading && !hasData && (
        <p className="typo-body text-gray-400 italic text-center py-8">No related application instances found.</p>
      )}

      {!loading && hierarchyMode && threeLevel.map(app => (
        <LiveCoreAppSection
          key={app.sys_id}
          app={app}
          viewMode={effectiveViewMode}
          onSelectApp={handleSelect}
          onFlagClick={(title, ft, recordSysId) => setPanel({ title, flagType: ft, recordSysId })}
        />
      ))}

      {!loading && !hierarchyMode && twoLevel.map(appSvc => (
        <LiveAppSvcSection
          key={appSvc.sys_id}
          appSvc={appSvc}
          viewMode={effectiveViewMode}
          onSelectApp={handleSelect}
          onFlagClick={(title, ft, recordSysId) => setPanel({ title, flagType: ft, recordSysId })}
        />
      ))}

      {panel && (
        <FlagDetailPanel
          title={panel.title}
          flagType={panel.flagType}
          recordSysId={panel.recordSysId}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

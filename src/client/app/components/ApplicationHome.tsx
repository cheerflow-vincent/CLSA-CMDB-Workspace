import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Search, AlertCircle, Calendar, CheckCircle2, Clock,
  ChevronDown, ChevronUp, ChevronRight, ChevronLeft, X, LayoutGrid, List,
  Layers, TrendingUp, ArrowRight, Building2, SlidersHorizontal,
  Box, Package, Database, Loader2, ExternalLink,
} from 'lucide-react';
import FlagDetailPanel, { type FlagType, type IncidentRecord, type ChangeRecord } from './FlagDetailPanel';
import AppSearchHeader from './AppSearchHeader';
import { fetchPortalMetadata, type TableAccess } from '../../api/servicenow';
import { isAccessDenied } from '../utils/acl';
import { str } from '../utils/viewFields';
import { CHANGE_TASK_CONFIG, INCIDENT_TASK_CONFIG } from '../utils/relatedTasks';
import {
  mockApplications, appIncidents, appChanges, appFamilies,
  type AppItem, type AppFamily,
} from '../data/appData';
import { useEffectiveGridList, useNarrowContainer } from '../utils/useNarrowLayout';
import {
  type LiveInstance,
  type TwoLevelMapping,
  type ThreeLevelMapping,
  fetchFlagCountsForIds,
  loadInstanceCatalog,
  mergeFilterCriteria,
  hasActiveLiveFilters,
  sidebarFiltersEqual,
  fetchApplicationHomePageUnified,
  fetchAppHomeStats,
  buildAppHomeTaskSummaryBranches,
  sumFlagCounts,
  FAMILY_PAGE_SIZE,
  SEARCH_DEBOUNCE_MS,
  isOthersFamilyId,
  type SidebarFilterCriteria,
} from '../utils/appHomeLoader';
import {
  type ResolvedAppHomeFilter,
  filtersForHierarchy,
  emptySidebarFromFilters,
  defaultsSidebarFromFilters,
} from '../utils/appHomeFilterConfig';
import type { CITaskFlagCounts } from '../utils/relatedCIFlags';
import {
  envAccent,
  LiveInstanceCard,
  LiveInstanceRow,
  instanceToAppItem,
  SVC_TABLE,
} from './applicationInstanceViews';

interface ApplicationHomeProps {
  onSelectApp: (app: AppItem) => void;
}

type LivePanelState =
  | { kind: 'instance'; title: string; flagType: FlagType; recordSysId: string }
  | { kind: 'summary'; title: string; subtitle: string; flagType: 'incident' | 'change'; encodedQueries: string[] };

// ─── Style helpers ────────────────────────────────────────────────────────────
const envBadge: Record<string, string> = {
  'Production':     'bg-green-100 text-green-700',
  'Non-Prod (UAT)': 'bg-amber-100 text-amber-700',
  'Staging':        'bg-blue-100 text-blue-700',
  'DR':             'bg-purple-100 text-purple-700',
};
const statusBadge: Record<string, { cls: string; icon: React.ReactNode }> = {
  'Operational': { cls: 'bg-green-100 text-green-700',   icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  'Degraded':    { cls: 'bg-red-100 text-red-700',       icon: <AlertCircle  className="w-3.5 h-3.5" /> },
  'Testing':     { cls: 'bg-yellow-100 text-yellow-700', icon: <Clock        className="w-3.5 h-3.5" /> },
};
const criticalityBadge: Record<string, string> = {
  'Tier 1': 'bg-red-50 text-red-600 border border-red-200',
  'Tier 2': 'bg-orange-50 text-orange-600 border border-orange-200',
  'Tier 3': 'bg-gray-50 text-gray-500 border border-gray-200',
};

// ─── Live data types ──────────────────────────────────────────────────────────

const AUTO_TABLE = 'cmdb_ci_service_auto';
interface LiveService {
  sys_id: string;
  name: string;
  short_description: string;
  /** Resolved instance IDs (may be filtered). */
  instanceIds: string[];
  instances: LiveInstance[];
  totalIncidents: number;
  totalChanges: number;
  instancesLoading?: boolean;
}
interface LiveCoreApp {
  sys_id: string;
  name: string;
  short_description: string;
  services: LiveService[];
  totalIncidents: number;
  totalChanges: number;
  totalInstances: number;
  /** True while Phase 2 instance details are still loading */
  instancesLoading?: boolean;
}

/**
 * 2-level hierarchy: an "app family" service (cmdb_ci_service, u_service_type=service)
 * connects via u_application_environments CIs to "instance" services (cmdb_ci_service, u_service_type=instance).
 */
interface LiveAppSvc {
  sys_id: string;
  name: string;
  short_description: string;
  /** Resolved instance IDs (may be filtered). */
  instanceIds: string[];
  instances: LiveInstance[];
  totalIncidents: number;
  totalChanges: number;
  instancesLoading?: boolean;
}


// ─── 3-level hierarchy assembly ─────────────────────────────────────────────────

function resolveInstanceIds(
  allIds: string[],
  filteredInstIds: Set<string> | null,
): string[] {
  const unique = [...new Set(allIds)];
  if (!filteredInstIds) return unique;
  return unique.filter(id => filteredInstIds.has(id));
}

function assembleThreeLevelHierarchy(
  mapping: ThreeLevelMapping,
  instCache: Map<string, LiveInstance>,
  flagCounts: Map<string, CITaskFlagCounts>,
  filteredInstIds: Set<string> | null,
  loadingKeys: Set<string>,
): LiveCoreApp[] {
  const { bApps, svcMap, bAppToSvcs, svcToInstIds } = mapping;
  return bApps.map(app => {
    const svcIds = [...new Set(bAppToSvcs.get(app.sys_id) ?? [])];
    const services: LiveService[] = svcIds.map(sId => {
      const svc = svcMap.get(sId);
      const iIds = resolveInstanceIds(svcToInstIds.get(sId) ?? [], filteredInstIds);
      const instances = iIds.map(id => instCache.get(id)).filter((x): x is LiveInstance => !!x);
      const totals = sumFlagCounts(iIds, flagCounts, instCache);
      return {
        sys_id: sId,
        name: svc?.name ?? sId,
        short_description: svc?.short_description ?? '',
        instanceIds: iIds,
        instances,
        instancesLoading: loadingKeys.has(sId),
        totalIncidents: totals.incidents,
        totalChanges: totals.changes,
      };
    }).filter(svc => svc.instanceIds.length > 0);

    const allInstIds = services.flatMap(s => s.instanceIds);
    const appTotals = sumFlagCounts(allInstIds, flagCounts, instCache);

    return {
      sys_id: app.sys_id,
      name: app.name,
      short_description: app.short_description ?? '',
      services,
      totalIncidents: appTotals.incidents,
      totalChanges: appTotals.changes,
      totalInstances: allInstIds.length,
    };
  }).filter(app => app.services.length > 0)
    .sort((a, b) => {
      if (isOthersFamilyId(a.sys_id)) return 1;
      if (isOthersFamilyId(b.sys_id)) return -1;
      return a.name.localeCompare(b.name);
    });
}

// ─── System property reader ───────────────────────────────────────────────────

/** Returns true → 3-level hierarchy; false → 2-level hierarchy */
async function readHierarchyMode(): Promise<boolean> {
  try {
    const meta = await fetchPortalMetadata();
    return meta.hierarchy_mode;
  } catch {
    return true; // default to 3-level if metadata is unreadable
  }
}

// ─── 2-level hierarchy assembly ───────────────────────────────────────────────

function assembleTwoLevelFamilies(
  mapping: TwoLevelMapping,
  instCache: Map<string, LiveInstance>,
  flagCounts: Map<string, CITaskFlagCounts>,
  filteredInstIds: Set<string> | null,
  loadingKeys: Set<string>,
): LiveAppSvc[] {
  const appIds = mapping.appFamilyMeta.size
    ? [...mapping.appFamilyMeta.keys()]
    : [...mapping.appToInstances.keys()];

  return appIds
    .map(appId => {
      const meta = mapping.appFamilyMeta.get(appId) ?? { name: appId, short_description: '' };
      const iIds = resolveInstanceIds([...(mapping.appToInstances.get(appId) ?? [])], filteredInstIds);
      const instances = iIds.map(id => instCache.get(id)).filter((x): x is LiveInstance => !!x);
      const totals = sumFlagCounts(iIds, flagCounts, instCache);
      return {
        sys_id: appId,
        name: meta.name,
        short_description: meta.short_description,
        instanceIds: iIds,
        instances,
        instancesLoading: loadingKeys.has(appId),
        totalIncidents: totals.incidents,
        totalChanges: totals.changes,
      };
    })
    .filter(s => s.instanceIds.length > 0)
    .sort((a, b) => {
      if (isOthersFamilyId(a.sys_id)) return 1;
      if (isOthersFamilyId(b.sys_id)) return -1;
      return a.name.localeCompare(b.name);
    });
}

const safe = str;

// ─── Main component ───────────────────────────────────────────────────────────
function LiveServiceGroup({ svc, viewMode, onSelectApp, onFlagClick, onExpand }: {
  svc: LiveService;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, recordSysId: string) => void;
  onExpand?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const instanceCount = svc.instanceIds.length;
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) onExpand?.();
  };
  return (
    <div className="mb-4">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-left"
      >
        <Package className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="typo-panel-title text-gray-800 flex-1">{svc.name}</span>
        {svc.short_description && (
          <span className="typo-caption hidden sm:block truncate max-w-xs">{svc.short_description}</span>
        )}
        <span className="typo-badge text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 shrink-0">
          {instanceCount} instance{instanceCount !== 1 ? 's' : ''}
        </span>
        {svc.totalIncidents > 0 && (
          <span className="inline-flex items-center gap-1 typo-badge text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full shrink-0">
            <AlertCircle className="w-3 h-3" />{svc.totalIncidents}
          </span>
        )}
        {svc.totalChanges > 0 && (
          <span className="inline-flex items-center gap-1 typo-badge text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
            <Calendar className="w-3 h-3" />{svc.totalChanges}
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {open && svc.instancesLoading && (
        <div className="mt-3 pl-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      )}

      {open && !svc.instancesLoading && svc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {svc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={svc.name}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, svc.name))}
                  onFlagClick={ft => onFlagClick(
                    safe(inst.name) || inst.sys_id, ft, inst.sys_id,
                  )}
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
                  onFlagClick={ft => onFlagClick(
                    inst.name, ft, inst.sys_id,
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {open && !svc.instancesLoading && svc.instances.length === 0 && instanceCount > 0 && (
        <div className="mt-3 pl-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      )}
      {open && !svc.instancesLoading && instanceCount === 0 && (
        <p className="mt-2 pl-6 typo-caption italic">No instances found</p>
      )}
    </div>
  );
}

// ─── 2-level: Application Service Section ────────────────────────────────────
function LiveAppSvcSection({ appSvc, viewMode, onSelectApp, onFlagClick, onExpand }: {
  appSvc: LiveAppSvc;
  viewMode: 'grid' | 'list';
  onSelectApp: (a: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, recordSysId: string) => void;
  onExpand?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const instanceCount = appSvc.instanceIds.length;
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) onExpand?.();
  };
  return (
    <div className="mb-6">
      <button
        onClick={toggleOpen}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
      >
        <div className="p-1.5 rounded-lg bg-indigo-700 shrink-0">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-panel-title">{appSvc.name}</p>
          {appSvc.short_description && (
            <p className="typo-caption truncate">{appSvc.short_description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="typo-badge text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {instanceCount} instance{instanceCount !== 1 ? 's' : ''}
          </span>
          {appSvc.totalIncidents > 0 && (
            <span className="inline-flex items-center gap-1 typo-badge text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />{appSvc.totalIncidents} inc
            </span>
          )}
          {appSvc.totalChanges > 0 && (
            <span className="inline-flex items-center gap-1 typo-badge text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" />{appSvc.totalChanges} chg
            </span>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {open && appSvc.instancesLoading && (
        <div className="mt-3 pl-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      )}

      {open && !appSvc.instancesLoading && appSvc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {appSvc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={appSvc.name}
                  onViewDetails={() => onSelectApp(instanceToAppItem(inst, appSvc.name))}
                  onFlagClick={ft => onFlagClick(
                    safe(inst.name) || inst.sys_id, ft, inst.sys_id,
                  )}
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
                  onFlagClick={ft => onFlagClick(
                    safe(inst.name) || inst.sys_id, ft, inst.sys_id,
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {open && !appSvc.instancesLoading && appSvc.instances.length === 0 && instanceCount > 0 && (
        <div className="mt-3 pl-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Live Core Application Section (1st level) ───────────────────────────────
function LiveCoreAppSection({ app, viewMode, onSelectApp, onFlagClick, onExpandService }: {
  app: LiveCoreApp;
  viewMode: 'grid' | 'list';
  onSelectApp: (a: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, recordSysId: string) => void;
  onExpandService?: (svc: LiveService) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
      >
        <div className="p-1.5 rounded-lg bg-blue-700 shrink-0">
          <Building2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-panel-title">{app.name}</p>
          {app.short_description && (
            <p className="typo-caption truncate">{app.short_description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="typo-badge text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {app.services.length} service{app.services.length !== 1 ? 's' : ''}
          </span>
          <span className="typo-badge text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {app.totalInstances} instance{app.totalInstances !== 1 ? 's' : ''}
          </span>
          {app.totalIncidents > 0 && (
            <span className="inline-flex items-center gap-1 typo-badge text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />{app.totalIncidents} inc
            </span>
          )}
          {app.totalChanges > 0 && (
            <span className="inline-flex items-center gap-1 typo-badge text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" />{app.totalChanges} chg
            </span>
          )}
          {open
            ? <ChevronUp   className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="mt-3 pl-4 border-l-2 border-blue-200 ml-3">
          {app.services.length === 0
            ? <p className="typo-caption italic py-2">No services linked</p>
            : app.services.map(svc => (
                <LiveServiceGroup
                  key={svc.sys_id}
                  svc={svc}
                  viewMode={viewMode}
                  onSelectApp={onSelectApp}
                  onFlagClick={onFlagClick}
                  onExpand={() => onExpandService?.(svc)}
                />
              ))
          }
        </div>
      )}
    </div>
  );
}

// ─── FilterSection accordion ──────────────────────────────────────────────────
function FilterSection({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between py-1 mb-2">
        <span className="typo-panel-title text-gray-800">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

// ─── Application group — demo data (middle tier) ──────────────────────────────
function AppGroup({ appName, instances, viewMode, onSelectApp, onFlagClick }: {
  appName: string;
  instances: AppItem[];
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (app: AppItem, flagType: FlagType) => void;
}) {
  const [open, setOpen] = useState(true);
  const totalIncidents = instances.reduce((s, a) => s + a.incidents, 0);
  const totalChanges   = instances.reduce((s, a) => s + a.changes, 0);

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-left"
      >
        <Package className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="typo-panel-title text-gray-800 flex-1">{appName}</span>
        <span className="typo-badge text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
          {instances.length} instance{instances.length !== 1 ? 's' : ''}
        </span>
        {totalIncidents > 0 && (
          <span className="inline-flex items-center gap-1 typo-badge text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            <AlertCircle className="w-3 h-3" />{totalIncidents} Incident{totalIncidents > 1 ? 's' : ''}
          </span>
        )}
        {totalChanges > 0 && (
          <span className="inline-flex items-center gap-1 typo-badge text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <Calendar className="w-3 h-3" />{totalChanges} Change{totalChanges > 1 ? 's' : ''}
          </span>
        )}
        {open
          ? <ChevronUp   className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {instances.map(app => (
                <AppCard key={app.id} app={app}
                  onViewDetails={() => onSelectApp(app)}
                  onFlagClick={(ft) => onFlagClick(app, ft)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {instances.map(app => (
                <AppRow key={app.id} app={app}
                  onViewDetails={() => onSelectApp(app)}
                  onFlagClick={(ft) => onFlagClick(app, ft)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Application family section — demo data (outermost tier) ─────────────────
function FamilySection({ family, appGroups, viewMode, onSelectApp, onFlagClick }: {
  family: AppFamily;
  appGroups: Map<string, AppItem[]>;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (app: AppItem, flagType: FlagType) => void;
}) {
  const [open, setOpen] = useState(true);
  const allInstances  = [...appGroups.values()].flat();
  const totalInst     = allInstances.length;
  const totalInc      = allInstances.reduce((s, a) => s + a.incidents, 0);
  const totalCh       = allInstances.reduce((s, a) => s + a.changes, 0);
  const appCount      = appGroups.size;

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
      >
        <div className={`p-1.5 rounded-lg ${family.accentColor}`}>
          <Box className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-panel-title">{family.name}</p>
          <p className="typo-caption truncate">{family.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="typo-badge text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {appCount} app{appCount !== 1 ? 's' : ''}
          </span>
          <span className="typo-badge text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {totalInst} instance{totalInst !== 1 ? 's' : ''}
          </span>
          {totalInc > 0 && (
            <span className="inline-flex items-center gap-1 typo-badge text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />{totalInc}
            </span>
          )}
          {totalCh > 0 && (
            <span className="inline-flex items-center gap-1 typo-badge text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" />{totalCh}
            </span>
          )}
          {open
            ? <ChevronUp   className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="mt-3 pl-4 border-l-2 border-gray-200 ml-3">
          {[...appGroups.entries()].map(([appName, instances]) => (
            <AppGroup
              key={appName}
              appName={appName}
              instances={instances}
              viewMode={viewMode}
              onSelectApp={onSelectApp}
              onFlagClick={onFlagClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ApplicationHome({ onSelectApp }: ApplicationHomeProps) {
  const [cardSearch, setCardSearch]         = useState('');
  const [appliedSearch, setAppliedSearch]   = useState('');
  const [viewMode, setViewMode]             = useState<'grid' | 'list'>('grid');
  const { ref: narrowRef, narrow } = useNarrowContainer();
  const effectiveViewMode = useEffectiveGridList(viewMode, narrow);

  // Sidebar filter draft (checkbox UI) vs applied (drives server queries)
  const [filterDefs, setFilterDefs] = useState<ResolvedAppHomeFilter[]>([]);
  const [draftSidebar, setDraftSidebar] = useState<SidebarFilterCriteria>({});
  const [appliedSidebar, setAppliedSidebar] = useState<SidebarFilterCriteria>({});
  const [filtersLoading, setFiltersLoading] = useState(true);
  const filterConfigKeyRef = useRef('');

  const [hierarchyMode, setHierarchyMode] = useState<boolean | null>(null);
  const [threeLevelMapping, setThreeLevelMapping] = useState<ThreeLevelMapping | null>(null);
  const [twoLevelMapping, setTwoLevelMapping] = useState<TwoLevelMapping | null>(null);
  const instCacheRef = useRef<Map<string, LiveInstance>>(new Map());
  const [instCacheVersion, setInstCacheVersion] = useState(0);
  const [flagCounts, setFlagCounts] = useState<Map<string, CITaskFlagCounts>>(new Map());
  const [filteredInstIds, setFilteredInstIds] = useState<Set<string> | null>(null);
  const [loadingKeys, setLoadingKeys] = useState<Set<string>>(new Set());
  const [familyPage, setFamilyPage] = useState(0);
  const [totalFamilies, setTotalFamilies] = useState(0);
  const [liveLoading, setLiveLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);
  const loadRequestRef = useRef(0);
  const filterTokenRef = useRef<string | null>(null);
  const criteriaKeyRef = useRef('');

  // Mock data panel
  const [panel, setPanel] = useState<{ app: AppItem; flagType: FlagType } | null>(null);

  // Live data panel
  const [livePanel, setLivePanel] = useState<LivePanelState | null>(null);

  useEffect(() => {
    if (hierarchyMode === null) return;

    let cancelled = false;
    setFiltersLoading(true);

    fetchPortalMetadata()
      .then(meta => {
        if (cancelled) return;
        const defs = filtersForHierarchy(meta.app_home_filter_config, hierarchyMode);
        setFilterDefs(defs);
        const configKey = JSON.stringify(defs.map(d => d.field)) + String(hierarchyMode);
        if (configKey !== filterConfigKeyRef.current) {
          filterConfigKeyRef.current = configKey;
          const initial = defaultsSidebarFromFilters(defs);
          setDraftSidebar(initial);
          setAppliedSidebar(initial);
          filterTokenRef.current = null;
          criteriaKeyRef.current = '';
          setFamilyPage(0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFilterDefs([]);
          setDraftSidebar({});
          setAppliedSidebar({});
        }
      })
      .finally(() => {
        if (!cancelled) setFiltersLoading(false);
      });

    return () => { cancelled = true; };
  }, [hierarchyMode]);

  const rawFilterCriteria = useMemo(
    () => mergeFilterCriteria(appliedSearch, appliedSidebar),
    [appliedSearch, appliedSidebar],
  );
  const appliedFilterCriteria = useMemo(
    () => rawFilterCriteria,
    [rawFilterCriteria],
  );
  const filtersActive = hasActiveLiveFilters(appliedFilterCriteria);
  const hasPendingFilterChanges = !sidebarFiltersEqual(draftSidebar, appliedSidebar);

  // Debounced toolbar search → applied server query
  useEffect(() => {
    const timer = setTimeout(() => {
      filterTokenRef.current = null;
      criteriaKeyRef.current = '';
      setAppliedSearch(cardSearch);
      setFamilyPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cardSearch]);

  // ── Live stats — runs after hierarchyMode is known ─────────────────────────
  const [statsLoading, setStatsLoading] = useState(true);
  const [liveStats, setLiveStats] = useState({ total: 0, operational: 0, incidents: 0, changes: 0 });
  const [statsAccess, setStatsAccess] = useState<Record<'total' | 'operational' | 'incidents' | 'changes', TableAccess>>({
    total: 'ok', operational: 'ok', incidents: 'ok', changes: 'ok',
  });

  useEffect(() => {
    if (hierarchyMode === null) return;
    if (filtersActive && liveLoading) {
      setStatsLoading(true);
      return;
    }

    let cancelled = false;
    setStatsLoading(true);

    fetchAppHomeStats(hierarchyMode, filtersActive, filteredInstIds)
      .then(stats => {
        if (cancelled) return;
        setLiveStats({
          total: stats.total,
          operational: stats.operational,
          incidents: stats.incidents,
          changes: stats.changes,
        });
        setStatsAccess(stats.access);
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });

    return () => { cancelled = true; };
  }, [hierarchyMode, appliedFilterCriteria, filteredInstIds, filtersActive, liveLoading]);

  const handleStatSummaryClick = useCallback((flagType: 'incident' | 'change') => {
    if (hierarchyMode === null) return;
    const config = flagType === 'incident' ? INCIDENT_TASK_CONFIG : CHANGE_TASK_CONFIG;
    const instanceIds = filtersActive ? (filteredInstIds ? [...filteredInstIds] : []) : null;
    const encodedQueries = buildAppHomeTaskSummaryBranches(instanceIds, hierarchyMode, config);
    setLivePanel({
      kind: 'summary',
      title: filtersActive ? 'Filtered Application Instances' : 'All Application Instances',
      subtitle: flagType === 'incident' ? 'Active Incidents' : 'Upcoming Changes',
      flagType,
      encodedQueries,
    });
  }, [hierarchyMode, filtersActive, filteredInstIds]);

  useEffect(() => {
    readHierarchyMode().then(setHierarchyMode).catch(e => {
      setLiveError(String(e?.message ?? e));
      setLiveLoading(false);
    });
  }, []);

  // Unified server-paged load (filter resolve + mapping via Scripted REST)
  useEffect(() => {
    if (hierarchyMode === null) return;

    const requestId = ++loadRequestRef.current;
    setLiveLoading(true);
    setLiveError(null);

    const criteriaKey = JSON.stringify(appliedFilterCriteria) + String(hierarchyMode);
    const criteriaChanged = criteriaKey !== criteriaKeyRef.current;
    const tokenToSend = filtersActive && !criteriaChanged ? filterTokenRef.current : null;

    (async () => {
      try {
        const result = await fetchApplicationHomePageUnified(
          appliedFilterCriteria,
          filterDefs,
          hierarchyMode,
          familyPage,
          FAMILY_PAGE_SIZE,
          tokenToSend,
        );
        if (requestId !== loadRequestRef.current) return;

        filterTokenRef.current = result.filterToken;
        criteriaKeyRef.current = criteriaKey;

        if (result.access === 'denied') {
          setLiveError('Access denied while loading application data.');
          setThreeLevelMapping(null);
          setTwoLevelMapping(null);
          setFilteredInstIds(filtersActive ? new Set() : null);
          setTotalFamilies(0);
          setFlagCounts(new Map());
          return;
        }

        if (result.access === 'error') {
          setLiveError('Could not load application home data from the server.');
          setThreeLevelMapping(null);
          setTwoLevelMapping(null);
          setTotalFamilies(0);
          setFlagCounts(new Map());
          return;
        }

        setFilteredInstIds(result.instanceIds);
        setTotalFamilies(result.totalFamilies);

        if (hierarchyMode) {
          setThreeLevelMapping(result.threeLevelMapping);
          setTwoLevelMapping(null);
          const ids = result.threeLevelMapping?.instanceIds ?? [];
          if (ids.length) {
            fetchFlagCountsForIds(ids).then(counts => {
              if (requestId === loadRequestRef.current) setFlagCounts(counts);
            });
          } else {
            setFlagCounts(new Map());
          }
        } else {
          setTwoLevelMapping(result.twoLevelMapping);
          setThreeLevelMapping(null);
          const ids = result.twoLevelMapping?.instanceSvcIds ?? [];
          if (ids.length) {
            fetchFlagCountsForIds(ids).then(counts => {
              if (requestId === loadRequestRef.current) setFlagCounts(counts);
            });
          } else {
            setFlagCounts(new Map());
          }
        }
      } catch (e) {
        if (requestId === loadRequestRef.current) {
          setLiveError(String((e as Error)?.message ?? e));
        }
      } finally {
        if (requestId === loadRequestRef.current) {
          setLiveLoading(false);
        }
      }
    })();
  }, [
    hierarchyMode,
    familyPage,
    appliedFilterCriteria,
    filtersActive,
    filterDefs,
  ]);

  const ensureInstancesLoaded = useCallback(async (ids: string[], key: string, table: string) => {
    const missing = ids.filter(id => !instCacheRef.current.has(id));
    if (!missing.length) return;

    setLoadingKeys(prev => new Set(prev).add(key));
    try {
      const loaded = await loadInstanceCatalog(missing, table);
      for (const [id, inst] of loaded) instCacheRef.current.set(id, inst);
      setInstCacheVersion(v => v + 1);
    } finally {
      setLoadingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const handleExpandService = useCallback((svc: LiveService) => {
    ensureInstancesLoaded(svc.instanceIds, svc.sys_id, AUTO_TABLE);
  }, [ensureInstancesLoaded]);

  const handleExpandAppSvc = useCallback((appSvc: LiveAppSvc) => {
    ensureInstancesLoaded(appSvc.instanceIds, appSvc.sys_id, SVC_TABLE);
  }, [ensureInstancesLoaded]);

  const instCache = instCacheRef.current;

  const liveData = useMemo(() => {
    if (!threeLevelMapping) return [];
    return assembleThreeLevelHierarchy(
      threeLevelMapping,
      instCache,
      flagCounts,
      filteredInstIds,
      loadingKeys,
    );
  }, [threeLevelMapping, instCacheVersion, flagCounts, filteredInstIds, loadingKeys, instCache]);

  const liveTwoLevel = useMemo(() => {
    if (!twoLevelMapping) return [];
    return assembleTwoLevelFamilies(
      twoLevelMapping,
      instCache,
      flagCounts,
      filteredInstIds,
      loadingKeys,
    );
  }, [twoLevelMapping, instCacheVersion, flagCounts, filteredInstIds, loadingKeys, instCache]);

  const familyPageCount = Math.max(1, Math.ceil(totalFamilies / FAMILY_PAGE_SIZE));
  const familyRangeStart = totalFamilies === 0 ? 0 : familyPage * FAMILY_PAGE_SIZE + 1;
  const familyRangeEnd = Math.min((familyPage + 1) * FAMILY_PAGE_SIZE, totalFamilies);
  const showFamilyPagination = totalFamilies > FAMILY_PAGE_SIZE;

  const toggleDraftFilter = (field: string, val: string) => {
    setDraftSidebar(prev => {
      const arr = prev[field] ?? [];
      const next = arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
      return { ...prev, [field]: next };
    });
  };

  const handleApplyFilters = () => {
    filterTokenRef.current = null;
    criteriaKeyRef.current = '';
    setAppliedSidebar({ ...draftSidebar });
    setFamilyPage(0);
  };

  const handleResetFilters = () => {
    filterTokenRef.current = null;
    criteriaKeyRef.current = '';
    const cleared = emptySidebarFromFilters(filterDefs);
    setDraftSidebar(cleared);
    setAppliedSidebar(cleared);
    setCardSearch('');
    setAppliedSearch('');
    setFamilyPage(0);
  };

  // ── Demo data filtering ────────────────────────────────────────────────────
  const filtered = mockApplications.filter(a => {
    const q = cardSearch.toLowerCase();
    const matchesSearch  = !q || a.name.toLowerCase().includes(q) || a.app.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q);
    const matchesEnv     = !(draftSidebar.environment?.length) || draftSidebar.environment.includes(a.env);
    const matchesStatus  = !(draftSidebar.operational_status?.length) || draftSidebar.operational_status.includes(a.status);
    const matchesBizUnit = !(draftSidebar.business_unit?.length);
    const matchesDept    = !(draftSidebar.department?.length);
    const matchesTier    = !(draftSidebar.u_tier?.length) || (a.tier !== undefined && draftSidebar.u_tier.includes(a.tier));
    return matchesSearch && matchesEnv && matchesStatus && matchesBizUnit && matchesDept && matchesTier;
  });

  const byFamily = new Map<string, Map<string, AppItem[]>>();
  for (const fam of appFamilies) byFamily.set(fam.id, new Map());
  for (const item of filtered) {
    const famMap = byFamily.get(item.family ?? '');
    if (!famMap) continue;
    if (!famMap.has(item.app)) famMap.set(item.app, []);
    famMap.get(item.app)!.push(item);
  }

  const noFilterResults = filtersActive && !liveLoading
    && (filteredInstIds?.size === 0 || totalFamilies === 0);

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <AppSearchHeader mode="home" onSelectApp={onSelectApp} />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Filter sidebar ── */}
        <aside className="w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
          <div className="flex-1 overflow-y-auto p-5 pb-24">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                <span className="typo-panel-title text-gray-800">Filters</span>
              </div>
              {hasPendingFilterChanges && (
                <span className="typo-badge text-amber-600">Unapplied</span>
              )}
            </div>

            {filterDefs.map(def => (
              <FilterSection key={def.field} title={def.label} defaultOpen={def.defaultOpen}>
                {filtersLoading ? <p className="typo-caption animate-pulse">Loading…</p>
                  : def.options.length === 0 ? <p className="typo-caption italic">No options</p>
                  : def.options.map(opt => (
                      <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                        <input
                          type="checkbox"
                          checked={(draftSidebar[def.field] ?? []).includes(opt.value)}
                          onChange={() => toggleDraftFilter(def.field, opt.value)}
                          className="rounded border-gray-300 text-blue-600"
                        />
                        <span className="typo-body group-hover:text-gray-900">{opt.label}</span>
                      </label>
                    ))
                }
              </FilterSection>
            ))}
          </div>

          <div className="sticky bottom-0 border-t border-gray-200 bg-white p-4 flex gap-2 shadow-[0_-4px_12px_rgba(0,0,0,0.04)]">
            <button
              type="button"
              onClick={handleApplyFilters}
              disabled={!hasPendingFilterChanges || liveLoading}
              className="flex-1 px-3 py-2 typo-body font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={handleResetFilters}
              disabled={liveLoading}
              className="flex-1 px-3 py-2 typo-body font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Reset
            </button>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-0 border-b border-gray-200 bg-white">
            {([
              { key: 'total' as const,       label: 'Total Instances',  value: liveStats.total,       icon: <Layers       className="w-5 h-5 text-blue-500"  /> },
              { key: 'operational' as const, label: 'Operational',      value: liveStats.operational,  icon: <CheckCircle2 className="w-5 h-5 text-green-500" /> },
              { key: 'incidents' as const,   label: 'Active Incidents', value: liveStats.incidents,    icon: <AlertCircle  className="w-5 h-5 text-red-500"   /> },
              { key: 'changes' as const,     label: 'Upcoming Changes', value: liveStats.changes,      icon: <Calendar     className="w-5 h-5 text-yellow-500"/> },
            ]).filter(s => !isAccessDenied(statsAccess[s.key])).map((s, i, arr) => {
              const clickable = s.key === 'incidents' || s.key === 'changes';
              const className = `px-5 py-4 flex items-center gap-4 ${i < arr.length - 1 ? 'border-r border-gray-200' : ''}${clickable ? ' hover:bg-gray-50 cursor-pointer transition-colors text-left w-full' : ''}`;

              if (clickable) {
                return (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => handleStatSummaryClick(s.key === 'incidents' ? 'incident' : 'change')}
                    className={className}
                  >
                    <div className="p-2 bg-gray-50 rounded-lg">{s.icon}</div>
                    <div>
                      {statsLoading
                        ? <div className="h-7 w-12 bg-gray-200 rounded animate-pulse mb-1" />
                        : <p className="typo-stat">{s.value.toLocaleString()}</p>
                      }
                      <p className="typo-caption text-gray-500">{s.label}</p>
                    </div>
                  </button>
                );
              }

              return (
              <div key={s.key} className={className}>
                <div className="p-2 bg-gray-50 rounded-lg">{s.icon}</div>
                <div>
                  {statsLoading
                    ? <div className="h-7 w-12 bg-gray-200 rounded animate-pulse mb-1" />
                    : <p className="typo-stat">{s.value.toLocaleString()}</p>
                  }
                  <p className="typo-caption text-gray-500">{s.label}</p>
                </div>
              </div>
              );
            })}
          </div>

          {/* Toolbar */}
          <div className="px-6 py-3 flex items-center justify-between border-b border-gray-200 bg-white/80 gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter cards…"
                value={cardSearch}
                onChange={e => setCardSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 rounded-lg typo-body border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 placeholder-gray-400"
              />
              {cardSearch && (
                <button onClick={() => setCardSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode('list')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div ref={narrowRef} className="detail-pane p-6">

            {/* ── Live Data Section ── */}
            <div className="mb-2">
              {liveLoading && (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-14 bg-white rounded-xl border border-gray-200 animate-pulse" />
                  ))}
                </div>
              )}

              {!liveLoading && liveError && (
                <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-red-50 border border-red-200 text-red-700 typo-body mb-4">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>Could not load live data: {liveError}</span>
                </div>
              )}

              {/* ── 3-level hierarchy (business app → service → instance) ── */}
              {!liveLoading && !liveError && hierarchyMode === true && noFilterResults && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 mb-4">
                  <Search className="w-10 h-10 mb-2 opacity-30" />
                  <p className="typo-body">No instances match your filters.</p>
                </div>
              )}
              {!liveLoading && !liveError && hierarchyMode === true && !noFilterResults && liveData.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 mb-4">
                  <Database className="w-10 h-10 mb-2 opacity-30" />
                  <p className="typo-body">No core applications found in ServiceNow.</p>
                </div>
              )}
              {!liveLoading && !liveError && hierarchyMode === true && liveData.map(app => (
                <LiveCoreAppSection
                  key={app.sys_id}
                  app={app}
                  viewMode={effectiveViewMode}
                  onSelectApp={onSelectApp}
                  onFlagClick={(title, ft, recordSysId) => setLivePanel({ kind: 'instance', title, flagType: ft, recordSysId })}
                  onExpandService={handleExpandService}
                />
              ))}

              {/* ── 2-level hierarchy (application service → instance service) ── */}
              {!liveLoading && !liveError && hierarchyMode === false && noFilterResults && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 mb-4">
                  <Search className="w-10 h-10 mb-2 opacity-30" />
                  <p className="typo-body">No instances match your filters.</p>
                </div>
              )}
              {!liveLoading && !liveError && hierarchyMode === false && !noFilterResults && liveTwoLevel.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 mb-4">
                  <Database className="w-10 h-10 mb-2 opacity-30" />
                  <p className="typo-body">No application services found in ServiceNow.</p>
                </div>
              )}
              {!liveLoading && !liveError && hierarchyMode === false && liveTwoLevel.map(appSvc => (
                <LiveAppSvcSection
                  key={appSvc.sys_id}
                  appSvc={appSvc}
                  viewMode={effectiveViewMode}
                  onSelectApp={onSelectApp}
                  onFlagClick={(title, ft, recordSysId) => setLivePanel({ kind: 'instance', title, flagType: ft, recordSysId })}
                  onExpand={() => handleExpandAppSvc(appSvc)}
                />
              ))}

              {showFamilyPagination && !liveLoading && (
                <div className="flex items-center justify-between mt-4 px-2 py-3 border-t border-gray-200">
                  <p className="typo-caption text-gray-500">
                    {familyRangeStart}–{familyRangeEnd} of {totalFamilies} families
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={familyPage === 0}
                      onClick={() => setFamilyPage(p => Math.max(0, p - 1))}
                      className="inline-flex items-center gap-1 px-3 py-1.5 typo-badge rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" /> Previous
                    </button>
                    <span className="typo-caption text-gray-500">
                      Page {familyPage + 1} of {familyPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={familyPage >= familyPageCount - 1}
                      onClick={() => setFamilyPage(p => Math.min(familyPageCount - 1, p + 1))}
                      className="inline-flex items-center gap-1 px-3 py-1.5 typo-badge rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                    >
                      Next <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Mock data flag panel */}
      {panel && (
        <FlagDetailPanel
          title={panel.app.name}
          subtitle="Application"
          flagType={panel.flagType}
          records={(panel.flagType === 'incident' ? appIncidents[panel.app.id] : appChanges[panel.app.id]) as (IncidentRecord[] | ChangeRecord[]) ?? []}
          onClose={() => setPanel(null)}
        />
      )}

      {/* Live data flag panel */}
      {livePanel && (
        livePanel.kind === 'instance' ? (
          <FlagDetailPanel
            title={livePanel.title}
            subtitle="Application Instance"
            flagType={livePanel.flagType}
            recordSysId={livePanel.recordSysId}
            onClose={() => setLivePanel(null)}
          />
        ) : (
          <FlagDetailPanel
            title={livePanel.title}
            subtitle={livePanel.subtitle}
            flagType={livePanel.flagType}
            encodedQueries={livePanel.encodedQueries}
            onClose={() => setLivePanel(null)}
          />
        )
      )}
    </div>
  );
}

// ─── App Card (grid view) — demo data ────────────────────────────────────────
function AppCard({ app, onViewDetails, onFlagClick }: {
  app: AppItem;
  onViewDetails: () => void;
  onFlagClick: (flagType: FlagType) => void;
}) {
  const st = statusBadge[app.status] ?? statusBadge['Operational'];
  return (
    <div className={`bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all group border-t-4 ${envAccent[app.env] ?? 'border-t-gray-300'} flex flex-col`}>
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="typo-panel-title leading-snug">{app.name}</h3>
          <span className={`typo-badge px-2 py-0.5 rounded-full shrink-0 ${envBadge[app.env] ?? 'bg-gray-100 text-gray-600'}`}>{app.env}</span>
        </div>
        <div className="space-y-1.5 mb-4">
          <div className="flex items-center gap-2 typo-body">
            <Building2  className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">App:</span><span className="text-gray-800 truncate">{app.app}</span>
          </div>
          <div className="flex items-center gap-2 typo-body">
            <Layers     className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">Dept:</span><span className="text-gray-800">{app.dept}</span>
          </div>
          <div className="flex items-center gap-2 typo-body">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">Servers:</span><span className="text-gray-800">{app.servers}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className={`inline-flex items-center gap-1 typo-badge px-2.5 py-1 rounded-full ${st.cls}`}>
            {st.icon}{app.status}
          </span>
          <span className={`typo-badge px-2 py-0.5 rounded ${criticalityBadge[app.criticality]}`}>{app.criticality}</span>
        </div>
        {(app.incidents > 0 || app.changes > 0) && (
          <div className="flex gap-2 flex-wrap">
            {app.incidents > 0 && (
              <button onClick={() => onFlagClick('incident')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded typo-badge border border-red-200 hover:bg-red-100 transition-colors">
                <AlertCircle className="w-3.5 h-3.5" />{app.incidents} Active Incident{app.incidents > 1 ? 's' : ''}
              </button>
            )}
            {app.changes > 0 && (
              <button onClick={() => onFlagClick('change')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded typo-badge border border-yellow-200 hover:bg-yellow-100 transition-colors">
                <Calendar className="w-3.5 h-3.5" />Upcoming Change
              </button>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-xl">
        <span className="typo-caption flex items-center gap-1"><Clock className="w-3 h-3" /> {app.lastUpdated}</span>
        <button onClick={onViewDetails}
          className="flex items-center gap-1 typo-body text-blue-600 hover:text-blue-800 font-medium transition-colors group-hover:underline">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── App Row (list view) — demo data ─────────────────────────────────────────
function AppRow({ app, onViewDetails, onFlagClick }: {
  app: AppItem;
  onViewDetails: () => void;
  onFlagClick: (flagType: FlagType) => void;
}) {
  const st = statusBadge[app.status] ?? statusBadge['Operational'];
  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-sm transition-all px-5 py-4 flex items-center gap-5">
      <div className={`w-1 h-12 rounded-full shrink-0 ${app.env === 'Production' ? 'bg-green-500' : app.env === 'Non-Prod (UAT)' ? 'bg-amber-400' : 'bg-blue-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="typo-panel-title truncate">{app.name}</p>
          <span className={`typo-badge px-2 py-0.5 rounded-full shrink-0 ${envBadge[app.env] ?? 'bg-gray-100 text-gray-600'}`}>{app.env}</span>
        </div>
        <p className="typo-caption text-gray-500">{app.app} · {app.dept} · {app.servers} servers</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`inline-flex items-center gap-1 typo-badge px-2.5 py-1 rounded-full ${st.cls}`}>
          {st.icon}{app.status}
        </span>
        {app.incidents > 0 && (
          <button onClick={() => onFlagClick('incident')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 rounded typo-badge border border-red-200 hover:bg-red-100 transition-colors">
            <AlertCircle className="w-3 h-3" />{app.incidents}
          </button>
        )}
        {app.changes > 0 && (
          <button onClick={() => onFlagClick('change')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded typo-badge border border-yellow-200 hover:bg-yellow-100 transition-colors">
            <Calendar className="w-3 h-3" />CHG
          </button>
        )}
        <span className="typo-caption">{app.lastUpdated}</span>
        <button onClick={onViewDetails} className="flex items-center gap-1 typo-body text-blue-600 hover:text-blue-800 font-medium ml-2">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

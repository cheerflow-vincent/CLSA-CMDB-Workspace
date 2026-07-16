import { useState, useEffect } from 'react';
import {
  Search, AlertCircle, Calendar, CheckCircle2, Clock,
  ChevronDown, ChevronUp, ChevronRight, X, LayoutGrid, List,
  Layers, TrendingUp, ArrowRight, Building2, SlidersHorizontal,
  Box, Package
} from 'lucide-react';
import FlagDetailPanel, { type FlagType, type IncidentRecord, type ChangeRecord } from './FlagDetailPanel';
import AppSearchHeader from './AppSearchHeader';
import { queryTable } from '../../api/servicenow';
import {
  mockApplications, appIncidents, appChanges, appFamilies,
  type AppItem, type AppFamily,
} from '../data/appData';

interface ApplicationHomeProps {
  onSelectApp: (app: AppItem) => void;
}

// ─── Filter option type ───────────────────────────────────────────────────────
interface FilterOption { label: string; value: string }

// ─── Style helpers ────────────────────────────────────────────────────────────
const envAccent: Record<string, string> = {
  'Production':     'border-t-green-500',
  'Non-Prod (UAT)': 'border-t-amber-400',
  'Staging':        'border-t-blue-400',
  'DR':             'border-t-purple-400',
};
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

// ─── FilterSection accordion ──────────────────────────────────────────────────
function FilterSection({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between py-1 mb-2">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

// ─── Application group (middle tier: one app, multiple instances) ─────────────
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
      {/* App group header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-left"
      >
        <Package className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="text-sm font-semibold text-gray-800 flex-1">{appName}</span>

        <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
          {instances.length} instance{instances.length !== 1 ? 's' : ''}
        </span>

        {totalIncidents > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            <AlertCircle className="w-3 h-3" />{totalIncidents} Incident{totalIncidents > 1 ? 's' : ''}
          </span>
        )}
        {totalChanges > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <Calendar className="w-3 h-3" />{totalChanges} Change{totalChanges > 1 ? 's' : ''}
          </span>
        )}

        {open
          ? <ChevronUp   className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {/* Instance cards / rows */}
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

// ─── Application family section (outermost tier) ──────────────────────────────
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
      {/* Family header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
      >
        <div className={`p-1.5 rounded-lg ${family.accentColor}`}>
          <Box className="w-4 h-4 text-white" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{family.name}</p>
          <p className="text-xs text-gray-400 truncate">{family.description}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {appCount} app{appCount !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {totalInst} instance{totalInst !== 1 ? 's' : ''}
          </span>
          {totalInc > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />{totalInc}
            </span>
          )}
          {totalCh > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" />{totalCh}
            </span>
          )}
          {open
            ? <ChevronUp   className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* App groups inside this family */}
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
  const [cardSearch, setCardSearch]   = useState('');
  const [viewMode, setViewMode]       = useState<'grid' | 'list'>('grid');
  const [checkedEnv, setCheckedEnv]   = useState<string[]>([]);
  const [checkedStatus, setCheckedStatus] = useState<string[]>([]);
  const [checkedBizUnit, setCheckedBizUnit] = useState<string[]>([]);
  const [checkedDept, setCheckedDept]    = useState<string[]>([]);
  const [checkedTier, setCheckedTier]    = useState<string[]>([]); 
  const [panel, setPanel] = useState<{ app: AppItem; flagType: FlagType } | null>(null);

  // ── Live summary stats ────────────────────────────────────────────────────
  const [statsLoading, setStatsLoading] = useState(true);
  const [liveStats, setLiveStats] = useState({ total: 0, operational: 0, incidents: 0, changes: 0 });

  useEffect(() => {
    const count = (table: string, query?: string) =>
      queryTable({ table, query, fields: ['sys_id'], limit: 1 })
        .then(({ totalCount }) => totalCount)
        .catch(() => 0);

    Promise.all([
      count('cmdb_ci_service_auto'),
      count('cmdb_ci_service_auto', 'operational_status=1'),
      count('incident',        'active=true^cmdb_ci.sys_class_nameINSTANCEOFcmdb_ci_service_auto'),
      count('change_request',  'state=-2^cmdb_ci.sys_class_nameINSTANCEOFcmdb_ci_service_auto'),
    ])
      .then(([total, operational, incidents, changes]) =>
        setLiveStats({ total, operational, incidents, changes })
      )
      .finally(() => setStatsLoading(false));
  }, []);

  // ── Live filter options ───────────────────────────────────────────────────
  const [envOptions,     setEnvOptions]     = useState<FilterOption[]>([]);
  const [statusOptions,  setStatusOptions]  = useState<FilterOption[]>([]);
  const [bizUnitOptions, setBizUnitOptions] = useState<FilterOption[]>([]);
  const [deptOptions,    setDeptOptions]    = useState<FilterOption[]>([]);
  const [tierOptions,    setTierOptions]    = useState<FilterOption[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(true);

  useEffect(() => {
    const fetchChoice = (element: string) =>
      queryTable<{ value: string; label: string }>({
        table:   'sys_choice',
        query:   `nameINcmdb_ci_service_auto,cmdb_ci_service,cmdb_ci^element=${element}^language=en^inactive=false`,
        fields:  ['value', 'label'],
        limit:   50,
        orderBy: 'sequence',
      }).then(({ result }) => {
        // Deduplicate by value: a child table may override a parent's choice,
        // so keep the first occurrence (child-table entries sort earlier when
        // the API returns them ordered by `name` specificity + sequence).
        const seen = new Set<string>();
        return (result ?? [])
          .filter(r => r.label && !seen.has(r.value) && seen.add(r.value))
          .map(r => ({ label: r.label, value: r.label }));
      });

    // Fallback tier options used when u_tier choice field has not been created yet
    const TIER_FALLBACK: FilterOption[] = [
      { label: 'Tier 0', value: '0' },
      { label: 'Tier 1', value: '1' },
      { label: 'Tier 2', value: '2' },
      { label: 'Tier 3', value: '3' },
    ];

    Promise.all([
      fetchChoice('environment'),
      fetchChoice('operational_status'),
      queryTable<{ sys_id: string; name: string }>({
        table:   'business_unit',
        fields:  ['sys_id', 'name'],
        limit:   100,
        orderBy: 'name',
      }).then(({ result }) =>
        (result ?? [])
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(r => ({ label: r.name, value: r.name }))
      ),
      queryTable<{ sys_id: string; name: string }>({
        table:   'cmn_department',
        query:   'u_it_department=true',
        fields:  ['sys_id', 'name'],
        limit:   100,
        orderBy: 'name',
      }).then(({ result }) =>
        (result ?? [])
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(r => ({ label: r.name, value: r.name }))
      ),
      // Tier choices from u_tier field; falls back to 0-3 if field not yet created
      fetchChoice('u_tier').then(opts => opts.length ? opts : TIER_FALLBACK),
    ])
      .then(([envs, statuses, bizUnits, depts, tiers]) => {
        setEnvOptions(envs);
        setStatusOptions(statuses);
        setBizUnitOptions(bizUnits);
        setDeptOptions(depts);
        setTierOptions(tiers);
      })
      .catch(() => { /* leave options empty on error */ })
      .finally(() => setFiltersLoading(false));
  }, []);

  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, val: string) =>
    setArr(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);

  const filtered = mockApplications.filter(a => {
    const q = cardSearch.toLowerCase();
    const matchesSearch   = !q || a.name.toLowerCase().includes(q) || a.app.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q);
    const matchesEnv      = checkedEnv.length     === 0 || checkedEnv.includes(a.env);
    const matchesStatus   = checkedStatus.length  === 0 || checkedStatus.includes(a.status);
    const matchesBizUnit  = checkedBizUnit.length === 0 || checkedBizUnit.includes(a.dept);
    const matchesDept     = checkedDept.length    === 0 || checkedDept.includes(a.dept);
    const matchesTier     = checkedTier.length    === 0 || (a.tier !== undefined && checkedTier.includes(a.tier));
    return matchesSearch && matchesEnv && matchesStatus && matchesBizUnit && matchesDept && matchesTier;
  });

  // Build Family → App → Instances map (preserving appFamilies order)
  const byFamily = new Map<string, Map<string, AppItem[]>>();
  for (const fam of appFamilies) byFamily.set(fam.id, new Map());
  for (const item of filtered) {
    const famMap = byFamily.get(item.family);
    if (!famMap) continue;
    if (!famMap.has(item.app)) famMap.set(item.app, []);
    famMap.get(item.app)!.push(item);
  }

  const anyFilter = checkedEnv.length + checkedStatus.length + checkedBizUnit.length + checkedDept.length + checkedTier.length > 0;

  return (
    <div className="flex flex-col h-full bg-gray-50">

      {/* ── Shared hero: global search + jump section ── */}
      <AppSearchHeader mode="home" onSelectApp={onSelectApp} />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Filter sidebar ── */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
          <div className="p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-800">Filters</span>
              </div>
              {anyFilter && (
                <button
                  onClick={() => { setCheckedEnv([]); setCheckedStatus([]); setCheckedBizUnit([]); setCheckedDept([]); setCheckedTier([]); }}
                  className="text-xs text-red-500 hover:text-red-700 underline"
                >
                  Clear all
                </button>
              )}
            </div>

            <FilterSection title="Environment">
              {filtersLoading
                ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : envOptions.length === 0
                  ? <p className="text-xs text-gray-400 italic">No options</p>
                  : envOptions.map(opt => (
                      <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                        <input type="checkbox" checked={checkedEnv.includes(opt.value)}
                          onChange={() => toggleFilter(checkedEnv, setCheckedEnv, opt.value)}
                          className="rounded border-gray-300 text-blue-600" />
                        <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                      </label>
                    ))
              }
            </FilterSection>

            <FilterSection title="Status">
              {filtersLoading
                ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : statusOptions.length === 0
                  ? <p className="text-xs text-gray-400 italic">No options</p>
                  : statusOptions.map(opt => (
                      <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                        <input type="checkbox" checked={checkedStatus.includes(opt.value)}
                          onChange={() => toggleFilter(checkedStatus, setCheckedStatus, opt.value)}
                          className="rounded border-gray-300 text-blue-600" />
                        <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                      </label>
                    ))
              }
            </FilterSection>

            <FilterSection title="Business Unit">
              {filtersLoading
                ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : bizUnitOptions.length === 0
                  ? <p className="text-xs text-gray-400 italic">No options</p>
                  : bizUnitOptions.map(opt => (
                      <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                        <input type="checkbox" checked={checkedBizUnit.includes(opt.value)}
                          onChange={() => toggleFilter(checkedBizUnit, setCheckedBizUnit, opt.value)}
                          className="rounded border-gray-300 text-blue-600" />
                        <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                      </label>
                    ))
              }
            </FilterSection>

            <FilterSection title="Department">
              {filtersLoading
                ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : deptOptions.length === 0
                  ? <p className="text-xs text-gray-400 italic">No options</p>
                  : deptOptions.map(opt => (
                      <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                        <input type="checkbox" checked={checkedDept.includes(opt.value)}
                          onChange={() => toggleFilter(checkedDept, setCheckedDept, opt.value)}
                          className="rounded border-gray-300 text-blue-600" />
                        <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                      </label>
                    ))
              }
            </FilterSection>

            <FilterSection title="Tier">
              {filtersLoading
                ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : tierOptions.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                      <input type="checkbox" checked={checkedTier.includes(opt.value)}
                        onChange={() => toggleFilter(checkedTier, setCheckedTier, opt.value)}
                        className="rounded border-gray-300 text-blue-600" />
                      <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                    </label>
                  ))
              }
            </FilterSection>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-0 border-b border-gray-200 bg-white">
            {[
              { label: 'Total Instances',  value: liveStats.total,      icon: <Layers       className="w-5 h-5 text-blue-500"  /> },
              { label: 'Operational',      value: liveStats.operational, icon: <CheckCircle2 className="w-5 h-5 text-green-500" /> },
              { label: 'Active Incidents', value: liveStats.incidents,   icon: <AlertCircle  className="w-5 h-5 text-red-500"   /> },
              { label: 'Upcoming Changes', value: liveStats.changes,     icon: <Calendar     className="w-5 h-5 text-yellow-500"/> },
            ].map((s, i) => (
              <div key={i} className={`px-5 py-4 flex items-center gap-4 ${i < 3 ? 'border-r border-gray-200' : ''}`}>
                <div className="p-2 bg-gray-50 rounded-lg">{s.icon}</div>
                <div>
                  {statsLoading
                    ? <div className="h-7 w-12 bg-gray-200 rounded animate-pulse mb-1" />
                    : <p className="text-2xl font-semibold text-gray-900">{s.value.toLocaleString()}</p>
                  }
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              </div>
            ))}
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
                className="w-full pl-9 pr-8 py-1.5 rounded-lg text-sm border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 placeholder-gray-400"
              />
              {cardSearch && (
                <button onClick={() => setCardSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
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

          {/* Family → App → Instance hierarchy */}
          <div className="p-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Search className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No applications match your filters.</p>
              </div>
            ) : (
              appFamilies.map(family => {
                const appGroups = byFamily.get(family.id)!;
                if (appGroups.size === 0) return null;
                return (
                  <FamilySection
                    key={family.id}
                    family={family}
                    appGroups={appGroups}
                    viewMode={viewMode}
                    onSelectApp={onSelectApp}
                    onFlagClick={(app, flagType) => setPanel({ app, flagType })}
                  />
                );
              })
            )}
          </div>
        </main>
      </div>

      {/* Right slide-out flag panel */}
      {panel && (
        <FlagDetailPanel
          title={panel.app.name}
          subtitle="Application"
          flagType={panel.flagType}
          records={(panel.flagType === 'incident' ? appIncidents[panel.app.id] : appChanges[panel.app.id]) as (IncidentRecord[] | ChangeRecord[]) ?? []}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

// ─── App Card (grid view) ─────────────────────────────────────────────────────
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
          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{app.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${envBadge[app.env] ?? 'bg-gray-100 text-gray-600'}`}>{app.env}</span>
        </div>

        <div className="space-y-1.5 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Building2  className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">App:</span><span className="text-gray-800 truncate">{app.app}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Layers     className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">Dept:</span><span className="text-gray-800">{app.dept}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">Servers:</span><span className="text-gray-800">{app.servers}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${st.cls}`}>
            {st.icon}{app.status}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded ${criticalityBadge[app.criticality]}`}>{app.criticality}</span>
        </div>

        {(app.incidents > 0 || app.changes > 0) && (
          <div className="flex gap-2 flex-wrap">
            {app.incidents > 0 && (
              <button onClick={() => onFlagClick('incident')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
                <AlertCircle className="w-3.5 h-3.5" />{app.incidents} Active Incident{app.incidents > 1 ? 's' : ''}
              </button>
            )}
            {app.changes > 0 && (
              <button onClick={() => onFlagClick('change')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
                <Calendar className="w-3.5 h-3.5" />Upcoming Change
              </button>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-xl">
        <span className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> {app.lastUpdated}</span>
        <button onClick={onViewDetails}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors group-hover:underline">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── App Row (list view) ──────────────────────────────────────────────────────
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
          <p className="text-sm font-semibold text-gray-900 truncate">{app.name}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${envBadge[app.env] ?? 'bg-gray-100 text-gray-600'}`}>{app.env}</span>
        </div>
        <p className="text-xs text-gray-500">{app.app} · {app.dept} · {app.servers} servers</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${st.cls}`}>
          {st.icon}{app.status}
        </span>
        {app.incidents > 0 && (
          <button onClick={() => onFlagClick('incident')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
            <AlertCircle className="w-3 h-3" />{app.incidents}
          </button>
        )}
        {app.changes > 0 && (
          <button onClick={() => onFlagClick('change')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
            <Calendar className="w-3 h-3" />CHG
          </button>
        )}
        <span className="text-xs text-gray-400">{app.lastUpdated}</span>
        <button onClick={onViewDetails} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium ml-2">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

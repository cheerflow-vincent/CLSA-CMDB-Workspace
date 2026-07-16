import { useState } from 'react';
import {
  Search, AlertCircle, Calendar, CheckCircle2, Clock,
  ChevronDown, ChevronUp, X, LayoutGrid, List,
  Layers, TrendingUp, ArrowRight, Building2, SlidersHorizontal
} from 'lucide-react';
import FlagDetailPanel, { type FlagType, type IncidentRecord, type ChangeRecord } from './FlagDetailPanel';
import AppSearchHeader from './AppSearchHeader';
import {
  mockApplications, appIncidents, appChanges, type AppItem
} from '../data/appData';

interface ApplicationHomeProps {
  onSelectApp: (app: AppItem) => void;
}

// ─── Filter option lists ──────────────────────────────────────────────────────
const businessLineOptions = [
  { label: 'Finance (12)',    value: 'Finance'    },
  { label: 'Operations (8)', value: 'Operations' },
  { label: 'HR (5)',         value: 'HR'         },
  { label: 'Risk (6)',       value: 'Risk'       },
];
const departmentOptions = [
  { label: 'Fintech (7)',     value: 'Fintech'    },
  { label: 'Accounting (5)', value: 'Accounting' },
  { label: 'HR (4)',         value: 'HR'         },
  { label: 'Finance (6)',    value: 'Finance'    },
  { label: 'Risk (5)',       value: 'Risk'       },
];
const envOptions    = ['Production', 'Non-Prod (UAT)', 'Staging', 'DR'];
const statusOptions = ['Operational', 'Degraded', 'Testing'];

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

// ─── Main component ───────────────────────────────────────────────────────────
export default function ApplicationHome({ onSelectApp }: ApplicationHomeProps) {
  const [cardSearch, setCardSearch]   = useState('');
  const [viewMode, setViewMode]       = useState<'grid' | 'list'>('grid');
  const [checkedEnv, setCheckedEnv]   = useState<string[]>([]);
  const [checkedStatus, setCheckedStatus] = useState<string[]>([]);
  const [checkedBizLine, setCheckedBizLine] = useState<string[]>([]);
  const [checkedDept, setCheckedDept] = useState<string[]>([]);
  const [panel, setPanel] = useState<{ app: AppItem; flagType: FlagType } | null>(null);

  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, val: string) =>
    setArr(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);

  const filtered = mockApplications.filter(a => {
    const q = cardSearch.toLowerCase();
    const matchesSearch = !q || a.name.toLowerCase().includes(q) || a.app.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q);
    const matchesEnv    = checkedEnv.length    === 0 || checkedEnv.includes(a.env);
    const matchesStatus = checkedStatus.length === 0 || checkedStatus.includes(a.status);
    const matchesDept   = checkedDept.length   === 0 || checkedDept.includes(a.dept);
    return matchesSearch && matchesEnv && matchesStatus && matchesDept;
  });

  const totalIncidents = filtered.reduce((s, a) => s + a.incidents, 0);
  const totalChanges   = filtered.reduce((s, a) => s + a.changes, 0);
  const totalOp        = filtered.filter(a => a.status === 'Operational').length;
  const anyFilter      = checkedEnv.length + checkedStatus.length + checkedBizLine.length + checkedDept.length > 0;

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
                  onClick={() => { setCheckedEnv([]); setCheckedStatus([]); setCheckedBizLine([]); setCheckedDept([]); }}
                  className="text-xs text-red-500 hover:text-red-700 underline"
                >
                  Clear all
                </button>
              )}
            </div>

            <FilterSection title="Environment">
              {envOptions.map(opt => (
                <label key={opt} className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" checked={checkedEnv.includes(opt)}
                    onChange={() => toggleFilter(checkedEnv, setCheckedEnv, opt)}
                    className="rounded border-gray-300 text-blue-600" />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt}</span>
                </label>
              ))}
            </FilterSection>

            <FilterSection title="Status">
              {statusOptions.map(opt => (
                <label key={opt} className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" checked={checkedStatus.includes(opt)}
                    onChange={() => toggleFilter(checkedStatus, setCheckedStatus, opt)}
                    className="rounded border-gray-300 text-blue-600" />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt}</span>
                </label>
              ))}
            </FilterSection>

            <FilterSection title="Business Line">
              {businessLineOptions.map(opt => (
                <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" checked={checkedBizLine.includes(opt.value)}
                    onChange={() => toggleFilter(checkedBizLine, setCheckedBizLine, opt.value)}
                    className="rounded border-gray-300 text-blue-600" />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                </label>
              ))}
            </FilterSection>

            <FilterSection title="Department">
              {departmentOptions.map(opt => (
                <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                  <input type="checkbox" checked={checkedDept.includes(opt.value)}
                    onChange={() => toggleFilter(checkedDept, setCheckedDept, opt.value)}
                    className="rounded border-gray-300 text-blue-600" />
                  <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                </label>
              ))}
            </FilterSection>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-0 border-b border-gray-200 bg-white">
            {[
              { label: 'Total Instances',  value: filtered.length,  icon: <Layers       className="w-5 h-5 text-blue-500"  /> },
              { label: 'Operational',      value: totalOp,           icon: <CheckCircle2 className="w-5 h-5 text-green-500" /> },
              { label: 'Active Incidents', value: totalIncidents,    icon: <AlertCircle  className="w-5 h-5 text-red-500"   /> },
              { label: 'Upcoming Changes', value: totalChanges,      icon: <Calendar     className="w-5 h-5 text-yellow-500"/> },
            ].map((s, i) => (
              <div key={i} className={`px-5 py-4 flex items-center gap-4 ${i < 3 ? 'border-r border-gray-200' : ''}`}>
                <div className="p-2 bg-gray-50 rounded-lg">{s.icon}</div>
                <div>
                  <p className="text-2xl font-semibold text-gray-900">{s.value}</p>
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="px-6 py-3 flex items-center justify-between border-b border-gray-200 bg-white/80 gap-4">
            {/* Inline card-level search */}
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

          {/* App grid / list */}
          <div className="p-6">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <Search className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No applications match your filters.</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {filtered.map(app => (
                  <AppCard key={app.id} app={app}
                    onViewDetails={() => onSelectApp(app)}
                    onFlagClick={(flagType) => setPanel({ app, flagType })} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.map(app => (
                  <AppRow key={app.id} app={app}
                    onViewDetails={() => onSelectApp(app)}
                    onFlagClick={(flagType) => setPanel({ app, flagType })} />
                ))}
              </div>
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

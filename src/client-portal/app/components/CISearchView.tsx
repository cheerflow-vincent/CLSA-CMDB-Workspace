import { useState, useRef, useEffect } from 'react';
import {
  Server, Database, CircuitBoard, Network, Search,
  ChevronDown, ArrowUpDown, ChevronLeft, ChevronRight,
  AlertCircle, Calendar, Layers, Check, X,
  Download, FileText
} from 'lucide-react';
import type { CIItem } from './CIDetailView';

interface CISearchViewProps {
  onViewDetails: (ci: CIItem) => void;
}

type Tab = 'all' | 'servers' | 'switches' | 'databases' | 'circuits' | 'business-services';
type FlagType = 'incident' | 'change';

// ─── Mock data ────────────────────────────────────────────────────────────────
const mockData = [
  { id: '1',  name: 'vhkdld1019',               type: 'Server',           class: 'Linux Red Hat 7.8',       environment: 'Non-production', location: 'HKD',    owner: 'Bhaskar Baruah', supportGroup: 'DS - TechOps Support Group', lastModified: '2026-2-11 09:30', hasIncident: true,  hasChange: false },
  { id: '5',  name: 'winprod0042',               type: 'Server',           class: 'Windows Server 2019',     environment: 'Production',     location: 'SHG',    owner: 'James Lam',      supportGroup: 'DS - TechOps Support Group', lastModified: '2026-3-01 14:10', hasIncident: false, hasChange: true  },
  { id: '6',  name: 'lnxdr0088',                 type: 'Server',           class: 'Linux Red Hat 8.5',       environment: 'DR',             location: 'SNG',    owner: 'Rita Chan',      supportGroup: 'DS - Infra Support Group',   lastModified: '2026-1-20 11:00', hasIncident: false, hasChange: false },
  { id: '2',  name: 'xmusw04',                   type: 'Switch',           class: 'Network Switch',          environment: 'Production',     location: 'MUM',    owner: 'Bhaskar Baruah', supportGroup: 'DS - TechOps Support Group', lastModified: '2026-2-11 09:30', hasIncident: false, hasChange: true  },
  { id: '7',  name: 'hkgsw12',                   type: 'Switch',           class: 'Cisco Catalyst 9300',     environment: 'Production',     location: 'HKG',    owner: 'Derek Ng',       supportGroup: 'DS - Network Support Group', lastModified: '2026-4-05 08:45', hasIncident: true,  hasChange: false },
  { id: '3',  name: 'cobrahkg@zhkdp2616',        type: 'Database',         class: 'Oracle 18.2.0.0.0',       environment: 'DR',             location: 'HKD',    owner: 'Bhaskar Baruah', supportGroup: 'DS - TechOps Support Group', lastModified: '2026-2-11 09:30', hasIncident: false, hasChange: false },
  { id: '8',  name: 'sqlprd001',                 type: 'Database',         class: 'MS SQL Server 2019',      environment: 'Production',     location: 'HKG',    owner: 'Amy Wong',       supportGroup: 'DS - DB Support Group',      lastModified: '2026-3-18 16:20', hasIncident: false, hasChange: true  },
  { id: '9',  name: 'mysqluat03',                type: 'Database',         class: 'MySQL 8.0',               environment: 'Non-production', location: 'SHG',    owner: 'Tom Leung',      supportGroup: 'DS - DB Support Group',      lastModified: '2026-2-28 10:55', hasIncident: true,  hasChange: false },
  { id: '4',  name: '0/6/LLUXS/6030G6/UN//CLVI', type: 'Circuit',         class: 'Lightpath ISO Mbps',      environment: 'Production',     location: 'HKD',    owner: 'Bhaskar Baruah', supportGroup: 'DS - TechOps Support Group', lastModified: '2026-2-11 09:30', hasIncident: false, hasChange: false },
  { id: '10', name: '1/2/MPLS/4020A1/HK//CLSA',  type: 'Circuit',         class: 'MPLS 100 Mbps',           environment: 'Production',     location: 'HKG',    owner: 'Grace Ho',       supportGroup: 'DS - Network Support Group', lastModified: '2026-1-15 13:30', hasIncident: false, hasChange: true  },
  { id: '11', name: 'Trading Platform',           type: 'Business Service', class: 'Business Service',       environment: 'Production',     location: 'Global', owner: 'Michael Chen',   supportGroup: 'DS - BizOps Support Group',  lastModified: '2026-4-10 09:00', hasIncident: true,  hasChange: false },
  { id: '12', name: 'Risk Management',            type: 'Business Service', class: 'Business Service',       environment: 'Production',     location: 'HKG',    owner: 'Sarah Liu',      supportGroup: 'DS - BizOps Support Group',  lastModified: '2026-3-22 15:40', hasIncident: false, hasChange: true  },
];

// Mock incident / change detail records keyed by CI id
const mockIncidents: Record<string, object[]> = {
  '1':  [{ number: 'INC0012345', priority: 'P2 - High',   state: 'In Progress',  short: 'CPU spike >95% sustained 30 min', opened: '2026-2-10 08:12', assignee: 'John Smith'    },
         { number: 'INC0012201', priority: 'P3 - Medium', state: 'Resolved',     short: 'Disk usage warning on /var',       opened: '2026-1-28 14:55', assignee: 'Alice Tan'     }],
  '7':  [{ number: 'INC0013001', priority: 'P1 - Critical', state: 'New',        short: 'Port flapping on GE0/0/5',         opened: '2026-4-04 22:03', assignee: 'Derek Ng'      }],
  '9':  [{ number: 'INC0011988', priority: 'P3 - Medium', state: 'In Progress',  short: 'Slow query on orders table',        opened: '2026-2-27 11:30', assignee: 'Tom Leung'     }],
  '11': [{ number: 'INC0013210', priority: 'P2 - High',   state: 'In Progress',  short: 'Login service returning 503',       opened: '2026-4-09 07:44', assignee: 'Michael Chen'  }],
};

const mockChanges: Record<string, object[]> = {
  '5':  [{ number: 'CHG0008811', type: 'Standard',  state: 'Scheduled', short: 'OS patching – KB5034441',   scheduled: '2026-3-05 22:00', implementer: 'James Lam'     },
         { number: 'CHG0008650', type: 'Normal',    state: 'Closed',    short: 'Disk expansion +200 GB',     scheduled: '2026-2-20 01:00', implementer: 'James Lam'     }],
  '2':  [{ number: 'CHG0008900', type: 'Emergency', state: 'Scheduled', short: 'Firmware upgrade to 17.9.4', scheduled: '2026-2-15 23:00', implementer: 'Bhaskar Baruah'}],
  '8':  [{ number: 'CHG0009022', type: 'Normal',    state: 'Approved',  short: 'Index rebuild on prod DB',   scheduled: '2026-3-25 00:00', implementer: 'Amy Wong'      }],
  '10': [{ number: 'CHG0009100', type: 'Standard',  state: 'Scheduled', short: 'Bandwidth upgrade to 1 Gbps',scheduled: '2026-1-20 02:00', implementer: 'Grace Ho'      }],
  '12': [{ number: 'CHG0009250', type: 'Normal',    state: 'Approved',  short: 'Risk scoring engine update', scheduled: '2026-3-28 22:30', implementer: 'Sarah Liu'     }],
};

// ─── Constants ────────────────────────────────────────────────────────────────
const tabTypeMap: Record<Tab, string | null> = {
  all: null, servers: 'Server', switches: 'Switch',
  databases: 'Database', circuits: 'Circuit', 'business-services': 'Business Service',
};
const tabLabels: Record<Tab, string> = {
  all: 'All Results', servers: 'Servers', switches: 'Switches',
  databases: 'Databases', circuits: 'Circuits', 'business-services': 'Business Services',
};
const pills: { tab: Tab; label: string; count: number; icon: JSX.Element; accent: string; iconBg: string }[] = [
  { tab: 'servers',           label: 'Servers',           count: 1240, icon: <Server       className="w-5 h-5 text-blue-600"   />, accent: 'border-blue-500   bg-blue-50',   iconBg: 'bg-blue-100'   },
  { tab: 'switches',          label: 'Switches',          count: 385,  icon: <Network      className="w-5 h-5 text-green-600"  />, accent: 'border-green-500  bg-green-50',  iconBg: 'bg-green-100'  },
  { tab: 'databases',         label: 'Databases',         count: 452,  icon: <Database     className="w-5 h-5 text-purple-600" />, accent: 'border-purple-500 bg-purple-50', iconBg: 'bg-purple-100' },
  { tab: 'circuits',          label: 'Circuits',          count: 98,   icon: <CircuitBoard className="w-5 h-5 text-orange-600" />, accent: 'border-orange-500 bg-orange-50', iconBg: 'bg-orange-100' },
  { tab: 'business-services', label: 'Business Services', count: 206,  icon: <Layers       className="w-5 h-5 text-indigo-600" />, accent: 'border-indigo-500 bg-indigo-50', iconBg: 'bg-indigo-100' },
];
const filterOptions: Record<string, string[]> = {
  Environment:        ['Production', 'Non-production', 'DR'],
  Location:           ['HKD', 'HKG', 'MUM', 'SHG', 'SNG', 'Global'],
  'Business Service': ['Trading Platform', 'Risk Management', 'Settlement System', 'Data Analytics'],
  'Support Group':    ['DS - TechOps Support Group', 'DS - Infra Support Group', 'DS - Network Support Group', 'DS - DB Support Group', 'DS - BizOps Support Group'],
};

// ─── Multi-select dropdown ────────────────────────────────────────────────────
function MultiSelectDropdown({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className={`px-3 py-1.5 border rounded-md text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors ${selected.length > 0 ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
        <span>{label}</span>
        {selected.length > 0 && (
          <>
            <span className="bg-blue-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center shrink-0">{selected.length}</span>
            <X className="w-3 h-3 shrink-0 hover:text-red-500" onClick={e => { e.stopPropagation(); onChange([]); }} />
          </>
        )}
        <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg min-w-[200px] py-1">
          {options.map(opt => {
            const checked = selected.includes(opt);
            return (
              <button key={opt} type="button" onClick={() => toggle(opt)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-50 text-sm text-left">
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-blue-600 border-blue-600' : 'border-gray-300'}`}>
                  {checked && <Check className="w-3 h-3 text-white" />}
                </span>
                <span className={checked ? 'text-gray-900' : 'text-gray-700'}>{opt}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Flag Detail Panel ────────────────────────────────────────────────────────
interface PanelInfo { ciId: string; ciName: string; flagType: FlagType; }

function FlagDetailPanel({ info, onClose }: { info: PanelInfo; onClose: () => void; }) {
  const isIncident = info.flagType === 'incident';
  const records = isIncident ? (mockIncidents[info.ciId] ?? []) : (mockChanges[info.ciId] ?? []);

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

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-30 bg-black/20" onClick={onClose} />

      {/* Slide-in panel */}
      <div className="fixed right-0 top-0 h-full w-[420px] z-40 bg-white shadow-2xl flex flex-col animate-[slideIn_0.2s_ease-out]"
        style={{ animation: 'slideIn 0.2s ease-out' }}>

        {/* Panel header */}
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
            <p className="text-xs text-gray-500">CI: <span className="font-medium text-gray-800">{info.ciName}</span></p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/10 text-gray-500 hover:text-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Records */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {records.length === 0 ? (
            <p className="text-sm text-gray-400 text-center mt-10">No records found.</p>
          ) : (
            records.map((rec: any, i) => (
              <div key={i} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-blue-700 hover:underline cursor-pointer">{rec.number}</span>
                  <div className="flex gap-2">
                    {isIncident && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColor[rec.priority] ?? 'bg-gray-100 text-gray-600'}`}>
                        {rec.priority}
                      </span>
                    )}
                    {!isIncident && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${changeTypeColor[rec.type] ?? 'bg-gray-100 text-gray-600'}`}>
                        {rec.type}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateColor[rec.state] ?? 'bg-gray-100 text-gray-600'}`}>
                      {rec.state}
                    </span>
                  </div>
                </div>
                <p className="text-sm text-gray-800 mb-3">{rec.short}</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                  {isIncident ? (
                    <>
                      <span className="text-gray-400">Opened</span>     <span className="text-gray-700">{rec.opened}</span>
                      <span className="text-gray-400">Assignee</span>   <span className="text-gray-700">{rec.assignee}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-400">Scheduled</span>    <span className="text-gray-700">{rec.scheduled}</span>
                      <span className="text-gray-400">Implementer</span>  <span className="text-gray-700">{rec.implementer}</span>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">{records.length} record{records.length !== 1 ? 's' : ''} linked to this CI</p>
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

// ─── Export button ────────────────────────────────────────────────────────────
function ExportButton({ data }: { data: typeof mockData }) {
  const ref = useRef<HTMLDivElement>(null);

  const rows = data.map(d => ({
    'CI Name':        d.name,
    'Type':           d.type,
    'Class':          d.class,
    'Environment':    d.environment,
    'Location':       d.location,
    'Owner':          d.owner,
    'Support Group':  d.supportGroup,
    'Last Modified':  d.lastModified,
    'Has Incident':   d.hasIncident ? 'Yes' : 'No',
    'Has Change':     d.hasChange   ? 'Yes' : 'No',
  }));

  const exportCSV = () => {
    const headers = Object.keys(rows[0]);
    const csv = [headers.join(','), ...rows.map(r => Object.values(r).map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'ci_search_results.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={exportCSV}
        className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors">
        <Download className="w-4 h-4" />
        <FileText className="w-4 h-4 text-gray-500" />
        Export CSV
      </button>
    </div>
  );
}

// ─── Filters state ────────────────────────────────────────────────────────────
interface PendingFilters {
  keyword: string; ciType: string;
  environment: string[]; location: string[];
  businessService: string[]; supportGroup: string[];
}
const emptyPending = (): PendingFilters => ({ keyword: '', ciType: '', environment: [], location: [], businessService: [], supportGroup: [] });

// ─── Main component ───────────────────────────────────────────────────────────
export default function CISearchView({ onViewDetails }: CISearchViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [pending, setPending]     = useState<PendingFilters>(emptyPending());
  const [applied, setApplied]     = useState<PendingFilters>(emptyPending());
  const [colFilters, setColFilters] = useState({ name: '', type: '', environment: '', location: '', owner: '', supportGroup: '', lastModified: '' });
  const [panel, setPanel] = useState<PanelInfo | null>(null);

  const setCol = (key: keyof typeof colFilters, val: string) => setColFilters(f => ({ ...f, [key]: val }));

  const handleSearch = () => setApplied({ ...pending });

  const filteredData = mockData.filter(item => {
    const typeMatch = tabTypeMap[activeTab] === null || item.type === tabTypeMap[activeTab];
    const kw = applied.keyword.toLowerCase();
    const kwMatch = !kw || item.name.toLowerCase().includes(kw) || item.class.toLowerCase().includes(kw) || item.owner.toLowerCase().includes(kw);
    const ciTypeMatch = !applied.ciType || item.type === applied.ciType;
    const envMatch = applied.environment.length === 0 || applied.environment.includes(item.environment);
    const locMatch = applied.location.length === 0 || applied.location.includes(item.location);
    const sgMatch  = applied.supportGroup.length === 0 || applied.supportGroup.includes(item.supportGroup);
    return typeMatch && kwMatch && ciTypeMatch && envMatch && locMatch && sgMatch;
  });

  const displayData = filteredData.filter(item => {
    const cf = colFilters;
    return (
      (!cf.name         || item.name.toLowerCase().includes(cf.name.toLowerCase()) || item.class.toLowerCase().includes(cf.name.toLowerCase())) &&
      (!cf.type         || item.type.toLowerCase().includes(cf.type.toLowerCase())) &&
      (!cf.environment  || item.environment.toLowerCase().includes(cf.environment.toLowerCase())) &&
      (!cf.location     || item.location.toLowerCase().includes(cf.location.toLowerCase())) &&
      (!cf.owner        || item.owner.toLowerCase().includes(cf.owner.toLowerCase())) &&
      (!cf.supportGroup || item.supportGroup.toLowerCase().includes(cf.supportGroup.toLowerCase())) &&
      (!cf.lastModified || item.lastModified.toLowerCase().includes(cf.lastModified.toLowerCase()))
    );
  });

  const activeFilterCount = [pending.environment, pending.location, pending.businessService, pending.supportGroup]
    .reduce((n, arr) => n + arr.length, 0);

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-600 mb-6">
        <span>Home</span><ChevronRight className="w-4 h-4" /><span className="text-gray-900">Welcome to CMDB</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Welcome to CMDB</h1>
        <p className="text-gray-600 mt-1">Search and manage all configuration items from a single portal.</p>
      </div>

      {/* CI Count Pills */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {pills.map(({ tab, label, count, icon, accent, iconBg }) => {
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`rounded-lg border-2 p-5 transition-all text-left ${isActive ? `${accent} shadow-sm` : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded shrink-0 ${iconBg}`}>{icon}</div>
                <div>
                  <p className="text-2xl font-semibold text-gray-900">{count.toLocaleString()}</p>
                  <p className="text-sm text-gray-600">{label}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
        <div className="flex gap-3 mb-4">
          <div className="flex-1 relative">
            <select className="w-full px-4 py-2.5 border border-gray-300 rounded-lg appearance-none bg-white pr-10"
              value={pending.ciType} onChange={e => setPending(p => ({ ...p, ciType: e.target.value }))}>
              <option value="">CI Type</option>
              <option value="Server">Server</option>
              <option value="Switch">Switch</option>
              <option value="Database">Database</option>
              <option value="Circuit">Circuit</option>
              <option value="Business Service">Business Service</option>
            </select>
            <ChevronDown className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
          <div className="flex-[2] relative">
            <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="text" placeholder="Search Keywords"
              className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg"
              value={pending.keyword}
              onChange={e => setPending(p => ({ ...p, keyword: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleSearch()} />
          </div>
          <button onClick={handleSearch} className="px-8 py-2.5 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition-colors">
            Search
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-600 font-medium">
            Filters {activeFilterCount > 0 && <span className="ml-1 text-xs text-blue-600">({activeFilterCount} selected)</span>}
          </span>
          <MultiSelectDropdown label="Environment"      options={filterOptions['Environment']}      selected={pending.environment}     onChange={v => setPending(p => ({ ...p, environment: v }))} />
          <MultiSelectDropdown label="Location"         options={filterOptions['Location']}         selected={pending.location}        onChange={v => setPending(p => ({ ...p, location: v }))} />
          <MultiSelectDropdown label="Business Service" options={filterOptions['Business Service']} selected={pending.businessService}  onChange={v => setPending(p => ({ ...p, businessService: v }))} />
          <MultiSelectDropdown label="Support Group"    options={filterOptions['Support Group']}    selected={pending.supportGroup}    onChange={v => setPending(p => ({ ...p, supportGroup: v }))} />
          {activeFilterCount > 0 && (
            <button onClick={() => setPending(emptyPending())} className="text-xs text-gray-500 hover:text-red-500 underline">Clear all filters</button>
          )}
        </div>

        <p className="text-sm text-gray-500 mt-3 flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs">i</span>
          Select a specific CI Type above to see specialized search fields (e.g. OS Version, Bandwidth, Port).
        </p>
      </div>

      {/* Tabs + Table */}
      <div className="bg-white rounded-lg border border-gray-200">
        {/* Tabs */}
        <div className="border-b border-gray-200 px-6">
          <div className="flex gap-6 overflow-x-auto">
            {(['all', 'servers', 'switches', 'databases', 'circuits', 'business-services'] as Tab[]).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`py-3 whitespace-nowrap border-b-2 transition-colors text-sm ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
                {tabLabels[tab]}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {tab === 'all' ? mockData.length : mockData.filter(d => d.type === tabTypeMap[tab]).length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Alert */}
        <div className="p-4 bg-blue-50 border-l-4 border-blue-500 mx-6 my-4">
          <p className="text-sm text-blue-900">Notice / message / alert / warning are displayed here</p>
        </div>

        {/* Table toolbar */}
        <div className="px-6 pb-3 flex items-center justify-between">
          <p className="text-sm text-gray-500">{displayData.length} result{displayData.length !== 1 ? 's' : ''}</p>
          <ExportButton data={displayData} />
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-y border-gray-200">
              <tr>
                {['CI Name','Type / Class','Environment','Location / Endpoints','Owner','Support Group','Last Modified','Action'].map(col => (
                  <th key={col} className="px-6 py-3 text-left">
                    {col !== 'Action' ? (
                      <button className="flex items-center gap-2 text-xs font-medium text-gray-700 uppercase hover:text-gray-900">
                        {col}<ArrowUpDown className="w-4 h-4" />
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-gray-700 uppercase">{col}</span>
                    )}
                  </th>
                ))}
              </tr>
              {/* Column search inputs */}
              <tr className="border-t border-gray-200">
                {([
                  { key: 'name',         placeholder: 'Filter name…'    },
                  { key: 'type',         placeholder: 'Filter type…'    },
                  { key: 'environment',  placeholder: 'Filter env…'     },
                  { key: 'location',     placeholder: 'Filter location…'},
                  { key: 'owner',        placeholder: 'Filter owner…'   },
                  { key: 'supportGroup', placeholder: 'Filter group…'   },
                  { key: 'lastModified', placeholder: 'Filter date…'    },
                  { key: null,           placeholder: ''                 },
                ] as { key: keyof typeof colFilters | null; placeholder: string }[]).map(({ key, placeholder }, idx) => (
                  <td key={idx} className="px-3 pb-2 pt-1">
                    {key !== null ? (
                      <div className="relative">
                        <input type="text" value={colFilters[key]} placeholder={placeholder}
                          onChange={e => setCol(key, e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300" />
                        {colFilters[key] && (
                          <button onClick={() => setCol(key, '')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ) : null}
                  </td>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {displayData.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-gray-400 text-sm">
                    No records found. Try adjusting your filters and click Search.
                  </td>
                </tr>
              ) : (
                displayData.map(item => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <p className="font-medium text-gray-900">{item.name}</p>
                      <p className="text-sm text-gray-500">{item.class}</p>
                      {(item.hasIncident || item.hasChange) && (
                        <div className="flex gap-2 mt-1">
                          {item.hasIncident && (
                            <button
                              title="View linked incidents"
                              onClick={() => setPanel({ ciId: item.id, ciName: item.name, flagType: 'incident' })}
                              className="inline-flex items-center justify-center w-6 h-6 bg-red-100 rounded hover:bg-red-200 transition-colors">
                              <AlertCircle className="w-4 h-4 text-red-600" />
                            </button>
                          )}
                          {item.hasChange && (
                            <button
                              title="View linked changes"
                              onClick={() => setPanel({ ciId: item.id, ciName: item.name, flagType: 'change' })}
                              className="inline-flex items-center justify-center w-6 h-6 bg-yellow-100 rounded hover:bg-yellow-200 transition-colors">
                              <Calendar className="w-4 h-4 text-yellow-600" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{item.type}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{item.environment}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{item.location}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{item.owner}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{item.supportGroup}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{item.lastModified}</td>
                    <td className="px-6 py-4">
                      <button onClick={() => onViewDetails(item)} className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                        View Detail
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-700">Rows per page:</span>
            <select className="border border-gray-300 rounded px-2 py-1 text-sm">
              <option>5</option><option>10</option><option>25</option><option>50</option>
            </select>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-700">1–{displayData.length} of {displayData.length}</span>
            <div className="flex gap-2">
              <button className="p-1 hover:bg-gray-100 rounded disabled:opacity-50" disabled><ChevronLeft  className="w-5 h-5" /></button>
              <button className="p-1 hover:bg-gray-100 rounded disabled:opacity-50" disabled><ChevronRight className="w-5 h-5" /></button>
            </div>
          </div>
        </div>
      </div>

      {/* Right slide-out panel */}
      {panel && <FlagDetailPanel info={panel} onClose={() => setPanel(null)} />}
    </div>
  );
}

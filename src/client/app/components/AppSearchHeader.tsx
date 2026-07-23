import { useState, useRef, useEffect } from 'react';
import { Search, X, ArrowRight, ChevronRight, Loader2, ExternalLink } from 'lucide-react';
import { queryTable, getSysProperties, APP_SCOPE } from '../../api/servicenow';
import { mockApplications, type AppItem } from '../data/appData';

const HIERARCHY_PROP = `${APP_SCOPE}.enable.new.app.hierarchy`;

interface AppSearchHeaderProps {
  onSelectApp: (app: AppItem) => void;
  mode: 'home' | 'detail';
  currentApp?: AppItem;
  onBackToHome?: () => void;
}

interface Option {
  id: string;
  label: string;
}

// ─── Searchable combobox ──────────────────────────────────────────────────────
function Combobox({ label, options, value, onChange, placeholder, disabled, loading }: {
  label: string;
  options: Option[];
  value: string;          // currently selected id
  onChange: (id: string) => void;
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selectedLabel = options.find(o => o.id === value)?.label ?? '';
  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <p className="text-xs text-gray-400 mb-1 px-0.5">{label}</p>
      <div className={`flex items-center border rounded-lg bg-white px-3 py-2 gap-2 transition-colors
        ${disabled ? 'bg-gray-50 cursor-not-allowed opacity-60' : ''}
        ${open && !disabled ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-300'}`}>
        {loading
          ? <Loader2 className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />
          : <Search   className="w-4 h-4 text-gray-400 shrink-0" />
        }
        <input
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400 min-w-0 disabled:cursor-not-allowed"
          placeholder={placeholder ?? `Search ${label}…`}
          value={open ? query : selectedLabel}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (!disabled) { setQuery(''); setOpen(true); } }}
        />
        {value && !open && !disabled && (
          <button
            onClick={() => { onChange(''); setQuery(''); }}
            className="text-gray-400 hover:text-gray-600 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto py-1">
          {loading
            ? <p className="px-4 py-3 text-sm text-gray-400">Loading…</p>
            : filtered.length === 0
              ? <p className="px-4 py-3 text-sm text-gray-400">No matches</p>
              : filtered.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => { onChange(opt.id); setOpen(false); setQuery(''); }}
                    className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors
                      ${value === opt.id ? 'text-blue-700 bg-blue-50' : 'text-gray-800'}`}
                  >
                    {opt.label}
                  </button>
                ))
          }
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AppSearchHeader({ onSelectApp, mode, currentApp, onBackToHome }: AppSearchHeaderProps) {
  // true = 3-level hierarchy; false = 2-level hierarchy
  const [hierarchyMode, setHierarchyMode] = useState<boolean>(true);

  const [depts, setDepts]               = useState<Option[]>([]);
  const [deptsLoading, setDeptsLoading] = useState(false);

  const [selectedDeptId, setSelectedDeptId] = useState('');

  const [services, setServices]               = useState<Option[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);

  const [selectedServiceId, setSelectedServiceId] = useState('');

  // Read hierarchy mode once on mount
  useEffect(() => {
    getSysProperties([HIERARCHY_PROP])
      .then(props => {
        const val = props[HIERARCHY_PROP];
        setHierarchyMode(val === undefined || val.toLowerCase() === 'true');
      })
      .catch(() => setHierarchyMode(true));
  }, []);

  // Fetch IT departments on mount
  useEffect(() => {
    setDeptsLoading(true);
    queryTable<{ sys_id: string; name: string }>({
      table:   'cmn_department',
      query:   'u_it_department=true',
      fields:  ['sys_id', 'name'],
      limit:   500,
      orderBy: 'name',
    })
      .then(({ result }) =>
        setDepts(
          (result ?? [])
            .map(r => ({ id: r.sys_id, label: r.name }))
            .sort((a, b) => a.label.localeCompare(b.label))
        )
      )
      .catch(() => setDepts([]))
      .finally(() => setDeptsLoading(false));
  }, [mode]);

  // Fetch business service instances when a department is selected.
  // In 2-level mode: query cmdb_ci_service where u_service_type=instance.
  // In 3-level mode: query cmdb_ci_service_auto (existing behaviour).
  useEffect(() => {
    if (!selectedDeptId) { setServices([]); setSelectedServiceId(''); return; }
    setServicesLoading(true);
    setSelectedServiceId('');
    const table = hierarchyMode ? 'cmdb_ci_service_auto' : 'cmdb_ci_service';
    const query = hierarchyMode
      ? `department=${selectedDeptId}`
      : `department=${selectedDeptId}^u_service_type=instance`;
    queryTable<{ sys_id: string; name: string }>({
      table,
      query,
      fields:  ['sys_id', 'name'],
      limit:   500,
      orderBy: 'name',
    })
      .then(({ result }) =>
        setServices(
          (result ?? [])
            .map(r => ({ id: r.sys_id, label: r.name }))
            .sort((a, b) => a.label.localeCompare(b.label))
        )
      )
      .catch(() => setServices([]))
      .finally(() => setServicesLoading(false));
  }, [selectedDeptId, hierarchyMode]);

  const handleDeptChange = (id: string) => {
    setSelectedDeptId(id);
    setSelectedServiceId('');
    setServices([]);
  };

  const handleGo = () => {
    if (!selectedServiceId) return;
    const svc  = services.find(s => s.id === selectedServiceId);
    const dept = depts.find(d => d.id === selectedDeptId);
    const table = hierarchyMode ? 'cmdb_ci_service_auto' : 'cmdb_ci_service';
    // Try to match against mock application data; fall back to a minimal record.
    // Always carry the real sysId and table so App.tsx can write the URL.
    const base = mockApplications.find(a =>
      a.name.toLowerCase().includes((svc?.label ?? '').toLowerCase()) ||
      a.app.toLowerCase().includes((svc?.label ?? '').toLowerCase())
    ) ?? {
      id:          selectedServiceId,
      name:        svc?.label ?? '',
      app:         svc?.label ?? '',
      family:      'core',
      dept:        dept?.label ?? '',
      env:         'Production',
      status:      'Operational',
      incidents:   0,
      changes:     0,
      criticality: 'Medium',
      servers:     0,
      lastUpdated: new Date().toISOString().split('T')[0],
    };
    onSelectApp({ ...base, sysId: selectedServiceId, table });
  };

  return (
    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">

      {/* Page title (home mode) */}
      {mode === 'home' && (
        <div className="mb-4">
          <h1 className="text-xl font-semibold text-gray-900">Application Mapping</h1>
          <p className="text-sm text-gray-500 mt-0.5">Search applications or navigate directly to a business service dependency map.</p>
        </div>
      )}

      {/* Breadcrumb (detail mode) */}
      {mode === 'detail' && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <nav className="flex items-center gap-1.5 text-sm min-w-0">
            <button
              onClick={onBackToHome}
              className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
            >
              Application Mapping
            </button>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-gray-400">All Applications</span>
            <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-gray-800 font-medium truncate max-w-xs">
              {currentApp?.name ?? 'Application Detail'}
            </span>
          </nav>
          {currentApp?.sysId && (
            <a
              href={`/${currentApp.table || 'cmdb_ci_service'}.do?sys_id=${currentApp.sysId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg text-sm hover:bg-indigo-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Open in ServiceNow
            </a>
          )}
        </div>
      )}

      {/* Jump to Application Details — shown in both home and detail modes */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
        <p className="text-gray-500 text-xs font-medium mb-3 uppercase tracking-wide">Jump to Application Details</p>
        <div className="flex gap-3 items-end">
          <Combobox
            label="IT Department"
            options={depts}
            value={selectedDeptId}
            onChange={handleDeptChange}
            placeholder="e.g. Execution Services TechOps"
            loading={deptsLoading}
          />
          <Combobox
            label="Business Service Instance"
            options={services}
            value={selectedServiceId}
            onChange={setSelectedServiceId}
            placeholder={selectedDeptId ? 'Select a service…' : 'Select department first…'}
            disabled={!selectedDeptId}
            loading={servicesLoading}
          />
          <button
            onClick={handleGo}
            disabled={!selectedServiceId}
            className="shrink-0 flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            Go <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

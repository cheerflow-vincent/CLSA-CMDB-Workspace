import { useState, useRef, useEffect } from 'react';
import { Search, X, ChevronRight, ChevronDown, Loader2, ExternalLink, Edit2, RefreshCw, Network } from 'lucide-react';
import { queryTable } from '../../api/servicenow';
import type { FilterOptionDto } from '../../api/servicenow';
import { mockApplications, type AppItem } from '../data/appData';

export interface AppSearchHeaderDepartmentProps {
  readonly hierarchyMode: boolean;
  readonly departmentOptions: FilterOptionDto[];
  readonly departmentsLoading?: boolean;
  readonly draftDepartment: string[];
  readonly onToggleDepartment: (value: string) => void;
  readonly onApplyDepartment: () => void;
  readonly hasPendingDeptChanges: boolean;
}

interface AppSearchHeaderProps {
  readonly onSelectApp: (app: AppItem) => void;
  readonly mode: 'home' | 'detail';
  readonly currentApp?: AppItem;
  readonly onBackToHome?: () => void;
  /** When set, shows Edit dropdown next to Open in ServiceNow (detail mode). */
  readonly canEditRecord?: boolean;
  readonly onEditCi?: () => void;
  readonly onEditRelationships?: () => void;
  /** Manual reload of the current detail page. */
  readonly onRefresh?: () => void;
  readonly refreshing?: boolean;
  readonly departmentFilter?: AppSearchHeaderDepartmentProps;
}

interface Option {
  id: string;
  label: string;
}

// ─── Searchable combobox ──────────────────────────────────────────────────────
function Combobox({ label, options, value, onChange, placeholder, disabled, loading }: {
  readonly label: string;
  readonly options: Option[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly loading?: boolean;
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
      <p className="typo-field-label mb-1 px-0.5">{label}</p>
      <div className={`flex items-center border rounded-lg bg-white px-3 py-2 gap-2 transition-colors
        ${disabled ? 'bg-gray-50 cursor-not-allowed opacity-60' : ''}
        ${open && !disabled ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-300'}`}>
        {loading
          ? <Loader2 className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />
          : <Search   className="w-4 h-4 text-gray-400 shrink-0" />
        }
        <input
          className="flex-1 typo-body bg-transparent outline-none placeholder-gray-400 min-w-0 disabled:cursor-not-allowed"
          placeholder={placeholder ?? `Search ${label}…`}
          value={open ? query : selectedLabel}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (!disabled) { setQuery(''); setOpen(true); } }}
        />
        {value && !open && !disabled && (
          <button
            type="button"
            onClick={() => { onChange(''); setQuery(''); }}
            className="text-gray-400 hover:text-gray-600 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto py-1">
          {(() => {
            if (loading) return <p className="px-4 py-3 typo-body text-gray-400">Loading…</p>;
            if (filtered.length === 0) return <p className="px-4 py-3 typo-body text-gray-400">No matches</p>;
            return filtered.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => { onChange(opt.id); setOpen(false); setQuery(''); }}
                className={`w-full text-left px-4 py-2.5 typo-body hover:bg-blue-50 transition-colors
                  ${value === opt.id ? 'text-blue-700 bg-blue-50' : 'text-gray-800'}`}
              >
                {opt.label}
              </button>
            ));
          })()}
        </div>
      )}
    </div>
  );
}

function formatMultiSelectSummary(
  selected: string[],
  options: FilterOptionDto[],
  placeholder: string,
): string {
  if (selected.length === 0) return placeholder;
  const labels = selected
    .map(id => options.find(o => o.value === id)?.label)
    .filter((l): l is string => Boolean(l));
  if (labels.length === 0) return placeholder;
  return labels.join(', ');
}

function MultiSelectCombobox({ label, options, selected, onToggle, loading, placeholder }: {
  readonly label: string;
  readonly options: FilterOptionDto[];
  readonly selected: string[];
  readonly onToggle: (value: string) => void;
  readonly loading?: boolean;
  readonly placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const placeholderText = placeholder ?? `Select ${label}…`;

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = query
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;
  const summary = formatMultiSelectSummary(selected, options, placeholderText);
  const hasSelection = selected.length > 0;

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <p className="typo-field-label mb-1 px-0.5">{label}</p>
      <button
        type="button"
        disabled={loading}
        onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center border rounded-lg bg-white px-3 py-2 gap-2 transition-colors text-left
          ${loading ? 'bg-gray-50 cursor-wait opacity-60' : 'cursor-pointer'}
          ${open ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-300 hover:border-gray-400'}`}
      >
        {loading
          ? <Loader2 className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />
          : null
        }
        <span className={`flex-1 typo-body truncate min-w-0 ${hasSelection ? 'text-gray-800' : 'text-gray-400'}`}>
          {loading ? 'Loading…' : summary}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !loading && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input
              className="flex-1 typo-body bg-transparent outline-none placeholder-gray-400 min-w-0"
              placeholder={`Search ${label}…`}
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="text-gray-400 hover:text-gray-600 shrink-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {options.length === 0 && (
              <p className="px-4 py-3 typo-body text-gray-400">No departments</p>
            )}
            {options.length > 0 && filtered.length === 0 && (
              <p className="px-4 py-3 typo-body text-gray-400">No matches</p>
            )}
            {filtered.map(opt => {
              const checked = selected.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors
                    hover:bg-blue-50 ${checked ? 'bg-blue-50/60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(opt.value)}
                    className="rounded border-gray-300 text-blue-600 shrink-0"
                  />
                  <span className={`typo-body truncate ${checked ? 'text-blue-700' : 'text-gray-800'}`}>
                    {opt.label}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function buildAppItemFromSelection(
  serviceId: string,
  serviceLabel: string,
  deptLabels: string[],
  hierarchyMode: boolean,
): AppItem {
  const table = hierarchyMode ? 'cmdb_ci_service_auto' : 'cmdb_ci_service';
  const base = mockApplications.find(a =>
    a.name.toLowerCase().includes(serviceLabel.toLowerCase()) ||
    a.app.toLowerCase().includes(serviceLabel.toLowerCase())
  ) ?? {
    id:          serviceId,
    name:        serviceLabel,
    app:         serviceLabel,
    family:      'core',
    dept:        deptLabels.join(', '),
    env:         'Production',
    status:      'Operational',
    incidents:   0,
    changes:     0,
    criticality: 'Medium',
    servers:     0,
    lastUpdated: new Date().toISOString().split('T')[0],
  };
  return { ...base, sysId: serviceId, table };
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AppSearchHeader({
  onSelectApp,
  mode,
  currentApp,
  onBackToHome,
  canEditRecord,
  onEditCi,
  onEditRelationships,
  onRefresh,
  refreshing,
  departmentFilter,
}: AppSearchHeaderProps) {
  const [editMenuOpen, setEditMenuOpen] = useState(false);
  const editMenuRef = useRef<HTMLDivElement>(null);

  const hierarchyMode = departmentFilter?.hierarchyMode ?? true;
  const draftDepartment = departmentFilter?.draftDepartment ?? [];
  const departmentOptions = departmentFilter?.departmentOptions ?? [];

  const [services, setServices] = useState<Option[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) {
        setEditMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    if (!draftDepartment.length) {
      setServices([]);
      setSelectedServiceId('');
      return;
    }
    setServicesLoading(true);
    setSelectedServiceId('');
    const table = hierarchyMode ? 'cmdb_ci_service_auto' : 'cmdb_ci_service';
    const deptQuery = `departmentIN${draftDepartment.join(',')}`;
    const query = hierarchyMode
      ? deptQuery
      : `${deptQuery}^u_service_type=instance`;
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
  }, [draftDepartment, hierarchyMode]);

  const handleInstanceSelect = (serviceId: string) => {
    if (!serviceId) {
      setSelectedServiceId('');
      return;
    }
    const svc = services.find(s => s.id === serviceId);
    const deptLabels = departmentOptions
      .filter(d => draftDepartment.includes(d.value))
      .map(d => d.label);
    onSelectApp(buildAppItemFromSelection(serviceId, svc?.label ?? '', deptLabels, hierarchyMode));
    setSelectedServiceId('');
  };

  return (
    <div className="bg-gray-50 px-6 py-4 border-b border-gray-200">

      {mode === 'home' && (
        <div className="mb-4">
          <h1 className="typo-page-title">Application Mapping</h1>
          <p className="typo-page-subtitle mt-0.5">Search applications or navigate directly to a business service dependency map.</p>
        </div>
      )}

      {mode === 'detail' && (
        <div className="flex items-center justify-between gap-3 mb-4">
          <nav className="flex items-center gap-1.5 typo-body min-w-0">
            <button
              type="button"
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
            <div className="shrink-0 flex items-center gap-2">
              {onRefresh && (
                <button
                  type="button"
                  onClick={onRefresh}
                  disabled={refreshing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg typo-body hover:bg-gray-50 transition-colors disabled:opacity-60"
                >
                  <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
                </button>
              )}
              <a
                href={`/${currentApp.table || 'cmdb_ci_service'}.do?sys_id=${currentApp.sysId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg typo-body hover:bg-indigo-50 transition-colors"
              >
                <ExternalLink className="w-4 h-4" /> Open in ServiceNow
              </a>
              {canEditRecord && onEditCi && onEditRelationships && (
                <div ref={editMenuRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setEditMenuOpen(open => !open)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg typo-body hover:bg-blue-50 transition-colors"
                  >
                    <Edit2 className="w-4 h-4" /> Edit
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${editMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {editMenuOpen && (
                    <div className="absolute right-0 top-full mt-1 z-50 min-w-[12rem] bg-white border border-gray-200 rounded-lg shadow-lg py-1">
                      <button
                        type="button"
                        onClick={() => {
                          onEditCi();
                          setEditMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left typo-body text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        Edit CI
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onEditRelationships();
                          setEditMenuOpen(false);
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-left typo-body text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <Network className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        Edit Relationships
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {departmentFilter && (
        <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <p className="typo-label">Jump to Application Details</p>
            {departmentFilter.hasPendingDeptChanges && (
              <span className="typo-badge text-amber-600">Unapplied</span>
            )}
          </div>
          <div className="flex gap-3 items-end">
            <MultiSelectCombobox
              label="IT Department"
              options={departmentOptions}
              selected={draftDepartment}
              onToggle={departmentFilter.onToggleDepartment}
              loading={departmentFilter.departmentsLoading}
              placeholder="Select departments…"
            />

            <div className="shrink-0">
              <button
                type="button"
                onClick={departmentFilter.onApplyDepartment}
                disabled={!departmentFilter.hasPendingDeptChanges}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg typo-body font-medium transition-colors"
              >
                Apply
              </button>
            </div>

            <Combobox
              label="Business Service Instance"
              options={services}
              value={selectedServiceId}
              onChange={handleInstanceSelect}
              placeholder={draftDepartment.length ? 'Select a service…' : 'Select department first…'}
              disabled={!draftDepartment.length}
              loading={servicesLoading}
            />
          </div>
        </div>
      )}
    </div>
  );
}

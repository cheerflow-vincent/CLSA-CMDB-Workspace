import { useState, useRef, useEffect } from 'react';
import { Search, X, ArrowRight, ChevronRight, AlertCircle, Clock, CheckCircle2 } from 'lucide-react';
import { mockApplications, departments, businessServicesByDept, type AppItem } from '../data/appData';

interface AppSearchHeaderProps {
  onSelectApp: (app: AppItem) => void;
  mode: 'home' | 'detail';
  currentApp?: AppItem;
  onBackToHome?: () => void;
}

const envBadge: Record<string, string> = {
  'Production':     'bg-green-100 text-green-700',
  'Non-Prod (UAT)': 'bg-amber-100 text-amber-700',
  'Staging':        'bg-blue-100 text-blue-700',
  'DR':             'bg-purple-100 text-purple-700',
};

const statusIcon: Record<string, React.ReactNode> = {
  'Operational': <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  'Degraded':    <AlertCircle  className="w-3.5 h-3.5 text-red-500"   />,
  'Testing':     <Clock        className="w-3.5 h-3.5 text-yellow-500" />,
};

// ─── Highlight matching text ──────────────────────────────────────────────────
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-800 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── Searchable combobox (Jump section) ──────────────────────────────────────
function Combobox({ label, options, value, onChange, placeholder, disabled }: {
  label: string; options: string[]; value: string;
  onChange: (v: string) => void; placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = query ? options.filter(o => o.toLowerCase().includes(query.toLowerCase())) : options;

  return (
    <div ref={ref} className="relative flex-1 min-w-0">
      <p className="text-xs text-gray-400 mb-1 px-0.5">{label}</p>
      <div className={`flex items-center border rounded-lg bg-white px-3 py-2 gap-2 transition-colors
        ${disabled ? 'bg-gray-50 cursor-not-allowed opacity-60' : ''}
        ${open && !disabled ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-300'}`}>
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400 min-w-0 disabled:cursor-not-allowed"
          placeholder={placeholder ?? `Search ${label}…`}
          value={open ? query : value}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (!disabled) { setQuery(''); setOpen(true); } }}
        />
        {value && !open && !disabled && (
          <button onClick={() => { onChange(''); setQuery(''); }} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto py-1">
          {filtered.length === 0
            ? <p className="px-4 py-3 text-sm text-gray-400">No matches</p>
            : filtered.map(opt => (
              <button key={opt} onClick={() => { onChange(opt); setOpen(false); setQuery(''); }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-blue-50 transition-colors ${value === opt ? 'text-blue-700 bg-blue-50' : 'text-gray-800'}`}>
                {opt}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function AppSearchHeader({ onSelectApp, mode, currentApp, onBackToHome }: AppSearchHeaderProps) {
  const [query, setQuery]             = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedDept, setSelectedDept]   = useState('');
  const [selectedService, setSelectedService] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Autocomplete results
  const suggestions = query.trim().length > 0
    ? mockApplications.filter(a =>
        a.name.toLowerCase().includes(query.toLowerCase()) ||
        a.app.toLowerCase().includes(query.toLowerCase())  ||
        a.dept.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 7)
    : [];

  const handleSelect = (app: AppItem) => {
    setQuery('');
    setDropdownOpen(false);
    onSelectApp(app);
  };

  const availableServices = selectedDept
    ? (businessServicesByDept[selectedDept] ?? [])
    : Object.values(businessServicesByDept).flat();

  const handleGo = () => {
    if (!selectedService) return;
    // Find a matching app by name or use the first app
    const match = mockApplications.find(a =>
      a.name.toLowerCase().includes(selectedService.toLowerCase().slice(3)) ||
      a.app.toLowerCase().includes(selectedService.toLowerCase().slice(3))
    ) ?? mockApplications[0];
    onSelectApp(match);
  };

  return (
    <div className="bg-gray-50 px-6 py-5 border-b border-gray-200">

      {/* ── Breadcrumb (detail mode) or title (home mode) ── */}
      {mode === 'home' ? (
        <div className="mb-4">
          <h1 className="text-gray-900 text-xl font-semibold mb-0.5">Application Mapping</h1>
          <p className="text-gray-500 text-sm">Search applications or navigate directly to a business service dependency map.</p>
        </div>
      ) : (
        <nav className="flex items-center gap-1.5 mb-4 text-sm">
          <button
            onClick={onBackToHome}
            className="text-blue-600 hover:text-blue-800 hover:underline font-medium transition-colors"
          >
            Application Mapping
          </button>
          <ChevronRight className="w-4 h-4 text-gray-400" />
          <span className="text-gray-400">All Applications</span>
          <ChevronRight className="w-4 h-4 text-gray-400" />
          <span className="text-gray-800 font-medium truncate max-w-xs">{currentApp?.name ?? 'Application Detail'}</span>
        </nav>
      )}

      {/* ── Global autocomplete search ── */}
      <div ref={searchRef} className="relative mb-4">
        <Search className="w-5 h-5 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
        <input
          type="text"
          placeholder="Search applications by name, department, or app…"
          value={query}
          onChange={e => { setQuery(e.target.value); setDropdownOpen(true); }}
          onFocus={() => { if (query) setDropdownOpen(true); }}
          className="w-full pl-12 pr-10 py-3 rounded-xl text-sm bg-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-300 border border-gray-300 shadow-sm"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setDropdownOpen(false); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* ── Autocomplete dropdown ── */}
        {dropdownOpen && suggestions.length > 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-3 pt-2.5 pb-1">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                {suggestions.length} application{suggestions.length !== 1 ? 's' : ''} found
              </p>
            </div>
            <ul>
              {suggestions.map((app, i) => (
                <li key={app.id}>
                  <button
                    onClick={() => handleSelect(app)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left group"
                  >
                    {/* Status dot */}
                    <div className="shrink-0 mt-0.5">{statusIcon[app.status]}</div>

                    {/* Name + meta */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">
                        <Highlight text={app.name} query={query} />
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        <Highlight text={app.app} query={query} /> · <Highlight text={app.dept} query={query} />
                      </p>
                    </div>

                    {/* Badges */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${envBadge[app.env] ?? 'bg-gray-100 text-gray-600'}`}>
                        {app.env}
                      </span>
                      {app.incidents > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-red-50 text-red-600 rounded border border-red-200">
                          <AlertCircle className="w-3 h-3" />{app.incidents}
                        </span>
                      )}
                    </div>

                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 shrink-0 transition-colors" />
                  </button>
                  {i < suggestions.length - 1 && <div className="mx-4 border-t border-gray-100" />}
                </li>
              ))}
            </ul>
            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400">Press Enter or click to open · Esc to close</p>
            </div>
          </div>
        )}

        {/* No results */}
        {dropdownOpen && query.trim().length > 0 && suggestions.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-xl px-4 py-6 text-center">
            <Search className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">No applications match <span className="font-medium">"{query}"</span></p>
          </div>
        )}
      </div>

      {/* ── Jump to Application Details ── */}
      <div className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm">
        <p className="text-gray-500 text-xs font-medium mb-3 uppercase tracking-wide">Jump to Application Details</p>
        <div className="flex gap-3 items-end">
          <Combobox
            label="IT Department"
            options={departments}
            value={selectedDept}
            onChange={v => { setSelectedDept(v); setSelectedService(''); }}
            placeholder="e.g. Execution Services TechOps"
          />
          <Combobox
            label="Business Service Instance"
            options={availableServices}
            value={selectedService}
            onChange={setSelectedService}
            placeholder={selectedDept ? 'Select a service…' : 'Select department first…'}
            disabled={!selectedDept}
          />
          <button
            onClick={handleGo}
            disabled={!selectedService}
            className="shrink-0 flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition-colors"
          >
            Go <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

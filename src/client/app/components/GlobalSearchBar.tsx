import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { queryTable, getSysProperties, APP_SCOPE } from '../../api/servicenow';
import type { CIItem } from './CIDetailView';

// ── System property names ─────────────────────────────────────────────────────
const PROP_CI_FILTER    = `${APP_SCOPE}.ci.filter`;
const PROP_TABLES       = `${APP_SCOPE}.global.search.filter.table`;
const PROP_SEARCH_FIELD = `${APP_SCOPE}.global.search.filter.table.field`;
const PROP_RESULT_FIELD = `${APP_SCOPE}.global.search.result.field`;

// ── Defaults (used when properties cannot be read) ────────────────────────────
const DEFAULTS = {
  ciFilter:    'install_status!=7',
  tables:      'cmdb_ci_server,cmdb_ci_database,cmdb_ci_service_business,cmdb_ci_netgear',
  searchField: 'name',
  resultField: 'name,install_status,sys_class_name,managed_by',
};

// ── Reference fields that need dot-walking for display values ─────────────────
const DOT_WALK: Record<string, string> = {
  managed_by:    'managed_by.name',
  location:      'location.name',
  support_group: 'support_group.name',
  assigned_to:   'assigned_to.name',
};

// Fields always fetched regardless of result.field property
const BASE_API_FIELDS = ['sys_id', 'name', 'sys_class_name', 'environment', 'install_status'];

// ── Install status lookup ─────────────────────────────────────────────────────
const INSTALL_STATUS: Record<string, { label: string; color: string }> = {
  '1':   { label: 'Installed',       color: 'text-green-600' },
  '2':   { label: 'On Order',        color: 'text-blue-500'  },
  '3':   { label: 'In Maintenance',  color: 'text-yellow-600'},
  '4':   { label: 'Pending Install', color: 'text-yellow-500'},
  '5':   { label: 'Pending Repair',  color: 'text-orange-500'},
  '6':   { label: 'In Stock',        color: 'text-gray-500'  },
  '7':   { label: 'Retired',         color: 'text-red-500'   },
  '8':   { label: 'Missing',         color: 'text-red-400'   },
  '100': { label: 'Absent',          color: 'text-gray-400'  },
};

// ── Computed search config ────────────────────────────────────────────────────
interface SearchConfig {
  ciFilter:     string;
  tables:       string[];   // e.g. ['cmdb_ci_server', 'cmdb_ci_database', ...]
  searchField:  string;     // e.g. 'name'
  resultFields: string[];   // logical field names from property, e.g. ['name','install_status',...]
  apiFields:    string[];   // actual field names to request (with dot-walking)
}

// ── API row shape ─────────────────────────────────────────────────────────────
type ApiCI = Record<string, string> & {
  sys_id: string;
  name: string;
  sys_class_name: string;
  environment: string;
  install_status: string;
};

// ── Props ─────────────────────────────────────────────────────────────────────
interface GlobalSearchBarProps {
  onSelectCI: (ci: CIItem) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatClassName(cls: string): string {
  return cls
    .replace(/^cmdb_ci_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Build a single encoded-query string that covers all configured tables via
 * INSTANCEOF. Each table's conditions form their own NQ group (OR between
 * groups) so that name/status filters are applied within every group.
 *
 *   (name LIKE x AND ciFilter AND INSTANCEOF server)
 *   OR
 *   (name LIKE x AND ciFilter AND INSTANCEOF database)
 *   OR ...
 */
function buildQuery(cfg: SearchConfig, term: string): string {
  const likeCondition = `${cfg.searchField}LIKE${term}`;
  const baseGroup = `${likeCondition}^${cfg.ciFilter}`;
  if (cfg.tables.length === 0) return baseGroup;
  return cfg.tables
    .map(t => `${baseGroup}^sys_class_nameINSTANCEOF${t}`)
    .join('^NQ');
}

function apiToCIItem(r: ApiCI): CIItem {
  return {
    id:           r.sys_id,
    name:         r.name,
    type:         formatClassName(r.sys_class_name),
    class:        r.sys_class_name,
    environment:  r.environment ?? '',
    location:     r['location.name'] ?? '',
    owner:        r['managed_by.name'] ?? r['assigned_to.name'] ?? '',
    supportGroup: r['support_group.name'] ?? '',
    lastModified: '',
    hasIncident:  false,
    hasChange:    false,
  };
}

function parseConfig(props: Record<string, string>): SearchConfig {
  const tables = (props[PROP_TABLES] ?? DEFAULTS.tables)
    .split(',').map(s => s.trim()).filter(Boolean);
  const resultFields = (props[PROP_RESULT_FIELD] ?? DEFAULTS.resultField)
    .split(',').map(s => s.trim()).filter(Boolean);

  // Build the set of API fields: base + dot-walked references from result.field
  const apiFields = [...BASE_API_FIELDS];
  for (const f of resultFields) {
    if (BASE_API_FIELDS.includes(f)) continue;
    const api = DOT_WALK[f] ?? f;
    if (!apiFields.includes(api)) apiFields.push(api);
  }

  return {
    ciFilter:    props[PROP_CI_FILTER]    ?? DEFAULTS.ciFilter,
    tables,
    searchField: (props[PROP_SEARCH_FIELD] ?? DEFAULTS.searchField).split(',')[0].trim(),
    resultFields,
    apiFields,
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query || !text) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-800 rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function EnvBadge({ env }: { env: string }) {
  if (!env) return null;
  const isProd = /prod/i.test(env);
  return (
    <span className={`shrink-0 text-xs font-medium px-2.5 py-0.5 rounded-full ${
      isProd
        ? 'bg-green-100 text-green-700 border border-green-200'
        : 'bg-amber-100 text-amber-700 border border-amber-200'
    }`}>
      {isProd ? 'Production' : env || 'Non-Prod'}
    </span>
  );
}

function StatusDot({ value }: { value: string }) {
  const s = INSTALL_STATUS[value];
  if (!s) return null;
  return <span className={`text-xs font-medium ${s.color}`}>{s.label}</span>;
}

function KeyInfo({ r, cfg }: { r: ApiCI; cfg: SearchConfig }) {
  const items: React.ReactNode[] = [];

  for (const f of cfg.resultFields) {
    if (f === 'name') continue; // shown as header

    if (f === 'install_status') {
      const s = INSTALL_STATUS[r.install_status];
      if (s) items.push(
        <span key="status" className={`text-xs font-medium ${s.color}`}>{s.label}</span>
      );
      continue;
    }

    if (f === 'sys_class_name') {
      items.push(
        <span key="class" className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">
          {formatClassName(r.sys_class_name)}
        </span>
      );
      continue;
    }

    // Reference / other fields
    const apiKey  = DOT_WALK[f] ?? f;
    const rawVal  = r[apiKey];
    if (!rawVal) continue;

    // Human-readable label for the field
    const label = f === 'managed_by' ? 'Owner'
                : f === 'assigned_to' ? 'Owner'
                : f.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    items.push(
      <span key={f} className="text-xs text-gray-500">{label}: <span className="text-gray-700">{rawVal}</span></span>
    );
  }

  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-gray-300 select-none">·</span>}
          {item}
        </span>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GlobalSearchBar({ onSelectCI }: GlobalSearchBarProps) {
  const [config, setConfig]         = useState<SearchConfig | null>(null);
  const [query, setQuery]           = useState('');
  const [debounced, setDebounced]   = useState('');
  const [results, setResults]       = useState<ApiCI[]>([]);
  const [loading, setLoading]       = useState(false);
  const [open, setOpen]             = useState(false);
  const containerRef                = useRef<HTMLDivElement>(null);

  // Load all four system properties once on mount
  useEffect(() => {
    getSysProperties([PROP_CI_FILTER, PROP_TABLES, PROP_SEARCH_FIELD, PROP_RESULT_FIELD])
      .then(props => setConfig(parseConfig(props)))
      .catch(() => setConfig(parseConfig({})));
  }, []);

  // Debounce: wait 300 ms after the last keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = useCallback(async (term: string) => {
    if (!config || term.trim().length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    try {
      const snQuery = buildQuery(config, term.trim());
      const { result } = await queryTable<ApiCI>({
        table:  'cmdb_ci',
        query:  snQuery,
        fields: config.apiFields,
        limit:  8,
      });
      setResults(result ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [config]);

  useEffect(() => { search(debounced); }, [debounced, search]);

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleSelect = (r: ApiCI) => {
    setQuery(''); setDebounced(''); setResults([]); setOpen(false);
    onSelectCI(apiToCIItem(r));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); }
    if (e.key === 'Enter' && results.length > 0) handleSelect(results[0]);
  };

  const showDropdown = open && query.trim().length >= 2;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">

        {/* ── Search input ──────────────────────────────────────────────── */}
        <div className="flex items-center bg-white rounded-lg shadow-sm border border-transparent focus-within:ring-2 focus-within:ring-blue-300 transition-all">
          {loading
            ? <Loader2 className="w-4 h-4 text-gray-400 ml-4 shrink-0 animate-spin" />
            : <Search   className="w-4 h-4 text-gray-400 ml-4 shrink-0" />
          }
          <input
            type="text"
            placeholder="Search configuration items…"
            value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => { if (query.trim().length >= 2) setOpen(true); }}
            onKeyDown={handleKeyDown}
            className="flex-1 py-2 px-3 text-sm bg-transparent text-gray-800 placeholder-gray-400 focus:outline-none"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setDebounced(''); setResults([]); setOpen(false); }}
              className="mr-3 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Results dropdown ──────────────────────────────────────────── */}
        {showDropdown && results.length > 0 && config && (
          <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
            <div className="px-4 pt-2.5 pb-1">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
                {results.length} result{results.length !== 1 ? 's' : ''} found
              </p>
            </div>

            <ul>
              {results.map((r, i) => (
                <li key={r.sys_id}>
                  <button
                    onClick={() => handleSelect(r)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left group"
                  >
                    {/* Left: Name + key info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        <Highlight text={r.name} query={query} />
                      </p>
                      <KeyInfo r={r} cfg={config} />
                    </div>

                    {/* Right: environment badge */}
                    <EnvBadge env={r.environment} />
                  </button>
                  {i < results.length - 1 && <div className="mx-4 border-t border-gray-100" />}
                </li>
              ))}
            </ul>

            <div className="px-4 py-2 border-t border-gray-100 bg-gray-50">
              <p className="text-xs text-gray-400">Enter to open first result · Esc to close</p>
            </div>
          </div>
        )}

        {/* ── No results ────────────────────────────────────────────────── */}
        {showDropdown && !loading && results.length === 0 && (
          <div className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-xl px-4 py-6 text-center">
            <Search className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">
              No configuration items match <span className="font-medium">"{query}"</span>
            </p>
          </div>
        )}
    </div>
  );
}

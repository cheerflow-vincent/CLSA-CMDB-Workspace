import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Server, Database, CircuitBoard, Network, Search,
  ChevronDown, ArrowUpDown, ChevronLeft, ChevronRight,
  Check, X,
  Download, FileText, ExternalLink, Loader2
} from 'lucide-react';
import type { CIItem } from './CIDetailView';
import CIFlagBadges from './CIFlagBadges';
import FlagDetailPanel, { type FlagType } from './FlagDetailPanel';
import { queryTableWithAccess, getCIFilter, getSysProperties, APP_SCOPE, type TableAccess } from '../../api/servicenow';
import { loadListFields, raw, str, type ViewField } from '../utils/viewFields';
import { filterColumnsByRecords, isAccessDenied } from '../utils/acl';
import { useNarrowContainer } from '../utils/useNarrowLayout';
import { enrichRowsWithTaskFlags } from '../utils/relatedCIFlags';

const PROP_CI_SEARCH_FIELDS = `${APP_SCOPE}.ci.search.filter.table.field`;
const DEFAULT_SEARCH_FIELDS = ['name'];
const LIST_VIEW = 'CLSA CMDB Workspace';
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;
const MERGE_CAP = 500;

interface CISearchViewProps {
  onViewDetails: (ci: CIItem) => void;
  /** Pre-select a CI type card/tab (e.g. from sidebar inventory). */
  initialTab?: Tab;
}

type Tab = 'all' | 'servers' | 'switches' | 'databases' | 'circuits';

// ─── Constants ────────────────────────────────────────────────────────────────
const tabTypeMap: Record<Tab, string | null> = {
  all: null, servers: 'Server', switches: 'Network Gear',
  databases: 'Database', circuits: 'Circuit',
};
const tabLabels: Record<Tab, string> = {
  all: 'All Results', servers: 'Servers', switches: 'Network Gear',
  databases: 'Databases', circuits: 'Circuits',
};
// ─── v2 live-data config ──────────────────────────────────────────────────────
type SpecificTab = Exclude<Tab, 'all'>;

type V2TabCfg = {
  tab: SpecificTab;
  table: string;
  label: string;
  defaultColumns: ViewField[];
};

const ALL_DEFAULT_COLUMNS: ViewField[] = [
  { element: 'name',           label: 'Name'           },
  { element: 'sys_class_name', label: 'Class'          },
  { element: 'environment',    label: 'Environment'    },
  { element: 'location',       label: 'Location'       },
  { element: 'managed_by',     label: 'Managed by'     },
  { element: 'support_group',  label: 'Support group'  },
];

const V2_TABS: V2TabCfg[] = [
  {
    tab: 'servers', table: 'cmdb_ci_server', label: 'Server',
    defaultColumns: [
      { element: 'name', label: 'Name' }, { element: 'environment', label: 'Environment' },
      { element: 'os', label: 'OS' }, { element: 'location', label: 'Location' },
    ],
  },
  {
    tab: 'switches', table: 'cmdb_ci_netgear', label: 'Network Gear',
    defaultColumns: [
      { element: 'name', label: 'Name' }, { element: 'environment', label: 'Environment' },
      { element: 'model_id', label: 'Model' }, { element: 'location', label: 'Location' },
    ],
  },
  {
    tab: 'databases', table: 'cmdb_ci_db_instance', label: 'Database',
    defaultColumns: [
      { element: 'name', label: 'Name' }, { element: 'version', label: 'Version' },
      { element: 'environment', label: 'Environment' }, { element: 'location', label: 'Location' },
    ],
  },
  {
    tab: 'circuits', table: 'cmdb_ci_circuit', label: 'Circuit',
    defaultColumns: [
      { element: 'name', label: 'Name' }, { element: 'circuit_type', label: 'Type' },
      { element: 'bandwidth', label: 'Bandwidth' }, { element: 'environment', label: 'Environment' },
    ],
  },
];

interface SearchRow {
  sysId: string;
  sysClass: string;
  table: string;
  label: string;
  values: Record<string, string>;
  incidents: number;
  changes: number;
}

interface TabData {
  columns: ViewField[];
  rows: SearchRow[];
  totalCount: number;
  loading: boolean;
  access: TableAccess;
}

const EMPTY_TAB_DATA: TabData = { columns: [], rows: [], totalCount: 0, loading: false, access: 'ok' };

function formatClassLabel(cls: string): string {
  return cls.replace(/^cmdb_ci_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function apiFieldsForColumns(columns: ViewField[]): string[] {
  return [...new Set(['sys_id', 'name', 'sys_class_name', ...columns.map(c => c.element)])];
}

function resolveCiTable(rec: Record<string, unknown>, fallbackTable: string): string {
  const v = raw(rec.sys_class_name);
  if (v && /^cmdb_ci/.test(v)) return v;
  return fallbackTable;
}

function mapApiRow(
  rec: Record<string, unknown>,
  columns: ViewField[],
  cfg?: Pick<V2TabCfg, 'label' | 'table'>,
): SearchRow {
  const table = resolveCiTable(rec, cfg?.table ?? 'cmdb_ci');
  const values: Record<string, string> = {};
  for (const col of columns) {
    if (col.element in rec) values[col.element] = str(rec[col.element]);
  }
  if (!values.name) values.name = str(rec.name);
  return {
    sysId:    raw(rec.sys_id),
    sysClass: table,
    table,
    label:    cfg?.label ?? formatClassLabel(table),
    values,
    incidents: 0,
    changes:   0,
  };
}

function buildCIItem(row: SearchRow): CIItem {
  return {
    id:           row.sysId,
    name:         row.values.name || row.sysId,
    type:         row.label,
    class:        formatClassLabel(row.sysClass),
    table:        row.table,
    environment:  row.values.environment ?? '',
    location:     row.values.location ?? '',
    owner:        row.values.managed_by ?? row.values.assigned_to ?? '',
    supportGroup: row.values.support_group ?? '',
    lastModified: row.values.sys_updated_on ?? '',
    hasIncident:  row.incidents > 0,
    hasChange:    row.changes > 0,
  };
}

async function fetchTabPage(
  cfg: V2TabCfg,
  snQuery: string,
  columns: ViewField[],
  page: number,
  pageSize: number,
): Promise<{ rows: SearchRow[]; totalCount: number; access: TableAccess; columns: ViewField[] }> {
  const { result, totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: cfg.table,
    query: `${snQuery}^ORDERBYname`,
    fields: apiFieldsForColumns(columns),
    limit: pageSize,
    offset: page * pageSize,
    displayValue: true,
  });
  if (access === 'denied') {
    return { rows: [], totalCount: 0, access, columns: [] };
  }
  const records = result ?? [];
  const readableColumns = filterColumnsByRecords(columns, records);
  return {
    rows: records.map(r => mapApiRow(r, readableColumns, cfg)),
    totalCount,
    access,
    columns: readableColumns,
  };
}

async function fetchTabAll(
  cfg: V2TabCfg,
  snQuery: string,
  columns: ViewField[],
  totalCount: number,
): Promise<{ rows: SearchRow[]; access: TableAccess }> {
  if (!totalCount) return { rows: [], access: 'ok' };
  const limit = Math.min(totalCount, 10000);
  const { result, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: cfg.table,
    query: `${snQuery}^ORDERBYname`,
    fields: apiFieldsForColumns(columns),
    limit,
    displayValue: true,
  });
  if (access === 'denied') return { rows: [], access };
  const records = result ?? [];
  const readableColumns = filterColumnsByRecords(columns, records);
  return {
    rows: records.map(r => mapApiRow(r, readableColumns, cfg)),
    access,
  };
}

async function fetchAllForExport(
  snQuery: string,
  columns: ViewField[],
  tabCounts: Record<SpecificTab, number>,
  tabAccess: Record<SpecificTab, TableAccess>,
): Promise<SearchRow[]> {
  const parts = await Promise.all(
    V2_TABS.map(async cfg => {
      if (isAccessDenied(tabAccess[cfg.tab])) return [] as SearchRow[];
      const count = tabCounts[cfg.tab];
      if (!count) return [] as SearchRow[];
      const { rows } = await fetchTabAll(cfg, snQuery, columns, count);
      return rows;
    }),
  );
  return parts
    .flat()
    .sort((a, b) =>
      (a.values.name || '').localeCompare(b.values.name || '', undefined, { sensitivity: 'base' }),
    );
}

async function fetchAllMerged(
  snQuery: string,
  columns: ViewField[],
): Promise<{ rows: SearchRow[]; totalCount: number; tabAccess: Record<SpecificTab, TableAccess> }> {
  const apiFields = apiFieldsForColumns(columns);
  const tabAccess = {} as Record<SpecificTab, TableAccess>;
  const parts = await Promise.all(
    V2_TABS.map(async cfg => {
      const { result, totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
        table: cfg.table,
        query: `${snQuery}^ORDERBYname`,
        fields: apiFields,
        limit: MERGE_CAP,
        displayValue: true,
      });
      tabAccess[cfg.tab] = access;
      if (access === 'denied') {
        return { totalCount: 0, rows: [] as SearchRow[] };
      }
      const records = result ?? [];
      const readableColumns = filterColumnsByRecords(columns, records);
      return {
        totalCount,
        rows: records.map(r => mapApiRow(r, readableColumns, cfg)),
      };
    }),
  );
  const totalCount = parts.reduce((s, p) => s + p.totalCount, 0);
  const rows = parts
    .flatMap(p => p.rows)
    .sort((a, b) =>
      (a.values.name || '').localeCompare(b.values.name || '', undefined, { sensitivity: 'base' }),
    );
  return { rows, totalCount, tabAccess };
}

type PillCounts = { servers: number | null; switches: number | null; databases: number | null; circuits: number | null };
type PillAccess = Record<keyof PillCounts, TableAccess>;
const EMPTY_COUNTS: PillCounts = { servers: null, switches: null, databases: null, circuits: null };
const EMPTY_PILL_ACCESS: PillAccess = { servers: 'ok', switches: 'ok', databases: 'ok', circuits: 'ok' };

type PillDef = { tab: Tab; label: string; count: number | null; icon: JSX.Element; accent: string; iconBg: string };
const buildPills = (c: PillCounts, access: PillAccess): PillDef[] => ([
  { tab: 'servers' as Tab,   label: 'Servers',   count: c.servers,   icon: <Server       className="w-5 h-5 text-blue-600"   />, accent: 'border-blue-500   bg-blue-50',   iconBg: 'bg-blue-100'   },
  { tab: 'switches' as Tab,  label: 'Network Gear', count: c.switches,  icon: <Network      className="w-5 h-5 text-green-600"  />, accent: 'border-green-500  bg-green-50',  iconBg: 'bg-green-100'  },
  { tab: 'databases' as Tab, label: 'Databases', count: c.databases, icon: <Database     className="w-5 h-5 text-purple-600" />, accent: 'border-purple-500 bg-purple-50', iconBg: 'bg-purple-100' },
  { tab: 'circuits' as Tab,  label: 'Circuits',  count: c.circuits,  icon: <CircuitBoard className="w-5 h-5 text-orange-600" />, accent: 'border-orange-500 bg-orange-50', iconBg: 'bg-orange-100' },
] as PillDef[]).filter(p => !isAccessDenied(access[p.tab as keyof PillCounts]));
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

// ─── Export button ────────────────────────────────────────────────────────────
function ExportButton({
  columns,
  disabled,
  onFetchRows,
}: {
  columns: ViewField[];
  disabled: boolean;
  onFetchRows: () => Promise<SearchRow[]>;
}) {
  const [exporting, setExporting] = useState(false);

  const exportCSV = async () => {
    if (!columns.length || exporting) return;
    setExporting(true);
    try {
      const rows = await onFetchRows();
      if (!rows.length) return;
      const headers = columns.map(c => c.label);
      const csv = [
        headers.join(','),
        ...rows.map(row =>
          columns.map(c => `"${(row.values[c.element] || '').replace(/"/g, '""')}"`).join(','),
        ),
      ].join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ci_search_results.csv';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={exportCSV}
      disabled={disabled || exporting || !columns.length}
      className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {exporting
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <Download className="w-4 h-4" />}
      <FileText className="w-4 h-4 text-gray-500" />
      {exporting ? 'Exporting…' : 'Export CSV'}
    </button>
  );
}

// ─── Filters state ────────────────────────────────────────────────────────────
interface PendingFilters {
  keyword: string; ciType: string;
  environment: string[]; location: string[];
  businessService: string[]; supportGroup: string[];
}
const emptyPending = (): PendingFilters => ({ keyword: '', ciType: '', environment: [], location: [], businessService: [], supportGroup: [] });

function isDefaultFilters(f: PendingFilters): boolean {
  return !f.keyword.trim() && !f.ciType
    && !f.environment.length && !f.location.length
    && !f.businessService.length && !f.supportGroup.length;
}

/** Map CI Type dropdown label → results tab. */
function ciTypeToTab(ciType: string): Tab | null {
  const entry = (Object.entries(tabTypeMap) as [Tab, string | null][])
    .find(([, label]) => label === ciType);
  return entry?.[0] ?? null;
}

/**
 * Build encoded query: (field1 LIKE kw OR field2 LIKE kw …) AND ciFilter.
 * Fields come from x_citi4_clsa_cmd_0.ci.search.filter.table.field.
 */
function buildSnQuery(keyword: string, ciFilter: string, searchFields: string[]): string {
  const trimmed = keyword.trim();
  if (!trimmed) return ciFilter;

  const fields = searchFields.length ? searchFields : DEFAULT_SEARCH_FIELDS;
  const likeGroup = fields.map(f => `${f}LIKE${trimmed}`).join('^OR');
  return `${likeGroup}^${ciFilter}`;
}

function SearchResultCard({
  row,
  columns,
  onViewDetails,
  onFlagClick,
}: {
  row: SearchRow;
  columns: ViewField[];
  onViewDetails: (ci: CIItem) => void;
  onFlagClick?: (type: FlagType) => void;
}) {
  if (!columns.length) return null;

  const headerCol = columns[0];
  const bodyCols = columns.slice(1);
  const title = row.values[headerCol.element] || row.sysId;

  return (
    <div className="card-stack border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow bg-white">
      <div className="mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => onViewDetails(buildCIItem(row))}
            title="View CI details"
            className="text-sm font-semibold text-gray-900 hover:text-blue-700 hover:underline text-left break-words"
          >
            {title}
          </button>
          <CIFlagBadges
            incidents={row.incidents}
            changes={row.changes}
            onFlagClick={onFlagClick}
            size="md"
          />
        </div>
        <a
          href={`/${row.table || 'cmdb_ci'}.do?sys_id=${row.sysId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium mt-1"
          title="Open in ServiceNow"
        >
          <ExternalLink className="w-3 h-3" />
          Open in ServiceNow
        </a>
      </div>
      {bodyCols.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-1">
          {bodyCols.map(col => {
            if (!(col.element in row.values)) return null;
            const value = row.values[col.element];
            if (!value || value === '—') return null;
            return (
              <div key={col.element} className="rf-field-grid">
                <span className="rf-field-row__label">{col.label}</span>
                <span className="rf-field-row__value">{value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CISearchView({ onViewDetails, initialTab = 'all' }: CISearchViewProps) {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [pending, setPending]     = useState<PendingFilters>(emptyPending());
  const [applied, setApplied]     = useState<PendingFilters>(emptyPending());
  const [colFilters, setColFilters] = useState<Record<string, string>>({});
  const [panel, setPanel] = useState<{
    recordSysId: string;
    ciName: string;
    flagType: FlagType;
  } | null>(null);
  const [pillCounts, setPillCounts] = useState<PillCounts>(EMPTY_COUNTS);
  const [pillAccess, setPillAccess] = useState<PillAccess>(EMPTY_PILL_ACCESS);
  const [tabData, setTabData] = useState<Record<SpecificTab, TabData>>({
    servers: { ...EMPTY_TAB_DATA },
    switches: { ...EMPTY_TAB_DATA },
    databases: { ...EMPTY_TAB_DATA },
    circuits: { ...EMPTY_TAB_DATA },
  });
  const [allColumns, setAllColumns] = useState<ViewField[]>(ALL_DEFAULT_COLUMNS);
  const [allMergedRows, setAllMergedRows] = useState<SearchRow[]>([]);
  const [allTotalCount, setAllTotalCount] = useState(0);
  const [allLoading, setAllLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const { ref: narrowRef, narrow } = useNarrowContainer(720);
  const [ciFilter, setCiFilter]     = useState<string | null>(null);
  const [searchFields, setSearchFields] = useState<string[]>(DEFAULT_SEARCH_FIELDS);
  const columnsCache = useRef<Map<string, ViewField[]>>(new Map());

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const getColumns = useCallback(async (table: string, defaults: ViewField[]) => {
    const cached = columnsCache.current.get(table);
    if (cached) return cached;
    const cols = await loadListFields(table, LIST_VIEW, defaults);
    columnsCache.current.set(table, cols);
    return cols;
  }, []);

  const queryKey = useMemo(
    () => JSON.stringify({ applied, ciFilter, searchFields }),
    [applied, ciFilter, searchFields],
  );

  const snQuery = useMemo(() => {
    if (ciFilter === null) return '';
    return buildSnQuery(applied.keyword, ciFilter, searchFields);
  }, [applied.keyword, ciFilter, searchFields]);

  // Load CI filter + searchable fields from sys_properties
  useEffect(() => {
    getCIFilter().then(setCiFilter);
    getSysProperties([PROP_CI_SEARCH_FIELDS])
      .then(props => {
        const rawVal = props[PROP_CI_SEARCH_FIELDS] ?? DEFAULT_SEARCH_FIELDS.join(',');
        const fields = rawVal.split(',').map(s => s.trim()).filter(Boolean);
        setSearchFields(fields.length ? fields : DEFAULT_SEARCH_FIELDS);
      })
      .catch(() => setSearchFields(DEFAULT_SEARCH_FIELDS));
  }, []);

  // Inventory pill counts (top cards)
  useEffect(() => {
    if (ciFilter === null) return;
    const entries: [string, keyof PillCounts][] = [
      ['cmdb_ci_server',      'servers'],
      ['cmdb_ci_netgear',     'switches'],
      ['cmdb_ci_db_instance', 'databases'],
      ['cmdb_ci_circuit',     'circuits'],
    ];
    entries.forEach(([table, key]) =>
      queryTableWithAccess<object>({ table, query: ciFilter, limit: 1 })
        .then(({ totalCount, access }) => {
          setPillCounts(p => ({ ...p, [key]: access === 'denied' ? null : totalCount }));
          setPillAccess(p => ({ ...p, [key]: access }));
        })
        .catch(() => {}),
    );
  }, [ciFilter]);

  // Reset page when query or tab changes
  useEffect(() => { setPage(0); }, [queryKey, activeTab]);

  // Fetch result counts for all tabs when query changes
  useEffect(() => {
    if (!snQuery) return;
    let cancelled = false;
    Promise.all(
      V2_TABS.map(async cfg => {
        const { totalCount, access } = await queryTableWithAccess({
          table: cfg.table,
          query: snQuery,
          fields: ['sys_id'],
          limit: 1,
        });
        return [cfg.tab, totalCount, access] as const;
      }),
    )
      .then(counts => {
        if (cancelled) return;
        setTabData(prev => {
          const next = { ...prev };
          for (const [tab, totalCount, access] of counts) {
            next[tab] = { ...next[tab], totalCount: access === 'denied' ? 0 : totalCount, access };
          }
          return next;
        });
        setAllTotalCount(counts.reduce((s, [, c, access]) => s + (access === 'denied' ? 0 : c), 0));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [queryKey, snQuery]);

  // Load All Results merged data when query changes
  useEffect(() => {
    if (!snQuery) return;
    let cancelled = false;
    setAllLoading(true);
    getColumns('cmdb_ci', ALL_DEFAULT_COLUMNS)
      .then(cols => {
        if (cancelled) return null;
        setAllColumns(cols);
        return fetchAllMerged(snQuery, cols);
      })
      .then(async result => {
        if (cancelled || !result) return;
        const enriched = await enrichRowsWithTaskFlags(result.rows);
        if (cancelled) return;
        setAllMergedRows(enriched);
        setAllTotalCount(result.totalCount);
        setTabData(prev => {
          const next = { ...prev };
          for (const cfg of V2_TABS) {
            next[cfg.tab] = { ...next[cfg.tab], access: result.tabAccess[cfg.tab] };
          }
          return next;
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAllMergedRows([]);
          setAllTotalCount(0);
        }
      })
      .finally(() => { if (!cancelled) setAllLoading(false); });
    return () => { cancelled = true; };
  }, [queryKey, snQuery, getColumns]);

  // Load specific tab page when query, tab, page, or page size changes
  useEffect(() => {
    if (!snQuery || activeTab === 'all') return;
    let cancelled = false;
    const cfg = V2_TABS.find(t => t.tab === activeTab);
    if (!cfg) return;

    setTabData(prev => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], loading: true },
    }));

    getColumns(cfg.table, cfg.defaultColumns)
      .then(cols => {
        if (cancelled) return null;
        return fetchTabPage(cfg, snQuery, cols, page, pageSize).then(res => res);
      })
      .then(async result => {
        if (cancelled || !result) return;
        const enriched = await enrichRowsWithTaskFlags(result.rows);
        if (cancelled) return;
        setTabData(prev => ({
          ...prev,
          [activeTab]: {
            columns: result.columns,
            rows: enriched,
            totalCount: result.totalCount,
            loading: false,
            access: result.access,
          },
        }));
      })
      .catch(() => {
        if (!cancelled) {
          setTabData(prev => ({
            ...prev,
            [activeTab]: { ...prev[activeTab], rows: [], loading: false },
          }));
        }
      });

    return () => { cancelled = true; };
  }, [queryKey, snQuery, activeTab, page, pageSize, getColumns]);

  const handleSearch = () => {
    const next = { ...pending };
    setApplied(next);
    if (next.ciType) {
      const tab = ciTypeToTab(next.ciType);
      if (tab) setActiveTab(tab);
    }
  };

  const handleReset = () => {
    const cleared = emptyPending();
    setPending(cleared);
    setApplied(cleared);
    setColFilters({});
    setActiveTab('all');
    setPage(0);
  };

  const isAtDefault =
    isDefaultFilters(applied)
    && isDefaultFilters(pending)
    && Object.values(colFilters).every(v => !v)
    && activeTab === 'all';

  const columns = activeTab === 'all'
    ? (allColumns.length ? allColumns : ALL_DEFAULT_COLUMNS)
    : (tabData[activeTab].columns.length
      ? tabData[activeTab].columns
      : (V2_TABS.find(t => t.tab === activeTab)?.defaultColumns ?? []));
  const loading = activeTab === 'all' ? allLoading : tabData[activeTab].loading;
  const totalCount = activeTab === 'all'
    ? allTotalCount
    : tabData[activeTab].totalCount;

  const pageRows = activeTab === 'all'
    ? allMergedRows.slice(page * pageSize, (page + 1) * pageSize)
    : tabData[activeTab].rows;

  const displayRows = pageRows.filter(row =>
    columns.every(col => {
      const f = colFilters[col.element];
      if (!f) return true;
      return (row.values[col.element] || '').toLowerCase().includes(f.toLowerCase());
    }),
  );

  const tabResultCount = (tab: Tab): number | string => {
    if (tab === 'all') return allTotalCount;
    return tabData[tab].totalCount;
  };

  const paginationTotal = activeTab === 'all' ? allMergedRows.length : totalCount;
  const start = paginationTotal === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, paginationTotal);
  const canPrev = page > 0;
  const canNext = (page + 1) * pageSize < paginationTotal;

  const setColFilter = (element: string, val: string) =>
    setColFilters(f => ({ ...f, [element]: val }));

  const tabCounts = useMemo((): Record<SpecificTab, number> => ({
    servers:   tabData.servers.totalCount,
    switches:  tabData.switches.totalCount,
    databases: tabData.databases.totalCount,
    circuits:  tabData.circuits.totalCount,
  }), [tabData]);

  const tabAccess = useMemo((): Record<SpecificTab, TableAccess> => ({
    servers:   tabData.servers.access,
    switches:  tabData.switches.access,
    databases: tabData.databases.access,
    circuits:  tabData.circuits.access,
  }), [tabData]);

  const handleExportRows = useCallback(async (): Promise<SearchRow[]> => {
    if (!snQuery) return [];
    if (activeTab === 'all') {
      return fetchAllForExport(snQuery, columns, tabCounts, tabAccess);
    }
    const cfg = V2_TABS.find(t => t.tab === activeTab);
    if (!cfg || isAccessDenied(tabData[activeTab].access)) return [];
    const { rows } = await fetchTabAll(cfg, snQuery, columns, tabData[activeTab].totalCount);
    return rows;
  }, [snQuery, activeTab, columns, tabCounts, tabAccess, tabData]);

  const activeFilterCount = [pending.environment, pending.location, pending.businessService, pending.supportGroup]
    .reduce((n, arr) => n + arr.length, 0);

  function renderCell(row: SearchRow, col: ViewField, colIdx: number) {
    if (!(col.element in row.values)) return null;
    const val = row.values[col.element] || '—';

    if (colIdx === 0) {
      const openFlag = (type: FlagType) => {
        setPanel({
          recordSysId: row.sysId,
          ciName: val !== '—' ? val : row.values.name || row.sysId,
          flagType: type,
        });
      };
      return (
        <td key={col.element} className="px-6 py-4 max-w-[240px]">
          <div className="flex flex-col items-start gap-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => onViewDetails(buildCIItem(row))}
                title="View CI details"
                className="font-medium text-gray-900 hover:text-blue-700 hover:underline cursor-pointer text-left break-words bg-transparent border-0 p-0"
              >
                {val}
              </button>
              <CIFlagBadges
                incidents={row.incidents}
                changes={row.changes}
                onFlagClick={openFlag}
                size="md"
              />
            </div>
            <a
              href={`/${row.table || 'cmdb_ci'}.do?sys_id=${row.sysId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
              title="Open in ServiceNow"
            >
              <ExternalLink className="w-3 h-3" />
              Open in ServiceNow
            </a>
          </div>
        </td>
      );
    }

    return (
      <td key={col.element} className="px-6 py-4 text-sm text-gray-700 max-w-[200px] truncate" title={val}>
        {val}
      </td>
    );
  }

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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {buildPills(pillCounts, pillAccess).map(({ tab, label, count, icon, accent, iconBg }) => {
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`rounded-lg border-2 p-5 transition-all text-left ${isActive ? `${accent} shadow-sm` : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded shrink-0 ${iconBg}`}>{icon}</div>
                <div>
                  {count === null
                    ? <div className="h-7 w-16 bg-gray-200 animate-pulse rounded mb-1" />
                    : <p className="text-2xl font-semibold text-gray-900">{count.toLocaleString()}</p>
                  }
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
              <option value="Network Gear">Network Gear</option>
              <option value="Database">Database</option>
              <option value="Circuit">Circuit</option>
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
          <button
            type="button"
            onClick={handleReset}
            disabled={isAtDefault}
            className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Reset
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
          Select a CI Type and enter keywords to search that class using configured filter fields.
        </p>
      </div>

      {/* Tabs + Results */}
      <div ref={narrowRef} className="detail-pane bg-white rounded-lg border border-gray-200">
        {/* Tabs */}
        <div className="border-b border-gray-200 px-6">
          <div className="flex gap-6 overflow-x-auto">
            {(['all', 'servers', 'switches', 'databases', 'circuits'] as Tab[]).filter(tab => {
              if (tab === 'all') return true;
              return !isAccessDenied(tabData[tab].access) && !isAccessDenied(pillAccess[tab as keyof PillCounts]);
            }).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`py-3 whitespace-nowrap border-b-2 transition-colors text-sm ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
                {tabLabels[tab]}
                <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {loading && tab === activeTab
                    ? '…'
                    : tabResultCount(tab).toLocaleString()}
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
          <p className="text-sm text-gray-500">
            {totalCount.toLocaleString()} result{totalCount !== 1 ? 's' : ''}
          </p>
          <ExportButton
            columns={columns}
            disabled={totalCount === 0}
            onFetchRows={handleExportRows}
          />
        </div>

        {/* Results */}
        {narrow ? (
          <div className="px-6 pb-4 cards-grid-responsive">
            {loading ? (
              <div className="col-span-full flex items-center justify-center gap-2 py-12 text-gray-400 text-sm">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                Loading records…
              </div>
            ) : displayRows.length === 0 ? (
              <p className="col-span-full text-center text-gray-400 text-sm py-12">
                No records found. Try adjusting your filters and click Search.
              </p>
            ) : (
              displayRows.map(row => (
                <SearchResultCard
                  key={row.sysId}
                  row={row}
                  columns={columns}
                  onViewDetails={onViewDetails}
                  onFlagClick={type => setPanel({
                    recordSysId: row.sysId,
                    ciName: row.values.name || row.sysId,
                    flagType: type,
                  })}
                />
              ))
            )}
          </div>
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-y border-gray-200">
              <tr>
                {columns.map(col => (
                  <th key={col.element} className="px-6 py-3 text-left">
                    <button type="button" className="flex items-center gap-2 text-xs font-medium text-gray-700 uppercase hover:text-gray-900">
                      {col.label}<ArrowUpDown className="w-4 h-4" />
                    </button>
                  </th>
                ))}
              </tr>
              {columns.length > 0 && (
                <tr className="border-t border-gray-200">
                  {columns.map(col => (
                    <td key={col.element} className="px-3 pb-2 pt-1">
                      <div className="relative">
                        <input
                          type="text"
                          value={colFilters[col.element] ?? ''}
                          placeholder={`Filter ${col.label.toLowerCase()}…`}
                          onChange={e => setColFilter(col.element, e.target.value)}
                          className="w-full px-2 py-1 text-xs border border-gray-300 rounded bg-white placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300"
                        />
                        {colFilters[col.element] && (
                          <button
                            type="button"
                            onClick={() => setColFilter(col.element, '')}
                            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              )}
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="px-6 py-12 text-center text-gray-400 text-sm">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      Loading records…
                    </div>
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="px-6 py-12 text-center text-gray-400 text-sm">
                    No records found. Try adjusting your filters and click Search.
                  </td>
                </tr>
              ) : (
                displayRows.map(row => (
                  <tr key={row.sysId} className="hover:bg-gray-50">
                    {columns.map((col, colIdx) => renderCell(row, col, colIdx))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        )}

        {/* Pagination */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-700">Rows per page:</span>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm"
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}
            >
              {PAGE_SIZE_OPTIONS.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-700">
              {paginationTotal === 0 ? '0 of 0' : `${start}–${end} of ${paginationTotal.toLocaleString()}`}
              {activeTab === 'all' && allTotalCount > allMergedRows.length && (
                <span className="text-gray-400 ml-1">({allTotalCount.toLocaleString()} total)</span>
              )}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
                disabled={!canPrev}
                onClick={() => setPage(p => p - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                className="p-1 hover:bg-gray-100 rounded disabled:opacity-50"
                disabled={!canNext}
                onClick={() => setPage(p => p + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right slide-out panel */}
      {panel && (
        <FlagDetailPanel
          title={panel.ciName}
          flagType={panel.flagType}
          recordSysId={panel.recordSysId}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

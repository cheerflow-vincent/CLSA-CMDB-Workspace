import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Server, Database, Link, Network, Search,
  ChevronDown, ArrowUpDown, ChevronLeft, ChevronRight,
  X, Check, FilterX,
  Download, FileText, ExternalLink, Loader2
} from 'lucide-react';
import type { CIItem } from './CIDetailView';
import AppFamilyInstanceAutocomplete from './AppFamilyInstanceAutocomplete';
import CIFlagBadges from './CIFlagBadges';
import FlagDetailPanel, { type FlagType } from './FlagDetailPanel';
import CISearchSummaryBanner from './CISearchSummaryBanner';
import {
  queryTableWithAccess,
  getCIFilter,
  getSysProperties,
  fetchPortalMetadata,
  APP_SCOPE,
  formatCmdbTableLabel,
  type TableAccess,
} from '../../api/servicenow';
import { loadListFields, raw, str, type ViewField } from '../utils/viewFields';
import { filterColumnsByRecords, isAccessDenied } from '../utils/acl';
import { useNarrowContainer } from '../utils/useNarrowLayout';
import { enrichRowsWithTaskFlags } from '../utils/relatedCIFlags';
import {
  buildSnQueriesByTab,
  buildResultSnQueryForTab,
  buildAllTabSnQuery,
  fetchRelatedInfraCiIdsByTable,
  resolveInstanceIdsForAppSelection,
  fetchAllScopedCiRows,
  EMPTY_RELATED,
  type AppFilterSelection,
  type AppRelatedIdsByTab,
} from '../utils/ciSearchAppFilter';
import { buildColumnFiltersQuery } from '../utils/searchQuery';
import {
  buildSummaryContext,
  buildSidebarQueryBranches,
  fetchCiSearchSummaryCounts,
  type CiSearchSummaryContext,
  type SummaryFlagType,
} from '../utils/ciSearchSummary';

const PROP_CI_SEARCH_FIELDS = `${APP_SCOPE}.ci.search.filter.table.field`;
const PROP_CSV_EXPORT_LIMIT = 'glide.csv.export.limit';
const DEFAULT_SEARCH_FIELDS = ['name'];
const DEFAULT_CSV_EXPORT_LIMIT = 10_000;
const LIST_VIEW = 'CLSA CMDB Workspace';
const PAGE_SIZE_OPTIONS = [5, 10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;
const ALL_CI_TABLE = 'cmdb_ci';

interface CISearchViewProps {
  onViewDetails: (ci: CIItem) => void;
  /** Pre-select a CI type card/tab (e.g. from sidebar inventory). */
  initialTab?: Tab;
}

type Tab = 'all' | 'servers' | 'switches' | 'databases' | 'network_links';

// ─── Constants ────────────────────────────────────────────────────────────────
const tabTypeMap: Record<Tab, string | null> = {
  all: null, servers: 'Server', switches: 'Network Gear',
  databases: 'Database', network_links: 'Network Link',
};
const tabLabels: Record<Tab, string> = {
  all: 'All Results', servers: 'Servers', switches: 'Network Gears',
  databases: 'Databases', network_links: 'Network Links',
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
    tab: 'switches', table: 'cmdb_ci_netgear', label: 'Network Gears',
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
    tab: 'network_links', table: 'cmdb_ci_network_link', label: 'Network Link',
    defaultColumns: [
      { element: 'name', label: 'Name' }, { element: 'environment', label: 'Environment' },
      { element: 'location', label: 'Location' },
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

function resolveCiTable(rec: Record<string, unknown>, fallbackTable: string): string {
  const v = raw(rec.sys_class_name);
  if (v && /^cmdb_ci/.test(v)) return v;
  return fallbackTable;
}

/**
 * Build a safe ServiceNow record URL from a table name and sys_id.
 * The table name is validated to contain only word characters before encoding,
 * preventing path injection through API-sourced values.
 */
function buildServiceNowRecordUrl(table: string, sysId: string): string {
  const safeTable = /^\w+$/.test(table) ? table : 'cmdb_ci';
  return `/${encodeURIComponent(safeTable)}.do?sys_id=${encodeURIComponent(sysId)}`;
}

function apiFieldsForColumns(columns: ViewField[]): string[] {
  return [...new Set(['sys_id', 'name', 'sys_class_name', ...columns.map(c => c.element)])];
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
    label:    cfg?.label ?? formatCmdbTableLabel(table),
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
    class:        formatCmdbTableLabel(row.sysClass),
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

async function fetchAllTabPage(
  snQuery: string,
  columns: ViewField[],
  page: number,
  pageSize: number,
): Promise<{ rows: SearchRow[]; totalCount: number; access: TableAccess; columns: ViewField[] }> {
  const { result, totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: ALL_CI_TABLE,
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
    rows: records.map(r => mapApiRow(r, readableColumns)),
    totalCount,
    access,
    columns: readableColumns,
  };
}

async function fetchTabAll(
  table: string,
  snQuery: string,
  columns: ViewField[],
  totalCount: number,
  csvExportLimit: number,
): Promise<{ rows: SearchRow[]; access: TableAccess }> {
  if (!totalCount) return { rows: [], access: 'ok' };
  const limit = Math.min(totalCount, csvExportLimit);
  const { result, access } = await queryTableWithAccess<Record<string, unknown>>({
    table,
    query: `${snQuery}^ORDERBYname`,
    fields: apiFieldsForColumns(columns),
    limit,
    displayValue: true,
  });
  if (access === 'denied') return { rows: [], access };
  const records = result ?? [];
  const readableColumns = filterColumnsByRecords(columns, records);
  return {
    rows: records.map(r => mapApiRow(r, readableColumns)),
    access,
  };
}

type PillCounts = { servers: number | null; switches: number | null; databases: number | null; network_links: number | null };
type PillAccess = Record<keyof PillCounts, TableAccess>;
const EMPTY_COUNTS: PillCounts = { servers: null, switches: null, databases: null, network_links: null };
const EMPTY_PILL_ACCESS: PillAccess = { servers: 'ok', switches: 'ok', databases: 'ok', network_links: 'ok' };

type PillDef = { tab: Tab; label: string; count: number | null; icon: JSX.Element; accent: string; iconBg: string };
const buildPills = (c: PillCounts, access: PillAccess): PillDef[] => ([
  { tab: 'servers' as Tab,   label: 'Servers',   count: c.servers,   icon: <Server       className="w-5 h-5 text-blue-600"   />, accent: 'border-blue-500   bg-blue-50',   iconBg: 'bg-blue-100'   },
  { tab: 'switches' as Tab,  label: 'Network Gears', count: c.switches,  icon: <Network      className="w-5 h-5 text-green-600"  />, accent: 'border-green-500  bg-green-50',  iconBg: 'bg-green-100'  },
  { tab: 'databases' as Tab, label: 'Databases', count: c.databases, icon: <Database     className="w-5 h-5 text-purple-600" />, accent: 'border-purple-500 bg-purple-50', iconBg: 'bg-purple-100' },
  { tab: 'network_links' as Tab,  label: 'Network Links',  count: c.network_links,  icon: <Link className="w-5 h-5 text-orange-600" />, accent: 'border-orange-500 bg-orange-50', iconBg: 'bg-orange-100' },
] as PillDef[]).filter(p => !isAccessDenied(access[p.tab as keyof PillCounts]));

// ─── Export button ────────────────────────────────────────────────────────────
function ExportButton({
  columns,
  disabled,
  truncated,
  csvExportLimit,
  onFetchRows,
}: {
  columns: ViewField[];
  disabled: boolean;
  truncated?: boolean;
  csvExportLimit: number;
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
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={exportCSV}
        disabled={disabled || exporting || !columns.length}
        className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg typo-body hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exporting
          ? <Loader2 className="w-4 h-4 animate-spin" />
          : <Download className="w-4 h-4" />}
        <FileText className="w-4 h-4 text-gray-500" />
        {exporting ? 'Exporting…' : 'Export CSV'}
      </button>
      {truncated && (
        <p className="typo-caption text-amber-600">
          Export limited to {csvExportLimit.toLocaleString()} rows.
        </p>
      )}
    </div>
  );
}

// ─── Filters state ────────────────────────────────────────────────────────────
interface PendingFilters {
  keyword: string;
  ciType: string;
  appFilter: AppFilterSelection | null;
}
const emptyPending = (): PendingFilters => ({ keyword: '', ciType: '', appFilter: null });

function isDefaultFilters(f: PendingFilters): boolean {
  return !f.keyword.trim() && !f.ciType && !f.appFilter;
}

type ColFilterMap = Record<string, string>;
type ColFiltersByTab = Record<Tab, ColFilterMap>;

const EMPTY_COL_FILTERS_BY_TAB = (): ColFiltersByTab => ({
  all: {},
  servers: {},
  switches: {},
  databases: {},
  network_links: {},
});

function hasAppliedColFilters(map: ColFilterMap): boolean {
  return Object.values(map).some(v => v.trim());
}

function inventoryColumnElementsFromCache(
  tab: SpecificTab,
  columnsCache: Map<string, ViewField[]>,
): string[] {
  const cfg = V2_TABS.find(t => t.tab === tab);
  const cols = columnsCache.get(cfg?.table ?? '') ?? cfg?.defaultColumns ?? [];
  return cols.map(c => c.element);
}

function allTabColumnElements(allColumns: ViewField[]): string[] {
  return (allColumns.length ? allColumns : ALL_DEFAULT_COLUMNS).map(c => c.element);
}

function mergeAllowedFieldsFromCache(
  allColumns: ViewField[],
  tab: SpecificTab,
  columnsCache: Map<string, ViewField[]>,
): string[] {
  const tabFields = new Set(inventoryColumnElementsFromCache(tab, columnsCache));
  return allTabColumnElements(allColumns).filter(f => tabFields.has(f));
}

/** Map CI Type dropdown label → results tab. */
function ciTypeToTab(ciType: string): Tab | null {
  const entry = (Object.entries(tabTypeMap) as [Tab, string | null][])
    .find(([, label]) => label === ciType);
  return entry?.[0] ?? null;
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
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <button
              type="button"
              onClick={() => onViewDetails(buildCIItem(row))}
              title="View CI details"
              className="typo-panel-title text-gray-900 hover:text-blue-700 hover:underline text-left break-words"
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
            href={buildServiceNowRecordUrl(row.table || 'cmdb_ci', row.sysId)}
            target="_blank"
            rel="noopener noreferrer"
            className="typo-link self-start"
            title="Open in ServiceNow"
          >
            <ExternalLink className="w-3 h-3 shrink-0" />
            Open in ServiceNow
          </a>
        </div>
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
  const [colFiltersByTab, setColFiltersByTab] = useState<ColFiltersByTab>(EMPTY_COL_FILTERS_BY_TAB);
  const [appliedColFiltersByTab, setAppliedColFiltersByTab] = useState<ColFiltersByTab>(EMPTY_COL_FILTERS_BY_TAB);
  const [panel, setPanel] = useState<
    | { kind: 'ci'; recordSysId: string; ciName: string; flagType: 'incident' | 'change' }
    | { kind: 'summary'; flagType: SummaryFlagType; encodedQueries: string[]; title: string; subtitle: string }
    | null
  >(null);
  const [summary, setSummary] = useState<{
    incidents: number;
    changes: number;
    health: number;
    access: { incidents: TableAccess; changes: TableAccess; health: TableAccess };
    loading: boolean;
  }>({ incidents: 0, changes: 0, health: 0, access: { incidents: 'ok', changes: 'ok', health: 'ok' }, loading: false });
  const summaryContextRef = useRef<CiSearchSummaryContext | null>(null);
  const [pillCounts, setPillCounts] = useState<PillCounts>(EMPTY_COUNTS);
  const [pillAccess, setPillAccess] = useState<PillAccess>(EMPTY_PILL_ACCESS);
  const [tabData, setTabData] = useState<Record<SpecificTab, TabData>>({
    servers: { ...EMPTY_TAB_DATA },
    switches: { ...EMPTY_TAB_DATA },
    databases: { ...EMPTY_TAB_DATA },
    network_links: { ...EMPTY_TAB_DATA },
  });
  const [allColumns, setAllColumns] = useState<ViewField[]>(ALL_DEFAULT_COLUMNS);
  const [allTabData, setAllTabData] = useState<TabData>({ ...EMPTY_TAB_DATA });
  const [csvExportLimit, setCsvExportLimit] = useState(DEFAULT_CSV_EXPORT_LIMIT);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const { ref: narrowRef, narrow } = useNarrowContainer(720);
  const [ciFilter, setCiFilter]     = useState<string | null>(null);
  const [searchFields, setSearchFields] = useState<string[]>(DEFAULT_SEARCH_FIELDS);
  const [hierarchyMode, setHierarchyMode] = useState(true);
  const [appRelatedIdsByTab, setAppRelatedIdsByTab] = useState<AppRelatedIdsByTab | null>(null);
  const [appFilterLoading, setAppFilterLoading] = useState(false);
  const [appFilterError, setAppFilterError] = useState<string | null>(null);
  const columnsCache = useRef<Map<string, ViewField[]>>(new Map());
  const [columnsLoadedKey, setColumnsLoadedKey] = useState(0);

  const appFilterActive = !!applied.appFilter;

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const getColumns = useCallback(async (table: string, defaults: ViewField[]) => {
    const cached = columnsCache.current.get(table);
    if (cached) return cached;
    const cols = await loadListFields(table, LIST_VIEW, defaults);
    columnsCache.current.set(table, cols);
    setColumnsLoadedKey(k => k + 1);
    return cols;
  }, []);

  const queryKey = useMemo(
    () => JSON.stringify({ applied, ciFilter, searchFields, appRelatedIdsByTab }),
    [applied, ciFilter, searchFields, appRelatedIdsByTab],
  );

  const baseSnQueriesByTab = useMemo(() => {
    if (ciFilter === null) {
      return {
        servers: '',
        switches: '',
        databases: '',
        network_links: '',
      } as Record<SpecificTab, string>;
    }
    return buildSnQueriesByTab(
      appRelatedIdsByTab,
      applied.keyword,
      ciFilter,
      searchFields,
      appFilterActive,
    );
  }, [applied.keyword, ciFilter, searchFields, appRelatedIdsByTab, appFilterActive]);

  const tabBadgeQueriesByTab = useMemo(() => {
    if (ciFilter === null) {
      return {
        servers: '',
        switches: '',
        databases: '',
        network_links: '',
      } as Record<SpecificTab, string>;
    }
    const out = {} as Record<SpecificTab, string>;
    for (const cfg of V2_TABS) {
      out[cfg.tab] = buildResultSnQueryForTab(
        baseSnQueriesByTab[cfg.tab],
        appliedColFiltersByTab[cfg.tab],
        inventoryColumnElementsFromCache(cfg.tab, columnsCache.current),
      );
    }
    return out;
  }, [baseSnQueriesByTab, appliedColFiltersByTab, ciFilter, columnsLoadedKey]);

  const tabBadgeQueryKey = useMemo(
    () => JSON.stringify(tabBadgeQueriesByTab),
    [tabBadgeQueriesByTab],
  );

  const mergeQueriesByTab = useMemo(() => {
    if (ciFilter === null) {
      return {
        servers: '',
        switches: '',
        databases: '',
        network_links: '',
      } as Record<SpecificTab, string>;
    }
    const out = {} as Record<SpecificTab, string>;
    for (const cfg of V2_TABS) {
      out[cfg.tab] = buildResultSnQueryForTab(
        baseSnQueriesByTab[cfg.tab],
        appliedColFiltersByTab.all,
        mergeAllowedFieldsFromCache(allColumns, cfg.tab, columnsCache.current),
      );
    }
    return out;
  }, [baseSnQueriesByTab, appliedColFiltersByTab.all, allColumns, ciFilter, columnsLoadedKey]);

  const allowedFieldsByTab = useMemo((): Record<SpecificTab, string[]> => {
    const out = {} as Record<SpecificTab, string[]>;
    for (const cfg of V2_TABS) {
      out[cfg.tab] = mergeAllowedFieldsFromCache(allColumns, cfg.tab, columnsCache.current);
    }
    return out;
  }, [allColumns, columnsLoadedKey]);

  const allTabSnQuery = useMemo(() => {
    if (ciFilter === null) return '';
    return buildAllTabSnQuery(
      baseSnQueriesByTab,
      appliedColFiltersByTab.all,
      allowedFieldsByTab,
      appFilterActive,
    );
  }, [baseSnQueriesByTab, appliedColFiltersByTab.all, allowedFieldsByTab, ciFilter, appFilterActive]);

  const allTabQueryKey = useMemo(
    () => JSON.stringify(allTabSnQuery),
    [allTabSnQuery],
  );

  const summaryQueriesByTab = useMemo(() => {
    if (activeTab === 'all') return mergeQueriesByTab;
    return tabBadgeQueriesByTab;
  }, [activeTab, mergeQueriesByTab, tabBadgeQueriesByTab]);

  const columnFilterPartByTab = useMemo((): Record<SpecificTab, string> => {
    const out = {} as Record<SpecificTab, string>;
    for (const cfg of V2_TABS) {
      const allowed = activeTab === 'all'
        ? mergeAllowedFieldsFromCache(allColumns, cfg.tab, columnsCache.current)
        : inventoryColumnElementsFromCache(cfg.tab, columnsCache.current);
      const filterSource = activeTab === 'all'
        ? appliedColFiltersByTab.all
        : appliedColFiltersByTab[cfg.tab];
      out[cfg.tab] = buildColumnFiltersQuery(filterSource, allowed);
    }
    return out;
  }, [activeTab, appliedColFiltersByTab, allColumns, columnsLoadedKey]);

  const resultQueryKey = useMemo(
    () => JSON.stringify(appliedColFiltersByTab),
    [appliedColFiltersByTab],
  );

  const activeTabFilterKey = useMemo(
    () => JSON.stringify(appliedColFiltersByTab[activeTab]),
    [appliedColFiltersByTab, activeTab],
  );

  const queriesReady = ciFilter !== null && (!appFilterActive || (!appFilterLoading && appRelatedIdsByTab !== null));

  // Load CI filter, searchable fields, hierarchy mode, and CSV export limit
  useEffect(() => {
    getCIFilter().then(setCiFilter);
    getSysProperties([PROP_CI_SEARCH_FIELDS, PROP_CSV_EXPORT_LIMIT])
      .then(props => {
        const rawVal = props[PROP_CI_SEARCH_FIELDS] ?? DEFAULT_SEARCH_FIELDS.join(',');
        const fields = rawVal.split(',').map(s => s.trim()).filter(Boolean);
        setSearchFields(fields.length ? fields : DEFAULT_SEARCH_FIELDS);
        const parsedLimit = parseInt(props[PROP_CSV_EXPORT_LIMIT] ?? '', 10);
        setCsvExportLimit(Number.isFinite(parsedLimit) && parsedLimit > 0
          ? parsedLimit
          : DEFAULT_CSV_EXPORT_LIMIT);
      })
      .catch(() => {
        setSearchFields(DEFAULT_SEARCH_FIELDS);
        setCsvExportLimit(DEFAULT_CSV_EXPORT_LIMIT);
      });
    fetchPortalMetadata()
      .then(meta => setHierarchyMode(meta.hierarchy_mode))
      .catch(() => setHierarchyMode(true));
  }, []);

  // Resolve related infra CI IDs when an app filter is applied
  useEffect(() => {
    if (!applied.appFilter) {
      setAppRelatedIdsByTab(null);
      setAppFilterLoading(false);
      setAppFilterError(null);
      return;
    }

    let cancelled = false;
    setAppFilterLoading(true);
    setAppFilterError(null);
    setAppRelatedIdsByTab(null);

    (async () => {
      try {
        const instanceIds = await resolveInstanceIdsForAppSelection(applied.appFilter!, hierarchyMode);
        if (cancelled) return;
        if (!instanceIds.length) {
          setAppRelatedIdsByTab({ ...EMPTY_RELATED });
          return;
        }
        const { idsByTab, access } = await fetchRelatedInfraCiIdsByTable(instanceIds);
        if (cancelled) return;
        if (access === 'denied') {
          setAppFilterError('Access denied while loading application relationships.');
          setAppRelatedIdsByTab({ ...EMPTY_RELATED });
          return;
        }
        setAppRelatedIdsByTab(idsByTab);
      } catch (e) {
        if (!cancelled) {
          setAppFilterError('Failed to load application relationships. Please try again.');
          setAppRelatedIdsByTab({ ...EMPTY_RELATED });
        }
      } finally {
        if (!cancelled) setAppFilterLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [applied.appFilter, hierarchyMode]);

  // Inventory pill counts (top cards)
  useEffect(() => {
    if (ciFilter === null) return;
    const entries: [string, keyof PillCounts][] = [
      ['cmdb_ci_server',      'servers'],
      ['cmdb_ci_netgear',     'switches'],
      ['cmdb_ci_db_instance', 'databases'],
      ['cmdb_ci_network_link', 'network_links'],
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

  // Reset page when query, tab, or active tab column filters change
  useEffect(() => { setPage(0); }, [queryKey, activeTab, activeTabFilterKey]);

  // Fetch result counts for all tabs when query changes
  useEffect(() => {
    if (!queriesReady) return;
    let cancelled = false;
    Promise.all(
      V2_TABS.map(async cfg => {
        const { totalCount, access } = await queryTableWithAccess({
          table: cfg.table,
          query: tabBadgeQueriesByTab[cfg.tab],
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
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [queryKey, resultQueryKey, tabBadgeQueryKey, queriesReady]);

  // Fetch All Results tab count when query changes
  useEffect(() => {
    if (!queriesReady || !allTabSnQuery) return;
    let cancelled = false;
    queryTableWithAccess({
      table: ALL_CI_TABLE,
      query: allTabSnQuery,
      fields: ['sys_id'],
      limit: 1,
    })
      .then(({ totalCount, access }) => {
        if (cancelled) return;
        setAllTabData(prev => ({
          ...prev,
          totalCount: access === 'denied' ? 0 : totalCount,
          access,
        }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [queryKey, resultQueryKey, allTabQueryKey, queriesReady, allTabSnQuery]);

  // Load All Results tab page with server-side pagination
  useEffect(() => {
    if (!queriesReady || activeTab !== 'all' || !allTabSnQuery) return;
    let cancelled = false;

    setAllTabData(prev => ({ ...prev, loading: true }));

    getColumns(ALL_CI_TABLE, ALL_DEFAULT_COLUMNS)
      .then(cols => {
        if (cancelled) return null;
        setAllColumns(cols);
        return fetchAllTabPage(allTabSnQuery, cols, page, pageSize);
      })
      .then(async result => {
        if (cancelled || !result) return;
        const enriched = await enrichRowsWithTaskFlags(result.rows);
        if (cancelled) return;
        setAllTabData({
          columns: result.columns,
          rows: enriched,
          totalCount: result.totalCount,
          loading: false,
          access: result.access,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setAllTabData(prev => ({ ...prev, rows: [], loading: false }));
        }
      });

    return () => { cancelled = true; };
  }, [
    queryKey,
    resultQueryKey,
    allTabQueryKey,
    queriesReady,
    activeTab,
    page,
    pageSize,
    getColumns,
    allTabSnQuery,
  ]);

  // Load specific tab rows when app filter is active (client-side pagination)
  useEffect(() => {
    if (!queriesReady || activeTab === 'all' || !appFilterActive || !appRelatedIdsByTab) return;
    let cancelled = false;
    const cfg = V2_TABS.find(t => t.tab === activeTab);
    if (!cfg) return;

    setTabData(prev => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], loading: true },
    }));

    getColumns(cfg.table, cfg.defaultColumns)
      .then(async cols => {
        if (cancelled) return null;
        const relatedIds = appRelatedIdsByTab[activeTab];
        const columnFilterPart = buildColumnFiltersQuery(
          appliedColFiltersByTab[activeTab],
          cols.map(c => c.element),
        );
        const { rows: records, access } = await fetchAllScopedCiRows<Record<string, unknown>>(
          cfg.table,
          relatedIds,
          applied.keyword,
          ciFilter ?? '',
          searchFields,
          apiFieldsForColumns(cols),
          columnFilterPart,
        );
        if (cancelled) return null;
        if (access === 'denied') {
          return {
            rows: [] as SearchRow[],
            totalCount: 0,
            access,
            columns: cols,
          };
        }
        const readableColumns = filterColumnsByRecords(cols, records);
        const rows = records.map(r => mapApiRow(r, readableColumns, cfg));
        return {
          rows,
          totalCount: rows.length,
          access,
          columns: readableColumns,
        };
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
  }, [
    queryKey,
    resultQueryKey,
    queriesReady,
    activeTab,
    getColumns,
    appFilterActive,
    appRelatedIdsByTab,
    applied.keyword,
    ciFilter,
    searchFields,
    activeTabFilterKey,
  ]);

  // Load specific tab page with server-side pagination when no app filter
  useEffect(() => {
    if (!queriesReady || activeTab === 'all' || appFilterActive) return;
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
        return fetchTabPage(cfg, tabBadgeQueriesByTab[activeTab], cols, page, pageSize);
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
  }, [
    queryKey,
    resultQueryKey,
    tabBadgeQueryKey,
    queriesReady,
    activeTab,
    page,
    pageSize,
    getColumns,
    appFilterActive,
  ]);

  const handleSearch = () => {
    const next = { ...pending };
    setApplied(next);
    setColFiltersByTab(EMPTY_COL_FILTERS_BY_TAB());
    setAppliedColFiltersByTab(EMPTY_COL_FILTERS_BY_TAB());
    if (next.ciType) {
      const tab = ciTypeToTab(next.ciType);
      if (tab) setActiveTab(tab);
    }
  };

  const handleReset = () => {
    const cleared = emptyPending();
    setPending(cleared);
    setApplied(cleared);
    setColFiltersByTab(EMPTY_COL_FILTERS_BY_TAB());
    setAppliedColFiltersByTab(EMPTY_COL_FILTERS_BY_TAB());
    setActiveTab('all');
    setPage(0);
  };

  const isAtDefault =
    isDefaultFilters(applied)
    && isDefaultFilters(pending)
    && Object.values(appliedColFiltersByTab).every(m => !hasAppliedColFilters(m))
    && Object.values(colFiltersByTab).every(m => !hasAppliedColFilters(m))
    && activeTab === 'all';

  const columns = activeTab === 'all'
    ? (allColumns.length ? allColumns : ALL_DEFAULT_COLUMNS)
    : (tabData[activeTab].columns.length
      ? tabData[activeTab].columns
      : (V2_TABS.find(t => t.tab === activeTab)?.defaultColumns ?? []));
  const loading = appFilterLoading || (activeTab === 'all' ? allTabData.loading : tabData[activeTab].loading);
  const totalCount = activeTab === 'all'
    ? allTabData.totalCount
    : tabData[activeTab].totalCount;

  const pageRows = (activeTab !== 'all' && appFilterActive)
    ? tabData[activeTab].rows.slice(page * pageSize, (page + 1) * pageSize)
    : (activeTab === 'all' ? allTabData.rows : tabData[activeTab].rows);

  const displayRows = pageRows;

  const tabResultCount = (tab: Tab): number | string => {
    if (tab === 'all') return allTabData.totalCount;
    return tabData[tab].totalCount;
  };

  const paginationTotal = (activeTab !== 'all' && appFilterActive)
    ? tabData[activeTab].rows.length
    : totalCount;
  const start = paginationTotal === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, paginationTotal);
  const canPrev = page > 0;
  const canNext = (page + 1) * pageSize < paginationTotal;

  const pendingColFilters = colFiltersByTab[activeTab] ?? {};
  const appliedColFilters = appliedColFiltersByTab[activeTab] ?? {};
  const activeTabHasColFilters = hasAppliedColFilters(appliedColFilters);

  const setColFilter = (element: string, val: string) =>
    setColFiltersByTab(prev => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? {}), [element]: val },
    }));

  const markTabResultsLoading = () => {
    if (activeTab === 'all') {
      setAllTabData(prev => ({ ...prev, loading: true, rows: [] }));
      return;
    }
    setTabData(prev => ({
      ...prev,
      [activeTab]: { ...prev[activeTab], loading: true, rows: [] },
    }));
  };

  const applyColFiltersForTab = () => {
    const pending = colFiltersByTab[activeTab] ?? {};
    const nextApplied: ColFilterMap = {};
    for (const [element, rawVal] of Object.entries(pending)) {
      if (rawVal.trim()) nextApplied[element] = rawVal;
    }
    setAppliedColFiltersByTab(prev => ({ ...prev, [activeTab]: nextApplied }));
    markTabResultsLoading();
    setPage(0);
  };

  const applyColFilter = () => {
    applyColFiltersForTab();
  };

  const clearColFilter = (element: string) => {
    setColFiltersByTab(prev => {
      const next = { ...(prev[activeTab] ?? {}) };
      delete next[element];
      return { ...prev, [activeTab]: next };
    });
    setAppliedColFiltersByTab(prev => {
      const next = { ...(prev[activeTab] ?? {}) };
      delete next[element];
      return { ...prev, [activeTab]: next };
    });
    markTabResultsLoading();
    setPage(0);
  };

  const clearActiveTabColFilters = () => {
    setColFiltersByTab(prev => ({ ...prev, [activeTab]: {} }));
    setAppliedColFiltersByTab(prev => ({ ...prev, [activeTab]: {} }));
    markTabResultsLoading();
    setPage(0);
  };

  const isColFilterDirty = (element: string) =>
    (pendingColFilters[element] ?? '') !== (appliedColFilters[element] ?? '');

  const isColFilterActive = (element: string) =>
    !!(appliedColFilters[element]?.trim());

  const tabCounts = useMemo((): Record<SpecificTab, number> => ({
    servers:   tabData.servers.totalCount,
    switches:  tabData.switches.totalCount,
    databases: tabData.databases.totalCount,
    network_links:  tabData.network_links.totalCount,
  }), [tabData]);

  const summaryContext = useMemo((): CiSearchSummaryContext | null => {
    if (ciFilter === null) return null;
    return buildSummaryContext(
      activeTab,
      applied,
      summaryQueriesByTab,
      columnFilterPartByTab,
      appRelatedIdsByTab,
      tabCounts,
      allTabData.totalCount,
      ciFilter,
      searchFields,
    );
  }, [
    activeTab,
    applied,
    summaryQueriesByTab,
    columnFilterPartByTab,
    appRelatedIdsByTab,
    tabCounts,
    allTabData.totalCount,
    ciFilter,
    searchFields,
  ]);

  useEffect(() => {
    summaryContextRef.current = summaryContext;
  }, [summaryContext]);

  useEffect(() => {
    if (!queriesReady || !summaryContext) {
      setSummary(prev => ({ ...prev, loading: false, incidents: 0, changes: 0, health: 0 }));
      return;
    }

    let cancelled = false;
    setSummary(prev => ({ ...prev, loading: true }));

    fetchCiSearchSummaryCounts(summaryContext)
      .then(result => {
        if (cancelled) return;
        setSummary({ ...result, loading: false });
      })
      .catch(() => {
        if (!cancelled) {
          setSummary({
            incidents: 0,
            changes: 0,
            health: 0,
            access: { incidents: 'error', changes: 'error', health: 'error' },
            loading: false,
          });
        }
      });

    return () => { cancelled = true; };
  }, [queryKey, resultQueryKey, activeTab, queriesReady, summaryContext]);

  const handleSummaryChipClick = useCallback((flagType: SummaryFlagType) => {
    const context = summaryContextRef.current;
    if (!context) return;
    const encodedQueries = buildSidebarQueryBranches(context, flagType);
    if (!encodedQueries.length) return;

    const titles: Record<SummaryFlagType, string> = {
      incident: 'Active Incidents',
      change: 'Upcoming Changes',
      health: 'Active Health Metrics',
    };

    setPanel({
      kind: 'summary',
      flagType,
      encodedQueries,
      title: context.label,
      subtitle: titles[flagType],
    });
  }, []);


  const handleExportRows = useCallback(async (): Promise<SearchRow[]> => {
    if (!queriesReady) return [];
    if (activeTab === 'all') {
      if (isAccessDenied(allTabData.access) || !allTabSnQuery) return [];
      const { rows } = await fetchTabAll(
        ALL_CI_TABLE,
        allTabSnQuery,
        columns,
        allTabData.totalCount,
        csvExportLimit,
      );
      return rows;
    }
    const cfg = V2_TABS.find(t => t.tab === activeTab);
    if (!cfg || isAccessDenied(tabData[activeTab].access)) return [];
    if (appFilterActive) {
      return tabData[activeTab].rows;
    }
    const { rows } = await fetchTabAll(
      cfg.table,
      tabBadgeQueriesByTab[activeTab],
      columns,
      tabData[activeTab].totalCount,
      csvExportLimit,
    );
    return rows;
  }, [
    queriesReady,
    allTabSnQuery,
    tabBadgeQueriesByTab,
    activeTab,
    columns,
    allTabData,
    tabData,
    appFilterActive,
    csvExportLimit,
  ]);

  const exportTruncated = useMemo(() => {
    if (activeTab === 'all') {
      return allTabData.totalCount > csvExportLimit;
    }
    const specificTab = activeTab as SpecificTab;
    return (tabData[specificTab]?.totalCount ?? 0) > csvExportLimit;
  }, [activeTab, allTabData.totalCount, tabData, csvExportLimit]);

  function renderCell(row: SearchRow, col: ViewField, colIdx: number) {
    if (!(col.element in row.values)) return null;
    const val = row.values[col.element] || '—';

    if (colIdx === 0) {
      const openFlag = (type: FlagType) => {
        setPanel({
          kind: 'ci',
          recordSysId: row.sysId,
          ciName: val !== '—' ? val : row.values.name || row.sysId,
          flagType: type as 'incident' | 'change',
        });
      };
      return (
        <td key={col.element} className="px-6 py-4 max-w-[280px]">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <button
                type="button"
                onClick={() => onViewDetails(buildCIItem(row))}
                title="View CI details"
                className="typo-body font-medium text-gray-900 hover:text-blue-700 hover:underline cursor-pointer text-left break-words bg-transparent border-0 p-0"
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
              href={buildServiceNowRecordUrl(row.table || 'cmdb_ci', row.sysId)}
              target="_blank"
              rel="noopener noreferrer"
              className="typo-link self-start"
              title="Open in ServiceNow"
            >
              <ExternalLink className="w-3 h-3 shrink-0" />
              Open in ServiceNow
            </a>
          </div>
        </td>
      );
    }

    return (
      <td key={col.element} className="px-6 py-4 typo-body text-gray-700 max-w-[200px] truncate" title={val}>
        {val}
      </td>
    );
  }

  return (
    <div className="p-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 typo-body text-gray-600 mb-6">
        <span>Home</span><ChevronRight className="w-4 h-4" /><span className="text-gray-900">Welcome to CMDB</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="typo-page-title">Welcome to CMDB</h1>
        <p className="text-gray-600 mt-1">Search and manage all configuration items from a single portal.</p>
      </div>

      {/* CI Count Pills */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {buildPills(pillCounts, pillAccess).map(({ tab, label, count, icon, accent, iconBg }) => {
          const isActive = activeTab === tab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)}
              type="button"
              className={`rounded-lg border-2 p-5 transition-all text-left ${isActive ? `${accent} shadow-sm` : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded shrink-0 ${iconBg}`}>{icon}</div>
                <div>
                  {count === null
                    ? <div className="h-7 w-16 bg-gray-200 animate-pulse rounded mb-1" />
                    : <p className="typo-stat">{count.toLocaleString()}</p>
                  }
                  <p className="typo-body text-gray-600">{label}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Search Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
        <div className="flex flex-col xl:flex-row xl:items-end gap-3">
          <div className="flex-1 min-w-0 xl:min-w-[220px]">
            <label className="block typo-label mb-1.5">Application</label>
            <AppFamilyInstanceAutocomplete
              value={pending.appFilter}
              onChange={v => setPending(p => ({ ...p, appFilter: v }))}
              hierarchyMode={hierarchyMode}
              disabled={appFilterLoading}
              compact
              className="w-full"
            />
          </div>

          <div className="w-full xl:w-44 shrink-0">
            <label className="block typo-label mb-1.5">CI Type</label>
            <div className="relative">
              <select
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg appearance-none bg-white pr-10 typo-body"
                value={pending.ciType}
                onChange={e => setPending(p => ({ ...p, ciType: e.target.value }))}
              >
                <option value="">All types</option>
                <option value="Server">Server</option>
                <option value="Network Gear">Network Gear</option>
                <option value="Database">Database</option>
                <option value="Network Link">Network Link</option>
              </select>
              <ChevronDown className="w-5 h-5 text-gray-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>

          <div className="flex-[1.5] min-w-0">
            <label className="block typo-label mb-1.5">Keywords</label>
            <div className="relative">
              <Search className="w-5 h-5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search keywords…"
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg typo-body"
                value={pending.keyword}
                onChange={e => setPending(p => ({ ...p, keyword: e.target.value }))}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
              />
            </div>
          </div>

          <div className="flex gap-2 shrink-0 xl:pb-0">
            <button
              type="button"
              onClick={handleSearch}
              className="flex-1 xl:flex-none px-6 py-2.5 bg-blue-900 text-white rounded-lg hover:bg-blue-800 transition-colors typo-body font-medium"
            >
              Search
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isAtDefault}
              className="flex-1 xl:flex-none px-5 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed typo-body"
            >
              Reset
            </button>
          </div>
        </div>

        {appFilterError && (
          <p className="typo-body text-red-600 mt-3">{appFilterError}</p>
        )}

        {applied.appFilter && !appFilterLoading && appRelatedIdsByTab && allTabData.totalCount === 0 && !applied.keyword.trim() && (
          <p className="typo-body text-amber-700 mt-3">
            No infrastructure CIs are linked to the selected application.
          </p>
        )}

        <p className="typo-caption text-gray-500 mt-3">
          Filter by application, keywords, or both. CI Type switches the results tab.
        </p>
      </div>

      {/* Tabs + Results */}
      <div ref={narrowRef} className="detail-pane bg-white rounded-lg border border-gray-200">
        {/* Tabs */}
        <div className="border-b border-gray-200 px-6">
          <div className="flex gap-6 overflow-x-auto">
            {(['all', 'servers', 'switches', 'databases', 'network_links'] as Tab[]).filter(tab => {
              if (tab === 'all') return true;
              return !isAccessDenied(tabData[tab].access) && !isAccessDenied(pillAccess[tab as keyof PillCounts]);
            }).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                type="button"
                className={`py-3 whitespace-nowrap border-b-2 transition-colors typo-body ${activeTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
                {tabLabels[tab]}
                <span className={`ml-1.5 typo-badge px-1.5 py-0.5 rounded-full ${activeTab === tab ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {loading && tab === activeTab
                    ? '…'
                    : tabResultCount(tab).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>

        <CISearchSummaryBanner
          incidents={summary.incidents}
          changes={summary.changes}
          health={summary.health}
          access={summary.access}
          loading={summary.loading}
          matchingCiCount={totalCount}
          onChipClick={handleSummaryChipClick}
        />

        {/* Table toolbar */}
        <div className="px-6 pb-3 flex items-center justify-between gap-3">
          <p className="typo-page-subtitle">
            {totalCount.toLocaleString()} result{totalCount !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2">
            {activeTabHasColFilters && (
              <button
                type="button"
                onClick={clearActiveTabColFilters}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg typo-body text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <FilterX className="w-4 h-4" />
                Clear filters
              </button>
            )}
            <ExportButton
              columns={columns}
              disabled={totalCount === 0}
              truncated={exportTruncated}
              csvExportLimit={csvExportLimit}
              onFetchRows={handleExportRows}
            />
          </div>
        </div>

        {/* Results */}
        {narrow ? (
          <div className="px-6 pb-4 cards-grid-responsive">
            {loading ? (
              <div className="col-span-full flex items-center justify-center gap-2 py-12 text-gray-400 typo-body">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                Loading records…
              </div>
            ) : displayRows.length === 0 ? (
              <p className="col-span-full text-center text-gray-400 typo-body py-12">
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
                    kind: 'ci',
                    recordSysId: row.sysId,
                    ciName: row.values.name || row.sysId,
                    flagType: type as 'incident' | 'change',
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
                    <button type="button" className="flex items-center gap-2 typo-label text-gray-700 hover:text-gray-900">
                      {col.label}<ArrowUpDown className="w-4 h-4" />
                    </button>
                  </th>
                ))}
              </tr>
              {columns.length > 0 && (
                <tr className="border-t border-gray-200">
                  {columns.map(col => (
                    <td key={col.element} className="px-3 pb-2 pt-1">
                      <div className="relative flex items-center gap-1">
                        <input
                          type="text"
                          value={pendingColFilters[col.element] ?? ''}
                          placeholder={`Filter ${col.label.toLowerCase()}…`}
                          onChange={e => setColFilter(col.element, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              applyColFilter();
                            }
                          }}
                          className={`w-full min-w-0 px-2 py-1 typo-body border rounded bg-white placeholder-gray-400 focus:outline-none focus:ring-1 ${
                            isColFilterActive(col.element)
                              ? 'border-blue-400 bg-blue-50/50 focus:border-blue-500 focus:ring-blue-300'
                              : 'border-gray-300 focus:border-blue-400 focus:ring-blue-300'
                          }`}
                        />
                        {isColFilterDirty(col.element) && (
                          <button
                            type="button"
                            onClick={() => applyColFilter()}
                            title="Apply filter"
                            className="shrink-0 p-0.5 text-blue-600 hover:text-blue-800"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(pendingColFilters[col.element] || appliedColFilters[col.element]) && (
                          <button
                            type="button"
                            onClick={() => clearColFilter(col.element)}
                            title="Clear filter"
                            className="shrink-0 p-0.5 text-gray-400 hover:text-gray-600"
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
                  <td colSpan={Math.max(columns.length, 1)} className="px-6 py-12 text-center text-gray-400 typo-body">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                      Loading records…
                    </div>
                  </td>
                </tr>
              ) : displayRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)} className="px-6 py-12 text-center text-gray-400 typo-body">
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
            <span className="typo-body">Rows per page:</span>
            <select
              className="border border-gray-300 rounded px-2 py-1 typo-body"
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}
            >
              {PAGE_SIZE_OPTIONS.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-4">
            <span className="typo-body">
              {paginationTotal === 0 ? '0 of 0' : `${start}–${end} of ${paginationTotal.toLocaleString()}`}
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
      {panel && panel.kind === 'ci' && (
        <FlagDetailPanel
          title={panel.ciName}
          flagType={panel.flagType}
          recordSysId={panel.recordSysId}
          onClose={() => setPanel(null)}
        />
      )}
      {panel && panel.kind === 'summary' && (
        <FlagDetailPanel
          title={panel.title}
          subtitle={panel.subtitle}
          flagType={panel.flagType}
          encodedQueries={panel.encodedQueries}
          onClose={() => setPanel(null)}
        />
      )}
    </div>
  );
}

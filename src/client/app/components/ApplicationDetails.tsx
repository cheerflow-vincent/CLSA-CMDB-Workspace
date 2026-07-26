import { useState, useEffect, type ElementType } from 'react';
import {
  Search, Server, Database, DollarSign,
  AlertCircle, Calendar, ChevronLeft, ChevronRight, ChevronDown, Loader2,
} from 'lucide-react';
import RelationshipDiagram, { DIR_COLOR, SVC_STYLE } from './RelationshipDiagram';
import type { DiagramFilters } from './RelationshipDiagram';
import RelationshipTable from './RelationshipTable';
import EditRelationshipModal from './EditRelationshipModal';
import AppSearchHeader from './AppSearchHeader';
import { type AppItem } from '../data/appData';
import type { CIItem } from './CIDetailView';
import { type ViewField, str, loadViewFields } from '../utils/viewFields';
import {
  fetchRelatedCICount,
  fetchRelatedCIPage,
  RELATED_CI_PAGE_SIZE,
  SERVER_REL_CONFIG,
  DATABASE_REL_CONFIG,
  type RelatedCIConfig,
  type RelatedCIRow,
} from '../utils/relatedCIs';
import {
  fetchRelatedTaskCount,
  fetchRelatedTaskPage,
  INCIDENT_TASK_CONFIG,
  CHANGE_TASK_CONFIG,
  type RelatedTaskConfig,
  type RelatedTaskRow,
} from '../utils/relatedTasks';
import { queryTable } from '../../api/servicenow';

const OVERVIEW_VIEW = 'CLSA CMDB Workspace Overview';
const OVERVIEW_DEFAULT_LIMIT = 10;

// ── Badge helpers ─────────────────────────────────────────────────────────────
function EnvBadge({ env }: { env: string }) {
  const cls =
    env === 'Production'     ? 'bg-green-100 text-green-700' :
    env === 'DR'             ? 'bg-orange-100 text-orange-700' :
                               'bg-yellow-100 text-yellow-700';
  const short = env === 'Non-production' ? 'Non-prod' : env;
  return (
    <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>
      {short}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls =
    priority.startsWith('P1') || priority.includes('Critical') ? 'bg-red-100 text-red-700' :
    priority.startsWith('P2') || priority.includes('High')     ? 'bg-orange-100 text-orange-700' :
    priority.startsWith('P3') || priority.includes('Medium')   ? 'bg-yellow-100 text-yellow-700' :
                                                                 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {priority}
    </span>
  );
}

function StateBadge({ state }: { state: string }) {
  const cls =
    state === 'In Progress' ? 'bg-blue-100 text-blue-700' :
    state === 'Resolved'    ? 'bg-green-100 text-green-700' :
    state === 'New'         ? 'bg-violet-100 text-violet-700' :
    state === 'Approved'    ? 'bg-green-100 text-green-700' :
    state === 'Scheduled'   ? 'bg-blue-100 text-blue-700' :
    state === 'Pending'     ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {state}
    </span>
  );
}

function ChangeTypeBadge({ type }: { type: string }) {
  const cls =
    type === 'Emergency' ? 'bg-red-100 text-red-700' :
    type === 'Normal'    ? 'bg-blue-100 text-blue-700' :
                           'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {type}
    </span>
  );
}

function renderTaskCell(element: string, val: string) {
  if (val === '—') {
    return <span className="text-[11px] text-gray-400">—</span>;
  }
  if (element === 'number') {
    return (
      <span className="font-mono text-[11px] text-gray-700 truncate block max-w-full" title={val}>
        {val}
      </span>
    );
  }
  if (element === 'priority') return <PriorityBadge priority={val} />;
  if (element === 'state') return <StateBadge state={val} />;
  if (element === 'type') return <ChangeTypeBadge type={val} />;
  if (element === 'short_description') {
    return (
      <span className="text-[11px] text-gray-700 line-clamp-2" title={val}>
        {val}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-gray-600 truncate block max-w-[120px]" title={val}>
      {val}
    </span>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ApplicationDetailsProps {
  onBack: () => void;
  onSelectApp: (app: AppItem) => void;
  onViewCI?: (ci: CIItem) => void;
  selectedApp?: AppItem | null;
}

type ViewMode = 'map' | 'table';
type ExpandKey = 'servers' | 'databases' | 'incidents' | 'changes';

function formatClassLabel(cls: string): string {
  return cls.replace(/^cmdb_ci_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function buildCIItem(row: RelatedCIRow): CIItem {
  return {
    id: row.sysId,
    name: row.values.name || row.sysId,
    type: formatClassLabel(row.sysClass),
    class: row.sysClass,
    table: row.sysClass,
    environment: row.values.environment ?? '',
    location: row.values.location ?? '',
    owner: '',
    supportGroup: '',
    lastModified: '',
    hasIncident: false,
    hasChange: false,
  };
}

function isTaskConfig(
  config: RelatedCIConfig | RelatedTaskConfig,
): config is RelatedTaskConfig {
  return 'extraQuery' in config;
}

function RelatedCISection({
  config,
  appSysId,
  isOpen,
  onToggle,
  onViewCI,
  title,
  Icon,
  iconBg,
  iconColor,
  badgeBg,
  badgeText,
  badgeBorder,
  hoverRow,
  emptyMessage = 'No related records found.',
}: {
  config: RelatedCIConfig | RelatedTaskConfig;
  appSysId?: string;
  isOpen: boolean;
  onToggle: () => void;
  onViewCI?: (ci: CIItem) => void;
  title: string;
  Icon: ElementType;
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  hoverRow?: string;
  emptyMessage?: string;
}) {
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [columns, setColumns] = useState<ViewField[]>([]);
  const [rows, setRows] = useState<Array<RelatedCIRow | RelatedTaskRow>>([]);
  const [loading, setLoading] = useState(false);
  const taskMode = isTaskConfig(config);

  useEffect(() => {
    setPage(0);
    setRows([]);
    setColumns([]);
    if (!appSysId) {
      setTotalCount(0);
      return;
    }
    const loadCount = taskMode
      ? fetchRelatedTaskCount(appSysId, config)
      : fetchRelatedCICount(appSysId, config);
    loadCount.then(setTotalCount).catch(() => setTotalCount(0));
  }, [appSysId, config, taskMode]);

  useEffect(() => {
    if (!isOpen || !appSysId) return;
    setLoading(true);
    const loadPage = taskMode
      ? fetchRelatedTaskPage(appSysId, config, page)
      : fetchRelatedCIPage(appSysId, config, page);
    loadPage
      .then(({ rows: pageRows, columns: pageCols, totalCount: count }) => {
        setRows(pageRows);
        setColumns(pageCols);
        setTotalCount(count);
      })
      .catch(() => {
        setRows([]);
        setColumns(config.defaultColumns);
      })
      .finally(() => setLoading(false));
  }, [isOpen, appSysId, page, config, taskMode]);

  const pageSize = RELATED_CI_PAGE_SIZE;
  const start = totalCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalCount);
  const showPagination = totalCount > pageSize;

  function renderCell(
    row: RelatedCIRow | RelatedTaskRow,
    col: ViewField,
    colIdx: number,
  ) {
    const val = row.values[col.element] || '—';

    if (taskMode) {
      const taskConfig = config as RelatedTaskConfig;
      if (colIdx === 0 && val !== '—') {
        const href = `/${taskConfig.taskTable}.do?sys_id=${row.sysId}`;
        return (
          <td key={col.element} className="px-3 py-1.5 max-w-[150px]">
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[11px] text-blue-700 truncate block max-w-full hover:underline"
              title={val}
            >
              {val}
            </a>
          </td>
        );
      }
      return (
        <td key={col.element} className="px-2 py-1.5 first:pl-3 max-w-[180px]">
          {renderTaskCell(col.element, val)}
        </td>
      );
    }

    if (colIdx === 0) {
      const ciRow = row as RelatedCIRow;
      return (
        <td key={col.element} className="px-3 py-1.5 max-w-[150px]">
          {onViewCI ? (
            <button
              type="button"
              onClick={() => onViewCI(buildCIItem(ciRow))}
              className={`font-mono text-[11px] text-blue-700 truncate block max-w-full text-left hover:underline ${hoverRow ?? ''}`}
              title={val}
            >
              {val}
            </button>
          ) : (
            <span className="font-mono text-[11px] text-gray-700 truncate block">{val}</span>
          )}
        </td>
      );
    }
    if (col.element === 'environment' && val !== '—') {
      return (
        <td key={col.element} className="px-2 py-1.5">
          <EnvBadge env={val} />
        </td>
      );
    }
    return (
      <td key={col.element} className="px-2 py-1.5 text-[11px] text-gray-600 truncate max-w-[120px]" title={val}>
        {val}
      </td>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left">
        <div className={`p-1.5 ${iconBg} rounded flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <span className="flex-1 text-xs text-gray-600 font-medium">{title}</span>
        <span className={`text-xs font-semibold ${badgeBg} ${badgeText} border ${badgeBorder} px-2.5 py-0.5 rounded-full`}>
          {totalCount}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="border-t border-gray-100">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-400 gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : totalCount === 0 ? (
            <p className="px-3 py-6 text-xs text-gray-400 italic text-center">{emptyMessage}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {columns.map(col => (
                        <th key={col.element}
                          className="px-2 py-1.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide first:pl-3">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {rows.map((row, i) => (
                      <tr key={row.sysId} className={`transition-colors ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                        {columns.map((col, colIdx) => renderCell(row, col, colIdx))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {showPagination && (
                <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-[11px] text-gray-400">
                    Showing {start}–{end} of {totalCount}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setPage(p => p - 1)}
                      disabled={page === 0}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-600" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPage(p => p + 1)}
                      disabled={(page + 1) * pageSize >= totalCount}
                      className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Next page"
                    >
                      <ChevronRight className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ApplicationDetails({ onBack, onSelectApp, onViewCI, selectedApp }: ApplicationDetailsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [detailsPanelOpen, setDetailsPanelOpen] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');
  const [filters, setFilters] = useState<DiagramFilters>({
    upstream: true, downstream: true, bidirectional: true,
    platform: true, infrastructure: true, business: true,
  });
  const [expanded, setExpanded] = useState<Record<ExpandKey, boolean>>({
    servers: false, databases: false, incidents: false, changes: false,
  });

  // ── Overview panel: dynamic view fields ──────────────────────────────────
  const [overviewFields, setOverviewFields] = useState<ViewField[]>([]);
  const [overviewValues, setOverviewValues] = useState<Record<string, string>>({});
  const [overviewLoading, setOverviewLoading] = useState(false);

  useEffect(() => {
    const sysId = selectedApp?.sysId;
    const table  = selectedApp?.table ?? 'cmdb_ci_service';
    if (!sysId) return;

    setOverviewLoading(true);
    setOverviewFields([]);
    setOverviewValues({});

    loadViewFields(table, OVERVIEW_VIEW, OVERVIEW_DEFAULT_LIMIT)
      .then(async fields => {
        setOverviewFields(fields);
        // fetch the actual field values for this record
        const { result } = await queryTable<Record<string, unknown>>({
          table,
          query:  `sys_id=${sysId}`,
          fields: fields.map(f => f.element),
          displayValue: true,
          limit: 1,
        });
        const rec = result?.[0] ?? {};
        const vals: Record<string, string> = {};
        fields.forEach(f => { vals[f.element] = str(rec[f.element]); });
        setOverviewValues(vals);
      })
      .catch(() => {})
      .finally(() => setOverviewLoading(false));
  }, [selectedApp?.sysId, selectedApp?.table]);

  const toggleFilter = (key: keyof DiagramFilters) =>
    setFilters(f => ({ ...f, [key]: !f[key] }));

  const toggleExpand = (key: ExpandKey) =>
    setExpanded(e => ({ ...e, [key]: !e[key] }));

  return (
    <div className="h-full flex flex-col bg-gray-50">

      {/* ── Shared search header + breadcrumb ── */}
      <AppSearchHeader
        mode="detail"
        currentApp={selectedApp ?? undefined}
        onSelectApp={onSelectApp}
        onBackToHome={onBack}
      />

      {/* ── Main content: fills remaining viewport height ── */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── Left: diagram / table ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-white border-r border-gray-200">

          {/* Sticky toolbar */}
          <div className="flex-shrink-0 border-b border-gray-200 bg-white px-5 py-3">

            {/* Title + Search */}
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-gray-900">Upstream / Downstream Relationships</h3>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search Nodes"
                  value={nodeSearch}
                  onChange={e => setNodeSearch(e.target.value)}
                  className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-lg w-56 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                />
              </div>
            </div>

            {/* Filters + View Toggle */}
            <div className="flex items-center flex-wrap gap-2">

              {/* Direction filters */}
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Direction</span>

              <button onClick={() => toggleFilter('upstream')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                  filters.upstream ? 'bg-orange-50 border-orange-300 text-orange-800' : 'bg-white border-gray-200 text-gray-400'
                }`}>
                <svg width="18" height="8" viewBox="0 0 22 10">
                  <line x1="0" y1="5" x2="16" y2="5" stroke={filters.upstream ? DIR_COLOR.upstream : '#D1D5DB'} strokeWidth="2"/>
                  <polygon points="16,2 22,5 16,8" fill={filters.upstream ? DIR_COLOR.upstream : '#D1D5DB'}/>
                </svg>
                Upstream
              </button>

              <button onClick={() => toggleFilter('downstream')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                  filters.downstream ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-gray-200 text-gray-400'
                }`}>
                <svg width="18" height="8" viewBox="0 0 22 10">
                  <line x1="0" y1="5" x2="16" y2="5" stroke={filters.downstream ? DIR_COLOR.downstream : '#D1D5DB'} strokeWidth="2"/>
                  <polygon points="16,2 22,5 16,8" fill={filters.downstream ? DIR_COLOR.downstream : '#D1D5DB'}/>
                </svg>
                Downstream
              </button>

              <button onClick={() => toggleFilter('bidirectional')}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                  filters.bidirectional ? 'bg-violet-50 border-violet-300 text-violet-800' : 'bg-white border-gray-200 text-gray-400'
                }`}>
                <svg width="22" height="8" viewBox="0 0 26 10">
                  <polygon points="0,5 6,2 6,8" fill={filters.bidirectional ? DIR_COLOR.bidirectional : '#D1D5DB'}/>
                  <line x1="6" y1="5" x2="20" y2="5" stroke={filters.bidirectional ? DIR_COLOR.bidirectional : '#D1D5DB'} strokeWidth="2" strokeDasharray="4 2"/>
                  <polygon points="20,2 26,5 20,8" fill={filters.bidirectional ? DIR_COLOR.bidirectional : '#D1D5DB'}/>
                </svg>
                Bi-directional
              </button>

              <div className="h-5 w-px bg-gray-200 mx-1" />

              {/* Service type filters */}
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Services</span>

              {[
                { key: 'platform'       as const, label: 'Platform',       svc: SVC_STYLE.platform,       active: filters.platform,       activeCls: 'border-blue-300 text-blue-800'  },
                { key: 'infrastructure' as const, label: 'Infrastructure', svc: SVC_STYLE.infrastructure, active: filters.infrastructure, activeCls: 'border-slate-300 text-slate-700' },
                { key: 'business'       as const, label: 'Business',       svc: SVC_STYLE.business,       active: filters.business,       activeCls: 'border-green-300 text-green-800' },
              ].map(({ key, label, svc, active, activeCls }) => (
                <button key={key} onClick={() => toggleFilter(key)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                    active ? activeCls : 'bg-white border-gray-200 text-gray-400'
                  }`}
                  style={active ? { backgroundColor: svc.bg } : {}}>
                  <span className="inline-block w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: active ? svc.border : '#E5E7EB' }} />
                  {label}
                </button>
              ))}

              {/* View toggle — pushed to the right */}
              <div className="flex items-center gap-2 ml-auto">
                <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">View</span>
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setViewMode('map')}
                    className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-1 text-xs font-medium transition-colors ${
                      viewMode === 'map' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-1 text-xs font-medium transition-colors border-l border-gray-200 ${
                      viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Table
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ── Canvas / table — fills all remaining height ── */}
          {viewMode === 'map' ? (
            <div className="flex-1 min-h-0">
              <RelationshipDiagram filters={filters} nodeSearch={nodeSearch} onEditRelationship={() => setShowEditModal(true)} selectedApp={selectedApp} onSelectApp={onSelectApp} />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              <RelationshipTable selectedApp={selectedApp} nodeSearch={nodeSearch} filters={filters} onSelectApp={onSelectApp} />
            </div>
          )}
        </div>

        {/* ── Right: info panel — ~30% of viewport, min 320px, max 480px ── */}
        {detailsPanelOpen && (
          <div className="w-[42%] min-w-[400px] max-w-[600px] flex-shrink-0 border-l border-gray-200 bg-gray-50 overflow-y-auto">

                {/* Sticky header */}
                <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  <span className="flex-1 text-sm font-semibold text-gray-900 truncate">
                    {selectedApp?.name ?? '—'}
                  </span>
                  <button onClick={() => setDetailsPanelOpen(false)}
                    className="p-1 hover:bg-gray-100 rounded flex-shrink-0">
                    <ChevronRight className="w-4 h-4 text-gray-500" />
                  </button>
                </div>

                <div className="p-4 space-y-5">

                  {/* ── Overview ── */}
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Overview</p>
                    {overviewLoading ? (
                      <div className="flex items-center justify-center py-6 text-gray-400 gap-2 text-xs">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                      </div>
                    ) : overviewFields.length === 0 ? (
                      <p className="text-xs text-gray-400 italic px-1">No overview fields configured.</p>
                    ) : (
                      <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                        {overviewFields.map(({ element, label }) => (
                          <div key={element} className="flex items-start gap-3 px-3 py-2">
                            <span className="text-xs text-gray-400 shrink-0 w-32 truncate">{label}</span>
                            <span className="text-xs text-gray-800 break-words min-w-0">
                              {overviewValues[element] || '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* ── Infrastructure ── */}
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Infrastructure</p>
                    <div className="space-y-2">

                      <RelatedCISection
                        config={SERVER_REL_CONFIG}
                        appSysId={selectedApp?.sysId}
                        isOpen={expanded.servers}
                        onToggle={() => toggleExpand('servers')}
                        onViewCI={onViewCI}
                        title="Servers hosting the application"
                        Icon={Server}
                        iconBg="bg-blue-100"
                        iconColor="text-blue-600"
                        badgeBg="bg-blue-50"
                        badgeText="text-blue-700"
                        badgeBorder="border-blue-200"
                        hoverRow="cursor-pointer"
                      />

                      <RelatedCISection
                        config={DATABASE_REL_CONFIG}
                        appSysId={selectedApp?.sysId}
                        isOpen={expanded.databases}
                        onToggle={() => toggleExpand('databases')}
                        onViewCI={onViewCI}
                        title="Databases used by the application"
                        Icon={Database}
                        iconBg="bg-purple-100"
                        iconColor="text-purple-600"
                        badgeBg="bg-purple-50"
                        badgeText="text-purple-700"
                        badgeBorder="border-purple-200"
                        hoverRow="cursor-pointer"
                      />

                      {/* Total cost — static */}
                      <div className="bg-white rounded-lg border border-gray-200 px-3 py-2.5 flex items-center gap-3">
                        <div className="p-1.5 bg-emerald-100 rounded flex-shrink-0">
                          <DollarSign className="w-4 h-4 text-emerald-600" />
                        </div>
                        <span className="flex-1 text-xs text-gray-600 font-medium">Total Server Cost</span>
                        <span className="text-sm font-semibold text-emerald-700">$1,250,000</span>
                      </div>
                    </div>
                  </section>

                  {/* ── Active Flags ── */}
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Active Flags</p>
                    <div className="space-y-2">

                      <RelatedCISection
                        config={INCIDENT_TASK_CONFIG}
                        appSysId={selectedApp?.sysId}
                        isOpen={expanded.incidents}
                        onToggle={() => toggleExpand('incidents')}
                        title="Active Incidents"
                        Icon={AlertCircle}
                        iconBg="bg-red-100"
                        iconColor="text-red-600"
                        badgeBg="bg-red-50"
                        badgeText="text-red-700"
                        badgeBorder="border-red-200"
                        emptyMessage="No active incidents linked to this application."
                      />

                      <RelatedCISection
                        config={CHANGE_TASK_CONFIG}
                        appSysId={selectedApp?.sysId}
                        isOpen={expanded.changes}
                        onToggle={() => toggleExpand('changes')}
                        title="Change Requests"
                        Icon={Calendar}
                        iconBg="bg-amber-100"
                        iconColor="text-amber-600"
                        badgeBg="bg-amber-50"
                        badgeText="text-amber-700"
                        badgeBorder="border-amber-200"
                        emptyMessage="No approved change requests linked to this application."
                      />

                    </div>
                  </section>

                </div>
              </div>
            )}

            {/* Collapsed panel toggle strip */}
            {!detailsPanelOpen && (
              <button onClick={() => setDetailsPanelOpen(true)}
                className="flex-shrink-0 w-8 border-l border-gray-200 bg-white hover:bg-gray-50 transition-colors flex items-start justify-center pt-4">
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
            )}

      </div>

      {showEditModal && <EditRelationshipModal onClose={() => setShowEditModal(false)} />}
    </div>
  );
}

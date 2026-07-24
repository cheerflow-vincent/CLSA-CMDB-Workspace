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
import { queryTable } from '../../api/servicenow';

const OVERVIEW_VIEW = 'CLSA CMDB Workspace Overview';
const OVERVIEW_DEFAULT_LIMIT = 10;

// ── Panel mock data (incidents / changes only) ───────────────────────────────
const APP_INCIDENTS = [
  { number: 'INC0012345', priority: 'P2', state: 'In Progress', desc: 'CPU spike >95% sustained on zhkdp2616',  opened: '10 Apr 2026' },
  { number: 'INC0012201', priority: 'P3', state: 'Resolved',    desc: 'Disk usage warning on /var partition',    opened: '02 Apr 2026' },
  { number: 'INC0011988', priority: 'P3', state: 'In Progress', desc: 'Slow query degradation on orders table',  opened: '28 Mar 2026' },
];

const APP_CHANGES = [
  { number: 'CHG0008811', type: 'Standard',  state: 'Scheduled', desc: 'OS patching – KB5034441',       sched: '10 May 2026' },
  { number: 'CHG0008900', type: 'Emergency', state: 'Approved',  desc: 'Firmware upgrade to 17.9.4',    sched: '05 May 2026' },
  { number: 'CHG0009022', type: 'Normal',    state: 'Approved',  desc: 'Index rebuild on production DB', sched: '15 May 2026' },
  { number: 'CHG0009100', type: 'Standard',  state: 'Scheduled', desc: 'Bandwidth upgrade to 1 Gbps',   sched: '20 May 2026' },
  { number: 'CHG0009250', type: 'Normal',    state: 'Pending',   desc: 'Risk scoring engine update',     sched: '25 May 2026' },
];

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
    priority === 'P1' ? 'bg-red-100 text-red-700' :
    priority === 'P2' ? 'bg-orange-100 text-orange-700' :
    priority === 'P3' ? 'bg-yellow-100 text-yellow-700' :
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
}: {
  config: RelatedCIConfig;
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
  hoverRow: string;
}) {
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [columns, setColumns] = useState<ViewField[]>([]);
  const [rows, setRows] = useState<RelatedCIRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setPage(0);
    setRows([]);
    setColumns([]);
    if (!appSysId) {
      setTotalCount(0);
      return;
    }
    fetchRelatedCICount(appSysId, config)
      .then(setTotalCount)
      .catch(() => setTotalCount(0));
  }, [appSysId, config]);

  useEffect(() => {
    if (!isOpen || !appSysId) return;
    setLoading(true);
    fetchRelatedCIPage(appSysId, config, page)
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
  }, [isOpen, appSysId, page, config]);

  const pageSize = RELATED_CI_PAGE_SIZE;
  const start = totalCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalCount);
  const showPagination = totalCount > pageSize;

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
            <p className="px-3 py-6 text-xs text-gray-400 italic text-center">No related records found.</p>
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
                        {columns.map((col, colIdx) => {
                          const val = row.values[col.element] || '—';
                          if (colIdx === 0) {
                            return (
                              <td key={col.element} className="px-3 py-1.5 max-w-[150px]">
                                {onViewCI ? (
                                  <button
                                    type="button"
                                    onClick={() => onViewCI(buildCIItem(row))}
                                    className={`font-mono text-[11px] text-blue-700 truncate block max-w-full text-left hover:underline ${hoverRow}`}
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
                        })}
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
                    className={`clsa-view-toggle-btn${viewMode === 'map' ? ' clsa-view-toggle-btn--active' : ''}`}
                  >
                    Map
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`clsa-view-toggle-btn${viewMode === 'table' ? ' clsa-view-toggle-btn--active' : ''}`}
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
                          <div key={element} className="clsa-overview-row">
                            <span className="clsa-overview-label">{label}</span>
                            <span className="clsa-overview-value">
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

                      {/* Incidents expandable */}
                      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <button onClick={() => toggleExpand('incidents')}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left">
                          <div className="p-1.5 bg-red-100 rounded flex-shrink-0">
                            <AlertCircle className="w-4 h-4 text-red-600" />
                          </div>
                          <span className="flex-1 text-xs text-gray-600 font-medium">Active Incidents</span>
                          <span className="text-xs font-semibold bg-red-50 text-red-700 border border-red-200 px-2.5 py-0.5 rounded-full">
                            3
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${expanded.incidents ? 'rotate-180' : ''}`} />
                        </button>

                        {expanded.incidents && (
                          <div className="border-t border-gray-100 divide-y divide-gray-100">
                            {APP_INCIDENTS.map((inc, i) => (
                              <div key={i} className="px-3 py-2.5 hover:bg-red-50/30 transition-colors cursor-default">
                                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                  <span className="text-[11px] font-semibold text-blue-600">{inc.number}</span>
                                  <PriorityBadge priority={inc.priority} />
                                  <StateBadge state={inc.state} />
                                </div>
                                <p className="text-xs text-gray-700 leading-snug mb-1 line-clamp-2">{inc.desc}</p>
                                <p className="text-[10px] text-gray-400">Opened: {inc.opened}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Changes expandable */}
                      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                        <button onClick={() => toggleExpand('changes')}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left">
                          <div className="p-1.5 bg-amber-100 rounded flex-shrink-0">
                            <Calendar className="w-4 h-4 text-amber-600" />
                          </div>
                          <span className="flex-1 text-xs text-gray-600 font-medium">Change Requests</span>
                          <span className="text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full">
                            5
                          </span>
                          <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${expanded.changes ? 'rotate-180' : ''}`} />
                        </button>

                        {expanded.changes && (
                          <div className="border-t border-gray-100 divide-y divide-gray-100">
                            {APP_CHANGES.map((chg, i) => (
                              <div key={i} className="px-3 py-2.5 hover:bg-amber-50/30 transition-colors cursor-default">
                                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                                  <span className="text-[11px] font-semibold text-blue-600">{chg.number}</span>
                                  <ChangeTypeBadge type={chg.type} />
                                  <StateBadge state={chg.state} />
                                </div>
                                <p className="text-xs text-gray-700 leading-snug mb-1 line-clamp-2">{chg.desc}</p>
                                <p className="text-[10px] text-gray-400">Scheduled: {chg.sched}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

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

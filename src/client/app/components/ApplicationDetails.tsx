import { useState, useEffect, useCallback } from 'react';
import {
  Search, Server, Database, Network, Link,
  AlertCircle, Calendar, ChevronLeft, ChevronRight, Loader2,
} from 'lucide-react';
import RelationshipDiagram, { DIR_COLOR, SVC_STYLE, PENDING_EDGE_DASH } from './RelationshipDiagram';
import type { DiagramFilters } from './RelationshipDiagram';
import RelationshipTable from './RelationshipTable';
import InfrastructureDiagram, { type InfraDiagramFilters } from './InfrastructureDiagram';
import InfrastructureRelationshipTable from './InfrastructureRelationshipTable';
import EditRelationshipModal, { type RelationshipMutation } from './EditRelationshipModal';
import EditInfrastructureRelationshipModal from './EditInfrastructureRelationshipModal';
import RelationshipChangesList from './RelationshipChangesList';
import RecordEditDialog from './recordEdit/RecordEditDialog';
import AppSearchHeader from './AppSearchHeader';
import { type AppItem } from '../data/appData';
import type { CIItem } from './CIDetailView';
import { type ViewField, str, loadViewFields } from '../utils/viewFields';
import {
  SERVER_REL_CONFIG,
  DATABASE_REL_CONFIG,
  NETGEAR_REL_CONFIG,
  NETWORK_LINK_REL_CONFIG,
} from '../utils/relatedCIs';
import { INFRA_CI_STYLE, type InfraCIType } from '../utils/infraCiStyles';
import {
  INCIDENT_TASK_CONFIG,
  CHANGE_TASK_CONFIG,
} from '../utils/relatedTasks';
import RelatedListSection from './RelatedListSection';
import { queryTableWithAccess, fetchFieldAccess, type TableAccess } from '../../api/servicenow';
import { filterFieldsByReadableKeys, isAccessDenied, canEditRecord } from '../utils/acl';
import { pollChangeUntilState } from '../utils/pollRelationshipChange';

const OVERVIEW_VIEW = 'CLSA CMDB Workspace Overview';
const OVERVIEW_DEFAULT_LIMIT = 10;

async function loadOverviewPanel(
  sysId: string,
  table: string,
): Promise<{
  fields: ViewField[];
  values: Record<string, string>;
  access: TableAccess;
}> {
  const fields = await loadViewFields(table, OVERVIEW_VIEW, OVERVIEW_DEFAULT_LIMIT);
  const { result, access } = await queryTableWithAccess<Record<string, unknown>>({
    table,
    query: `sys_id=${sysId}`,
    fields: fields.map(f => f.element),
    displayValue: true,
    limit: 1,
  });
  if (access === 'denied') {
    return { fields: [], values: {}, access };
  }
  const rec = result?.[0] ?? {};
  const readableFields = filterFieldsByReadableKeys(fields, Object.fromEntries(
    fields.filter(f => f.element in rec).map(f => [f.element, str(rec[f.element])]),
  ));
  const vals: Record<string, string> = {};
  readableFields.forEach(f => { vals[f.element] = str(rec[f.element]); });
  return { fields: readableFields, values: vals, access };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ApplicationDetailsProps {
  onBack: () => void;
  onSelectApp: (app: AppItem) => void;
  onViewCI?: (ci: CIItem) => void;
  selectedApp?: AppItem | null;
  hierarchyMode?: boolean;
}

type ViewMode = 'map' | 'table';
type RelationshipTab = 'app' | 'infra';
type ExpandKey = 'servers' | 'databases' | 'netgear' | 'network_links' | 'incidents' | 'changes' | 'relChanges';

// ── Main component ────────────────────────────────────────────────────────────
export default function ApplicationDetails({ onBack, onSelectApp, onViewCI, selectedApp, hierarchyMode = true }: ApplicationDetailsProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [relationshipTab, setRelationshipTab] = useState<RelationshipTab>('app');
  const [detailsPanelOpen, setDetailsPanelOpen] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showInfraEditModal, setShowInfraEditModal] = useState(false);
  const [relationshipEditTarget, setRelationshipEditTarget] = useState<{ sysId: string; name: string } | null>(null);
  const [recordEditTarget, setRecordEditTarget] = useState<{ sysId: string; name: string; table: string } | null>(null);
  const [relRefreshKey, setRelRefreshKey] = useState(0);
  const [diagramRefreshKey, setDiagramRefreshKey] = useState(0);
  const [processingChangeIds, setProcessingChangeIds] = useState<string[]>([]);
  const [canWriteRecord, setCanWriteRecord] = useState(false);
  const [pageRefreshKey, setPageRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [nodeSearch, setNodeSearch] = useState('');
  const [filters, setFilters] = useState<DiagramFilters>({
    upstream: true, downstream: true, bidirectional: true,
    platform: true, infrastructure: true, business: true,
  });
  const [infraFilters, setInfraFilters] = useState<InfraDiagramFilters>({
    server: true, netgear: true, network_link: true, database: true,
  });
  const [expanded, setExpanded] = useState<Record<ExpandKey, boolean>>({
    servers: false, databases: false, netgear: false, network_links: false,
    incidents: false, changes: false, relChanges: false,
  });

  // ── Overview panel: dynamic view fields ──────────────────────────────────
  const [overviewFields, setOverviewFields] = useState<ViewField[]>([]);
  const [overviewValues, setOverviewValues] = useState<Record<string, string>>({});
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewAccess, setOverviewAccess] = useState<TableAccess>('ok');

  useEffect(() => {
    const sysId = selectedApp?.sysId;
    const table  = selectedApp?.table ?? 'cmdb_ci_service';
    if (!sysId) return;

    setOverviewLoading(true);
    setOverviewFields([]);
    setOverviewValues({});
    setCanWriteRecord(false);

    loadOverviewPanel(sysId, table)
      .then(({ fields, values, access }) => {
        setOverviewAccess(access);
        setOverviewFields(fields);
        setOverviewValues(values);
      })
      .catch(() => {})
      .finally(() => setOverviewLoading(false));

    fetchFieldAccess(table, sysId, ['name'])
      .then(access => setCanWriteRecord(canEditRecord(access)))
      .catch(() => setCanWriteRecord(false));
  }, [selectedApp?.sysId, selectedApp?.table, pageRefreshKey]);

  const refreshPage = useCallback(() => {
    setRefreshing(true);
    setPageRefreshKey(n => n + 1);
    setRelRefreshKey(n => n + 1);
    setDiagramRefreshKey(n => n + 1);
    window.setTimeout(() => setRefreshing(false), 600);
  }, []);

  const toggleFilter = (key: keyof DiagramFilters) =>
    setFilters(f => ({ ...f, [key]: !f[key] }));

  const toggleInfraFilter = (key: InfraCIType) =>
    setInfraFilters(f => ({ ...f, [key]: !f[key] }));

  const openEditRelationships = () => {
    if (!selectedApp?.sysId) return;
    setRelationshipEditTarget({ sysId: selectedApp.sysId, name: selectedApp.name });
    if (relationshipTab === 'infra') {
      setShowInfraEditModal(true);
    } else {
      setShowEditModal(true);
    }
  };

  const toggleExpand = (key: ExpandKey) =>
    setExpanded(e => ({ ...e, [key]: !e[key] }));

  const refreshRelationships = (refreshDiagram = true) => {
    setRelRefreshKey(n => n + 1);
    if (refreshDiagram) setDiagramRefreshKey(n => n + 1);
  };

  const handleRelationshipMutations = async (mutations: RelationshipMutation[]) => {
    const appSysId = selectedApp?.sysId;
    if (!appSysId || mutations.length === 0) return;

    setExpanded(prev => ({ ...prev, relChanges: true }));
    setProcessingChangeIds(mutations.map(m => m.changeSysId));

    let refreshDiagram = false;
    for (const mutation of mutations) {
      if (mutation.action === 'create') {
        await pollChangeUntilState(appSysId, mutation.changeSysId, 'completed');
        refreshDiagram = true;
      } else {
        await pollChangeUntilState(appSysId, mutation.changeSysId, 'pending_approval');
      }
    }

    setProcessingChangeIds([]);
    refreshRelationships(refreshDiagram);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">

      {/* ── Shared search header + breadcrumb ── */}
      <AppSearchHeader
        mode="detail"
        currentApp={selectedApp ?? undefined}
        onSelectApp={onSelectApp}
        onBackToHome={onBack}
        canEditRecord={canWriteRecord}
        onRefresh={refreshPage}
        refreshing={refreshing}
        onEditCi={() => {
          if (selectedApp?.sysId) {
            setRecordEditTarget({
              sysId: selectedApp.sysId,
              name: selectedApp.name,
              table: selectedApp.table ?? 'cmdb_ci_service',
            });
          }
        }}
        onEditRelationships={openEditRelationships}
      />

      {/* ── Main content: fills remaining viewport height ── */}
      <div className="flex-1 overflow-hidden flex">

        {/* ── Left: diagram / table ── */}
        <div className="flex-1 flex flex-col min-w-0 bg-white border-r border-gray-200">

          {/* Sticky toolbar */}
          <div className="flex-shrink-0 border-b border-gray-200 bg-white px-5 py-3">

            {/* Relationship tab + Search */}
            <div className="flex items-center justify-between mb-3 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setRelationshipTab('app')}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      relationshipTab === 'app' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    App Relationships
                  </button>
                  <button
                    type="button"
                    onClick={() => setRelationshipTab('infra')}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-gray-200 ${
                      relationshipTab === 'infra' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    Infrastructure
                  </button>
                </div>
                <h3 className="text-base font-semibold text-gray-900 truncate">
                  {relationshipTab === 'app'
                    ? 'Upstream / Downstream Relationships'
                    : 'Infrastructure Relationships'}
                </h3>
              </div>
              <div className="relative flex-shrink-0">
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

              {relationshipTab === 'app' ? (
                <>
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
                  <line x1="6" y1="5" x2="20" y2="5" stroke={filters.bidirectional ? DIR_COLOR.bidirectional : '#D1D5DB'} strokeWidth="2"/>
                  <polygon points="20,2 26,5 20,8" fill={filters.bidirectional ? DIR_COLOR.bidirectional : '#D1D5DB'}/>
                </svg>
                Bi-directional
              </button>

              {viewMode === 'map' && (
                <>
                  <div className="h-5 w-px bg-gray-200 mx-1" />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Legend</span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white text-xs text-gray-600">
                    <svg width="22" height="8" viewBox="0 0 26 10" aria-hidden>
                      <line
                        x1="0" y1="5" x2="26" y2="5"
                        stroke="#6B7280"
                        strokeWidth="2"
                        strokeDasharray={PENDING_EDGE_DASH}
                      />
                    </svg>
                    Pending approval
                  </span>
                </>
              )}

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

                </>
              ) : (
                <>
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest">CI Type</span>
                  {(Object.keys(INFRA_CI_STYLE) as InfraCIType[]).map(ciType => {
                    const style = INFRA_CI_STYLE[ciType];
                    const active = infraFilters[ciType];
                    return (
                      <button
                        key={ciType}
                        type="button"
                        onClick={() => toggleInfraFilter(ciType)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                          active ? 'text-gray-800' : 'bg-white border-gray-200 text-gray-400'
                        }`}
                        style={active ? { backgroundColor: style.bg, borderColor: style.border } : {}}
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-sm"
                          style={{ backgroundColor: active ? style.border : '#E5E7EB' }}
                        />
                        {style.label}
                      </button>
                    );
                  })}
                </>
              )}

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
              {relationshipTab === 'app' ? (
                <RelationshipDiagram
                  key={diagramRefreshKey}
                  filters={filters}
                  nodeSearch={nodeSearch}
                  selectedApp={selectedApp}
                  onSelectApp={onSelectApp}
                  pendingRefreshKey={relRefreshKey}
                  canEditCenterRecord={canWriteRecord}
                  onEditRelationships={app => {
                    setRelationshipEditTarget(app);
                    setShowEditModal(true);
                  }}
                  onEditCiDetails={app => setRecordEditTarget(app)}
                  onRelationshipMutations={handleRelationshipMutations}
                />
              ) : (
                <InfrastructureDiagram
                  key={`infra-${diagramRefreshKey}`}
                  filters={infraFilters}
                  nodeSearch={nodeSearch}
                  selectedApp={selectedApp}
                  onViewCI={onViewCI}
                  refreshKey={pageRefreshKey}
                  canEditCenterRecord={canWriteRecord}
                  onEditRelationships={app => {
                    setRelationshipEditTarget(app);
                    setShowInfraEditModal(true);
                  }}
                  onEditCiDetails={app => setRecordEditTarget(app)}
                />
              )}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-5">
              {relationshipTab === 'app' ? (
                <RelationshipTable
                  selectedApp={selectedApp}
                  nodeSearch={nodeSearch}
                  filters={filters}
                  onSelectApp={onSelectApp}
                  refreshKey={pageRefreshKey}
                />
              ) : (
                <InfrastructureRelationshipTable
                  recordSysId={selectedApp?.sysId}
                  refreshKey={pageRefreshKey}
                  onViewCI={onViewCI}
                />
              )}
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
                  {!isAccessDenied(overviewAccess) && (
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
                  )}

                  {/* ── Infrastructure ── */}
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Infrastructure</p>
                    <div className="space-y-2">

                      <RelatedListSection
                        config={SERVER_REL_CONFIG}
                        recordSysId={selectedApp?.sysId}
                        refreshKey={pageRefreshKey}
                        responsiveLayout={false}
                        showCIFlags
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

                      <RelatedListSection
                        config={DATABASE_REL_CONFIG}
                        recordSysId={selectedApp?.sysId}
                        refreshKey={pageRefreshKey}
                        responsiveLayout={false}
                        showCIFlags
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

                      <RelatedListSection
                        config={NETGEAR_REL_CONFIG}
                        recordSysId={selectedApp?.sysId}
                        refreshKey={pageRefreshKey}
                        responsiveLayout={false}
                        showCIFlags
                        isOpen={expanded.netgear}
                        onToggle={() => toggleExpand('netgear')}
                        onViewCI={onViewCI}
                        title="Network gear hosting the application"
                        Icon={Network}
                        iconBg="bg-teal-100"
                        iconColor="text-teal-600"
                        badgeBg="bg-teal-50"
                        badgeText="text-teal-700"
                        badgeBorder="border-teal-200"
                        hoverRow="cursor-pointer"
                      />

                      <RelatedListSection
                        config={NETWORK_LINK_REL_CONFIG}
                        recordSysId={selectedApp?.sysId}
                        refreshKey={pageRefreshKey}
                        responsiveLayout={false}
                        showCIFlags
                        isOpen={expanded.network_links}
                        onToggle={() => toggleExpand('network_links')}
                        onViewCI={onViewCI}
                        title="Network links connected to this application"
                        Icon={Link}
                        iconBg="bg-orange-100"
                        iconColor="text-orange-600"
                        badgeBg="bg-orange-50"
                        badgeText="text-orange-700"
                        badgeBorder="border-orange-200"
                        hoverRow="cursor-pointer"
                      />
                    </div>
                  </section>

                  {/* ── Relationship Changes ── */}
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Relationships</p>
                    <RelationshipChangesList
                      appSysId={selectedApp?.sysId}
                      appName={selectedApp?.name}
                      isOpen={expanded.relChanges}
                      onToggle={() => toggleExpand('relChanges')}
                      refreshKey={relRefreshKey}
                      processingChangeIds={processingChangeIds}
                      onChanged={opts => refreshRelationships(opts?.refreshDiagram ?? true)}
                    />
                  </section>

                  {/* ── Active Flags ── */}
                  <section>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Active Flags</p>
                    <div className="space-y-2">

                      <RelatedListSection
                        config={INCIDENT_TASK_CONFIG}
                        recordSysId={selectedApp?.sysId}
                        refreshKey={pageRefreshKey}
                        variant="compact"
                        responsiveLayout={false}
                        isOpen={expanded.incidents}
                        onToggle={() => toggleExpand('incidents')}
                        title="Active Incidents"
                        Icon={AlertCircle}
                        iconBg="bg-red-100"
                        iconColor="text-red-600"
                        badgeBg="bg-red-50"
                        badgeText="text-red-700"
                        badgeBorder="border-red-200"
                        recordContext="application"
                      />

                      <RelatedListSection
                        config={CHANGE_TASK_CONFIG}
                        recordSysId={selectedApp?.sysId}
                        refreshKey={pageRefreshKey}
                        variant="compact"
                        responsiveLayout={false}
                        isOpen={expanded.changes}
                        onToggle={() => toggleExpand('changes')}
                        title="Change Requests"
                        Icon={Calendar}
                        iconBg="bg-amber-100"
                        iconColor="text-amber-600"
                        badgeBg="bg-amber-50"
                        badgeText="text-amber-700"
                        badgeBorder="border-amber-200"
                        recordContext="application"
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

      {showEditModal && relationshipEditTarget && (
        <EditRelationshipModal
          selectedApp={relationshipEditTarget}
          hierarchyMode={hierarchyMode}
          onClose={() => {
            setShowEditModal(false);
            setRelationshipEditTarget(null);
          }}
          onSubmitted={handleRelationshipMutations}
        />
      )}
      {showInfraEditModal && relationshipEditTarget && (
        <EditInfrastructureRelationshipModal
          selectedApp={relationshipEditTarget}
          onClose={() => {
            setShowInfraEditModal(false);
            setRelationshipEditTarget(null);
          }}
          onSaved={() => {
            setPageRefreshKey(n => n + 1);
            setDiagramRefreshKey(n => n + 1);
          }}
        />
      )}
      {recordEditTarget && (
        <RecordEditDialog
          title="Edit Application"
          table={recordEditTarget.table}
          sysId={recordEditTarget.sysId}
          recordName={recordEditTarget.name}
          onClose={() => setRecordEditTarget(null)}
          onSaved={() => {
            if (recordEditTarget.sysId === selectedApp?.sysId) {
              setPageRefreshKey(n => n + 1);
            }
          }}
        />
      )}
    </div>
  );
}

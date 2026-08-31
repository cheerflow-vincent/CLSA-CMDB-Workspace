import { useState, useCallback, useEffect, useRef } from 'react';
import { Search, Layers } from 'lucide-react';
import { type AppItem } from '../data/appData';
import type { CIItem } from './CIDetailView';
import RelatedApplicationsPanel from './RelatedApplicationsPanel';
import InfrastructureDiagram, { type InfraDiagramFilters } from './InfrastructureDiagram';
import InfrastructureRelationshipTable from './InfrastructureRelationshipTable';
import { INFRA_CI_STYLE, type InfraCIType } from '../utils/infraCiStyles';
import { fetchInfraPeersForCi } from '../utils/relatedCIs';
import type { TableAccess } from '../../api/servicenow';
import { isAccessDenied } from '../utils/acl';

type ComponentTab = 'application' | 'infra';
type ViewMode = 'map' | 'table';

const DEFAULT_INFRA_FILTERS: InfraDiagramFilters = {
  server: true,
  netgear: true,
  network_link: true,
  database: true,
};

interface Props {
  readonly ci: CIItem;
  readonly hierarchyMode?: boolean;
  readonly onSelectApp?: (app: AppItem) => void;
  readonly onViewCI?: (ci: CIItem) => void;
  readonly refreshKey?: number;
  readonly canEditCenterRecord?: boolean;
  readonly onEditCiDetails?: (ci: { sysId: string; name: string; table: string }) => void;
  readonly onAppsAccessResolved?: (access: TableAccess) => void;
  readonly onInfraAccessResolved?: (access: TableAccess) => void;
}

export default function CiRelatedComponentsSection({
  ci,
  hierarchyMode = true,
  onSelectApp,
  onViewCI,
  refreshKey = 0,
  canEditCenterRecord = false,
  onEditCiDetails,
  onAppsAccessResolved,
  onInfraAccessResolved,
}: Props) {
  const [componentTab, setComponentTab] = useState<ComponentTab>('application');
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [infraFilters, setInfraFilters] = useState<InfraDiagramFilters>(DEFAULT_INFRA_FILTERS);
  const [nodeSearch, setNodeSearch] = useState('');

  const toggleInfraFilter = useCallback((key: InfraCIType) => {
    setInfraFilters(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onInfraAccessResolvedRef = useRef(onInfraAccessResolved);
  onInfraAccessResolvedRef.current = onInfraAccessResolved;

  useEffect(() => {
    if (!ci.id) {
      onInfraAccessResolvedRef.current?.('ok');
      return;
    }
    let cancelled = false;
    fetchInfraPeersForCi(ci.id)
      .then(({ access }) => {
        if (!cancelled) onInfraAccessResolvedRef.current?.(access);
      })
      .catch(() => {
        if (!cancelled) onInfraAccessResolvedRef.current?.('error');
      });
    return () => { cancelled = true; };
  }, [ci.id, refreshKey]);

  const handleEditCiDetails = onEditCiDetails ?? (() => {});

  return (
    <div>
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-gray-100 space-y-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden flex-shrink-0">
            <button
              type="button"
              onClick={() => setComponentTab('application')}
              className={`typo-tab ${
                componentTab === 'application' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Application
            </button>
            <button
              type="button"
              onClick={() => setComponentTab('infra')}
              className={`typo-tab border-l border-gray-200 ${
                componentTab === 'infra' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Infrastructure
            </button>
          </div>

          {componentTab === 'infra' && (
            <div className="relative flex-shrink-0">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search Nodes"
                value={nodeSearch}
                onChange={e => setNodeSearch(e.target.value)}
                className="pl-9 pr-4 py-1.5 border border-gray-300 rounded-lg w-56 typo-body focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
              />
            </div>
          )}
        </div>

        {componentTab === 'infra' && (
          <div className="flex items-center flex-wrap gap-2">
            <span className="typo-label">CI Type</span>
            {(Object.keys(INFRA_CI_STYLE) as InfraCIType[]).map(ciType => {
              const style = INFRA_CI_STYLE[ciType];
              const active = infraFilters[ciType];
              return (
                <button
                  key={ciType}
                  type="button"
                  onClick={() => toggleInfraFilter(ciType)}
                  className={`typo-chip ${
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

            <div className="flex items-center gap-2 ml-auto">
              <span className="typo-label">View</span>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewMode('map')}
                  className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-1 typo-tab ${
                    viewMode === 'map' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Map
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`inline-flex items-center justify-center min-w-[52px] px-3.5 py-1 typo-tab border-l border-gray-200 ${
                    viewMode === 'table' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  Table
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      {(() => {
        if (componentTab === 'application') {
          return (
            <RelatedApplicationsPanel
              ciSysId={ci.id}
              hierarchyMode={hierarchyMode}
              onSelectApp={onSelectApp}
              onAccessResolved={onAppsAccessResolved}
              refreshKey={refreshKey}
            />
          );
        }
        if (viewMode === 'map') {
          return (
            <div className="min-h-[400px] h-[420px]">
              <InfrastructureDiagram
                filters={infraFilters}
                nodeSearch={nodeSearch}
                centerCi={ci}
                onViewCI={onViewCI}
                canEditCenterRecord={canEditCenterRecord}
                refreshKey={refreshKey}
                onEditCiDetails={handleEditCiDetails}
              />
            </div>
          );
        }
        return (
          <div className="p-5">
            <InfrastructureRelationshipTable
              ciSysId={ci.id}
              refreshKey={refreshKey}
              onViewCI={onViewCI}
              nodeSearch={nodeSearch}
            />
          </div>
        );
      })()}
    </div>
  );
}

/** Returns false when both app and infra access are denied (hide entire section). */
export function shouldShowRelatedComponents(
  appsAccess: TableAccess,
  infraAccess: TableAccess,
): boolean {
  return !isAccessDenied(appsAccess) || !isAccessDenied(infraAccess);
}

export function RelatedComponentsSectionIcon() {
  return <Layers className="w-4 h-4 text-blue-500" />;
}

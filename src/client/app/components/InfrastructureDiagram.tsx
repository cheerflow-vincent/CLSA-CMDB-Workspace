/**
 * InfrastructureDiagram — app at top, four CI-type stacks below.
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react';
import {
  ReactFlow, ReactFlowProvider,
  useNodesState, useEdgesState, useReactFlow,
  Handle, Position, Controls, Background,
  type Node, type Edge, type NodeProps,
  MarkerType, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { MoreVertical, Eye, Edit2, ExternalLink, Loader2, Network } from 'lucide-react';
import { fetchFieldAccess } from '../../api/servicenow';
import { fetchAllInfraPeers, type InfraCIPeer } from '../utils/relatedCIs';
import { canEditRecord } from '../utils/acl';
import {
  INFRA_CI_STYLE,
  INFRA_COLUMN_ORDER,
  type InfraCIType,
} from '../utils/infraCiStyles';
import type { AppItem } from '../data/appData';
import type { CIItem } from './CIDetailView';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface InfraDiagramFilters {
  server: boolean;
  netgear: boolean;
  circuit: boolean;
  database: boolean;
}

interface Props {
  filters: InfraDiagramFilters;
  nodeSearch?: string;
  selectedApp?: AppItem | null;
  onViewCI?: (ci: CIItem) => void;
  canEditCenterRecord?: boolean;
  refreshKey?: number;
  onEditRelationships: (app: { sysId: string; name: string }) => void;
  onEditCiDetails: (ci: { sysId: string; name: string; table: string }) => void;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const CENTER_X = 500;
const TOP_Y = 70;
const STACK_START_Y = 200;
const ROW_GAP = 72;
const COLUMN_X: Record<InfraCIType, number> = {
  server: 180,
  netgear: 380,
  circuit: 620,
  database: 820,
};
const NW = 148;
const NH = 42;
const CW = 180;
const CH = 52;

const HANDLE_STYLE: React.CSSProperties = {
  width: 6, height: 6, background: 'transparent', border: 'none', opacity: 0,
};

type SearchHighlight = 'none' | 'match' | 'dim';

interface NodeData {
  label: string;
  ciType: InfraCIType | 'center';
  isCenter: boolean;
  sysClass: string;
  searchHighlight: SearchHighlight;
  onOpenMenu: (nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent) => void;
  [key: string]: unknown;
}

// ─── Edge builder ─────────────────────────────────────────────────────────────

function buildInfraEdge(
  id: string,
  source: string,
  target: string,
  ciType: InfraCIType,
  hidden: boolean,
): Edge {
  const color = INFRA_CI_STYLE[ciType].edge;
  return {
    id,
    source,
    target,
    hidden,
    type: 'default',
    style: { stroke: color, strokeWidth: 2, opacity: 0.88 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    data: { ciType },
  };
}

function buildDiagram(
  peers: InfraCIPeer[],
  selectedApp: AppItem | null | undefined,
  openMenu: NodeData['onOpenMenu'],
  filters: InfraDiagramFilters,
): { nodes: Node[]; edges: Edge[]; infoMap: Map<string, { name: string; sysClass: string; ciType: InfraCIType }> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const infoMap = new Map<string, { name: string; sysClass: string; ciType: InfraCIType }>();

  nodes.push({
    id: 'center',
    type: 'infraNode',
    position: { x: CENTER_X, y: TOP_Y },
    hidden: false,
    data: {
      label: selectedApp?.name ?? 'Selected Application',
      ciType: 'center',
      isCenter: true,
      sysClass: selectedApp?.table ?? 'cmdb_ci_service',
      searchHighlight: 'none',
      onOpenMenu: openMenu,
    } satisfies NodeData,
  });

  const byType = new Map<InfraCIType, InfraCIPeer[]>();
  for (const t of INFRA_COLUMN_ORDER) byType.set(t, []);
  for (const p of peers) {
    byType.get(p.ciType)?.push(p);
  }

  for (const ciType of INFRA_COLUMN_ORDER) {
    const list = byType.get(ciType) ?? [];
    list.sort((a, b) => a.name.localeCompare(b.name));
    const hidden = !filters[ciType];
    const x = COLUMN_X[ciType];

    list.forEach((peer, i) => {
      const y = STACK_START_Y + i * ROW_GAP;
      infoMap.set(peer.sysId, { name: peer.name, sysClass: peer.sysClass, ciType });

      nodes.push({
        id: peer.sysId,
        type: 'infraNode',
        position: { x, y },
        hidden,
        data: {
          label: peer.name || peer.sysId,
          ciType,
          isCenter: false,
          sysClass: peer.sysClass,
          searchHighlight: 'none',
          onOpenMenu: openMenu,
        } satisfies NodeData,
      });

      const edgeSource = peer.appRole === 'child' ? peer.sysId : 'center';
      const edgeTarget = peer.appRole === 'child' ? 'center' : peer.sysId;
      edges.push(buildInfraEdge(
        `e-${ciType}-${peer.sysId}`,
        edgeSource,
        edgeTarget,
        ciType,
        hidden,
      ));
    });
  }

  return { nodes, edges, infoMap };
}

// ─── Node component ───────────────────────────────────────────────────────────

const SEARCH_EXTRA: Record<SearchHighlight, React.CSSProperties> = {
  none: {},
  match: { boxShadow: '0 0 0 2.5px #3B82F6, 0 0 14px 4px rgba(59,130,246,0.40)', borderColor: '#3B82F6' },
  dim: { opacity: 0.22, filter: 'grayscale(40%)' },
};

const InfraNode = memo(({ id, data }: NodeProps) => {
  const d = data as NodeData;
  const isCenter = d.isCenter;
  const style = d.ciType === 'center' ? null : INFRA_CI_STYLE[d.ciType];
  const w = isCenter ? CW : NW;
  const h = isCenter ? CH : NH;
  const borderClr = isCenter ? '#374151' : style!.border;
  const searchSty = SEARCH_EXTRA[d.searchHighlight ?? 'none'];

  return (
    <div style={{
      width: w,
      minHeight: h,
      background: isCenter ? '#F3F4F6' : style!.bg,
      border: `1.5px solid ${borderClr}`,
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: isCenter ? '8px 10px' : '5px 4px 5px 8px',
      cursor: 'grab',
      userSelect: 'none',
      overflow: 'hidden',
      transition: 'opacity 0.2s, box-shadow 0.2s, filter 0.2s',
      ...searchSty,
    }}>
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />

      <span style={{
        flex: 1,
        fontSize: isCenter ? 12 : 11,
        fontWeight: isCenter ? 600 : 400,
        color: isCenter ? '#111827' : style!.text,
        fontFamily: 'system-ui,-apple-system,sans-serif',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        lineHeight: '1.35',
        textAlign: 'center',
        pointerEvents: 'none',
      }}>{d.label}</span>

      <button
        className="nodrag flex-shrink-0"
        style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', lineHeight: 0 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, isCenter, e); }}
        aria-label="Open menu"
      >
        <MoreVertical size={14} className="text-gray-400" />
      </button>
    </div>
  );
});

const NODE_TYPES = { infraNode: InfraNode };

function MI({ icon, label, onClick, cls = 'text-gray-700 hover:bg-gray-50' }: {
  icon: React.ReactNode; label: string; onClick: () => void; cls?: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${cls}`}>
      {icon}<span>{label}</span>
    </button>
  );
}

function ciItemFromPeer(peer: { sysId: string; name: string; sysClass: string }, ciType: InfraCIType): CIItem {
  const typeLabel = INFRA_CI_STYLE[ciType].label.replace(/s$/, '');
  return {
    id: peer.sysId,
    name: peer.name,
    type: typeLabel,
    class: peer.sysClass,
    table: peer.sysClass,
    environment: '',
    location: '',
    owner: '',
    supportGroup: '',
    lastModified: '',
    hasIncident: false,
    hasChange: false,
  };
}

// ─── Inner diagram ────────────────────────────────────────────────────────────

function InfrastructureDiagramInner({
  filters,
  nodeSearch = '',
  selectedApp,
  onViewCI,
  canEditCenterRecord = false,
  refreshKey = 0,
  onEditRelationships,
  onEditCiDetails,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [peerCount, setPeerCount] = useState(0);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string; label: string; isCenter: boolean } | null>(null);
  const [menuPermissions, setMenuPermissions] = useState<{ loading: boolean; canEdit: boolean } | null>(null);

  const infoMapRef = useRef(new Map<string, { name: string; sysClass: string; ciType: InfraCIType }>());
  const onViewCIRef = useRef(onViewCI);
  onViewCIRef.current = onViewCI;

  const { fitView } = useReactFlow();

  const closeMenu = useCallback(() => {
    setNodeMenu(null);
    setMenuPermissions(null);
  }, []);

  const openMenu = useCallback((nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent) => {
    setNodeMenu({ x: e.clientX, y: e.clientY, nodeId, label, isCenter });
    if (isCenter) {
      setMenuPermissions({ loading: false, canEdit: canEditCenterRecord });
      return;
    }
    const info = infoMapRef.current.get(nodeId);
    if (!info) {
      setMenuPermissions({ loading: false, canEdit: false });
      return;
    }
    setMenuPermissions({ loading: true, canEdit: false });
    fetchFieldAccess(info.sysClass, nodeId, ['name'])
      .then(access => setMenuPermissions({ loading: false, canEdit: canEditRecord(access) }))
      .catch(() => setMenuPermissions({ loading: false, canEdit: false }));
  }, [canEditCenterRecord]);

  useEffect(() => {
    const sysId = selectedApp?.sysId;
    if (!sysId) {
      setNodes([]);
      setEdges([]);
      setPeerCount(0);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchAllInfraPeers(sysId)
      .then(({ peers }) => {
        if (cancelled) return;
        setPeerCount(peers.length);
        const { nodes: n, edges: e, infoMap } = buildDiagram(peers, selectedApp, openMenu, filters);
        infoMapRef.current = infoMap;
        setNodes(n);
        setEdges(e);
        setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 80);
      })
      .catch(() => {
        if (!cancelled) {
          setNodes([]);
          setEdges([]);
          setPeerCount(0);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApp?.sysId, selectedApp?.name, refreshKey]);

  useEffect(() => {
    setNodes(prev => prev.map(node => {
      if (node.id === 'center') return node;
      const ciType = (node.data as NodeData).ciType as InfraCIType;
      const hidden = !filters[ciType];
      if (node.hidden === hidden) return node;
      return { ...node, hidden };
    }));
    setEdges(prev => prev.map(edge => {
      const ciType = (edge.data as { ciType?: InfraCIType })?.ciType;
      if (!ciType) return edge;
      const hidden = !filters[ciType];
      if (edge.hidden === hidden) return edge;
      return { ...edge, hidden };
    }));
  }, [filters, setNodes, setEdges]);

  useEffect(() => {
    const q = nodeSearch.trim().toLowerCase();
    setNodes(prev => prev.map(node => {
      if (node.id === 'center') return node;
      const label = ((node.data as NodeData).label as string).toLowerCase();
      const sh: SearchHighlight = q && label.includes(q) ? 'match' : q ? 'dim' : 'none';
      if ((node.data as NodeData).searchHighlight === sh) return node;
      return { ...node, data: { ...node.data, searchHighlight: sh } };
    }));
  }, [nodeSearch, setNodes]);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: 400 }} onClick={closeMenu}>

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="text-sm text-gray-500">Loading infrastructure…</span>
          </div>
        </div>
      )}

      {!loading && peerCount === 0 && selectedApp?.sysId && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="text-center text-gray-400 px-6">
            <p className="text-sm font-medium text-gray-500">No infrastructure relationships found</p>
            <p className="text-xs mt-1">Servers, network gear, circuits, and databases linked to this application will appear here.</p>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeOrigin={[0.5, 0.5]}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        onPaneClick={closeMenu}
        style={{ background: '#F8FAFC' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#E2E8F0" />
        <Controls showInteractive={false} className="rounded-lg" />
      </ReactFlow>

      {nodeMenu && (
        <div
          className="fixed z-[9999] w-60 bg-white rounded-xl shadow-2xl border border-gray-200 py-1 overflow-hidden"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-800 truncate">{nodeMenu.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {nodeMenu.isCenter ? 'Current Application' : 'Infrastructure CI'}
            </p>
          </div>

          <div className="py-1">
            {!nodeMenu.isCenter && onViewCIRef.current && (() => {
              const info = infoMapRef.current.get(nodeMenu.nodeId);
              if (!info) return null;
              return (
                <MI
                  icon={<Eye size={14} className="text-gray-400" />}
                  label="View CI Details"
                  onClick={() => {
                    onViewCIRef.current?.(ciItemFromPeer(
                      { sysId: nodeMenu.nodeId, name: info.name, sysClass: info.sysClass },
                      info.ciType,
                    ));
                    closeMenu();
                  }}
                />
              );
            })()}

            {(() => {
              const info = nodeMenu.isCenter
                ? { sysClass: selectedApp?.table ?? 'cmdb_ci_service' }
                : infoMapRef.current.get(nodeMenu.nodeId);
              const sysId = nodeMenu.isCenter ? selectedApp?.sysId : nodeMenu.nodeId;
              const table = nodeMenu.isCenter
                ? (selectedApp?.table ?? 'cmdb_ci_service')
                : (info?.sysClass ?? 'cmdb_ci');
              if (!sysId) return null;
              return (
                <a
                  href={`/${table}.do?sys_id=${sysId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMenu}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  <ExternalLink size={14} className="flex-shrink-0" />
                  Open in ServiceNow
                </a>
              );
            })()}

            {nodeMenu.isCenter && menuPermissions?.canEdit && selectedApp?.sysId && (
              <>
                <div className="border-t border-gray-100 my-1" />
                <MI
                  icon={<Network size={14} className="text-blue-500" />}
                  label="Edit Relationships"
                  onClick={() => {
                    onEditRelationships({ sysId: selectedApp.sysId!, name: selectedApp.name });
                    closeMenu();
                  }}
                />
                <MI
                  icon={<Edit2 size={14} className="text-gray-400" />}
                  label="Edit CI Details"
                  onClick={() => {
                    onEditCiDetails({
                      sysId: selectedApp.sysId!,
                      name: selectedApp.name,
                      table: selectedApp.table ?? 'cmdb_ci_service',
                    });
                    closeMenu();
                  }}
                />
              </>
            )}

            {!nodeMenu.isCenter && (
              <>
                {menuPermissions?.loading && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
                    <Loader2 size={12} className="animate-spin" /> Checking permissions…
                  </div>
                )}
                {!menuPermissions?.loading && menuPermissions?.canEdit && (() => {
                  const info = infoMapRef.current.get(nodeMenu.nodeId);
                  if (!info) return null;
                  return (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <MI
                        icon={<Edit2 size={14} className="text-gray-400" />}
                        label="Edit CI Details"
                        onClick={() => {
                          onEditCiDetails({
                            sysId: nodeMenu.nodeId,
                            name: nodeMenu.label,
                            table: info.sysClass,
                          });
                          closeMenu();
                        }}
                      />
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function InfrastructureDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <InfrastructureDiagramInner {...props} />
    </ReactFlowProvider>
  );
}

/**
 * InfrastructureDiagram — 2-tier hub layout:
 * Application/CI at top → CI-type group nodes → individual infra CIs (chained per column).
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow, ReactFlowProvider,
  useNodesState, useEdgesState, useReactFlow,
  Handle, Position, Controls, Background,
  type Node, type Edge, type NodeProps,
  MarkerType, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { MoreVertical, Eye, Edit2, ExternalLink, Loader2, Network, X } from 'lucide-react';
import { fetchFieldAccess } from '../../api/servicenow';
import { fetchAllInfraPeers, fetchInfraPeersForCi, resolveInfraCIType, type InfraCIPeer } from '../utils/relatedCIs';
import { canEditRecord } from '../utils/acl';
import { Z_INDEX } from '../utils/layering';
import { useDismissOnPointerDown } from '../utils/useDismissOnPointerDown';
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
  network_link: boolean;
  database: boolean;
}

interface Props {
  filters: InfraDiagramFilters;
  nodeSearch?: string;
  selectedApp?: AppItem | null;
  /** CI-centric mode: current CI at center, sibling infra as peers. */
  centerCi?: CIItem | null;
  /** Pre-fetched peers for CI mode (optional — avoids duplicate fetch). */
  ciPeers?: InfraCIPeer[];
  onViewCI?: (ci: CIItem) => void;
  canEditCenterRecord?: boolean;
  refreshKey?: number;
  onEditRelationships?: (app: { sysId: string; name: string }) => void;
  onEditCiDetails: (ci: { sysId: string; name: string; table: string }) => void;
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const TOP_Y = 70;
const GROUP_Y = 200;
const CI_START_Y = 288;
const ROW_GAP = 72;
const COL_WIDTH = 168;
const COL_GAP = 48;
const NW = 148;
const NH = 42;
const GW = 152;
const GH = 44;
const CW = 180;
const CH = 52;

function groupNodeId(ciType: InfraCIType): string {
  return `group-${ciType}`;
}

function isGroupNodeId(nodeId: string): boolean {
  return nodeId.startsWith('group-');
}

const HANDLE_STYLE: React.CSSProperties = {
  width: 6, height: 6, background: 'transparent', border: 'none', opacity: 0,
};

type SearchHighlight = 'none' | 'match' | 'dim';

interface NodeData {
  label: string;
  ciType: InfraCIType | 'center';
  isCenter: boolean;
  isGroup?: boolean;
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
    type: 'smoothstep',
    style: { stroke: color, strokeWidth: 2, opacity: 0.88 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    data: { ciType },
  };
}

function computeColumnLayout(
  byType: Map<InfraCIType, InfraCIPeer[]>,
): { columnX: Map<InfraCIType, number>; centerX: number } {
  const activeTypes = INFRA_COLUMN_ORDER.filter(t => (byType.get(t)?.length ?? 0) > 0);
  const typeCount = Math.max(activeTypes.length, 1);
  const contentWidth = typeCount * COL_WIDTH + Math.max(0, typeCount - 1) * COL_GAP;
  const xStart = 40;
  const centerX = xStart + contentWidth / 2 - CW / 2;
  const columnX = new Map<InfraCIType, number>();

  activeTypes.forEach((ciType, index) => {
    columnX.set(ciType, xStart + index * (COL_WIDTH + COL_GAP));
  });

  for (const ciType of INFRA_COLUMN_ORDER) {
    if (!columnX.has(ciType)) {
      columnX.set(ciType, xStart);
    }
  }

  return { columnX, centerX };
}

type InfoMap = Map<string, { name: string; sysClass: string; ciType: InfraCIType; relTypes?: string[] }>;

function buildHubColumns(
  nodes: Node[],
  edges: Edge[],
  infoMap: InfoMap,
  byType: Map<InfraCIType, InfraCIPeer[]>,
  columnX: Map<InfraCIType, number>,
  openMenu: NodeData['onOpenMenu'],
  filters: InfraDiagramFilters,
  relTypesFor?: (peer: InfraCIPeer) => string[],
): void {
  for (const ciType of INFRA_COLUMN_ORDER) {
    const list = [...(byType.get(ciType) ?? [])];
    if (!list.length) continue;
    list.sort((a, b) => a.name.localeCompare(b.name));

    const hidden = !filters[ciType];
    const x = columnX.get(ciType) ?? 40;
    const gid = groupNodeId(ciType);
    const style = INFRA_CI_STYLE[ciType];

    nodes.push({
      id: gid,
      type: 'infraNode',
      position: { x, y: GROUP_Y },
      hidden,
      data: {
        label: `${style.label} (${list.length})`,
        ciType,
        isCenter: false,
        isGroup: true,
        sysClass: '',
        searchHighlight: 'none',
        onOpenMenu: openMenu,
      } satisfies NodeData,
    });

    edges.push(buildInfraEdge(`e-center-${gid}`, 'center', gid, ciType, hidden));

    list.forEach((peer, i) => {
      const y = CI_START_Y + i * ROW_GAP;
      const relTypes = relTypesFor?.(peer);
      infoMap.set(peer.sysId, {
        name: peer.name,
        sysClass: peer.sysClass,
        ciType,
        ...(relTypes?.length ? { relTypes } : {}),
      });

      nodes.push({
        id: peer.sysId,
        type: 'infraNode',
        position: { x, y },
        hidden,
        data: {
          label: peer.name || peer.sysId,
          ciType,
          isCenter: false,
          isGroup: false,
          sysClass: peer.sysClass,
          searchHighlight: 'none',
          onOpenMenu: openMenu,
        } satisfies NodeData,
      });

      const source = i === 0 ? gid : list[i - 1].sysId;
      edges.push(buildInfraEdge(
        i === 0 ? `e-${gid}-${peer.sysId}` : `e-${list[i - 1].sysId}-${peer.sysId}`,
        source,
        peer.sysId,
        ciType,
        hidden,
      ));
    });
  }
}

function buildDiagram(
  peers: InfraCIPeer[],
  selectedApp: AppItem | null | undefined,
  openMenu: NodeData['onOpenMenu'],
  filters: InfraDiagramFilters,
): { nodes: Node[]; edges: Edge[]; infoMap: Map<string, { name: string; sysClass: string; ciType: InfraCIType; relTypes?: string[] }> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const infoMap = new Map<string, { name: string; sysClass: string; ciType: InfraCIType; relTypes?: string[] }>();

  const byType = new Map<InfraCIType, InfraCIPeer[]>();
  for (const t of INFRA_COLUMN_ORDER) byType.set(t, []);
  for (const p of peers) {
    byType.get(p.ciType)?.push(p);
  }

  const { columnX, centerX } = computeColumnLayout(byType);

  nodes.push({
    id: 'center',
    type: 'infraNode',
    position: { x: centerX, y: TOP_Y },
    hidden: false,
    data: {
      label: selectedApp?.name ?? 'Selected Application',
      ciType: 'center',
      isCenter: true,
      isGroup: false,
      sysClass: selectedApp?.table ?? 'cmdb_ci_service',
      searchHighlight: 'none',
      onOpenMenu: openMenu,
    } satisfies NodeData,
  });

  buildHubColumns(nodes, edges, infoMap, byType, columnX, openMenu, filters);

  return { nodes, edges, infoMap };
}

function buildCiDiagram(
  peers: InfraCIPeer[],
  centerCi: CIItem,
  openMenu: NodeData['onOpenMenu'],
  filters: InfraDiagramFilters,
): { nodes: Node[]; edges: Edge[]; infoMap: Map<string, { name: string; sysClass: string; ciType: InfraCIType; relTypes?: string[] }> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const infoMap = new Map<string, { name: string; sysClass: string; ciType: InfraCIType; relTypes?: string[] }>();

  const centerTable = centerCi.table || centerCi.class || 'cmdb_ci';
  const centerType = resolveInfraCIType(centerTable);

  const uniqueByType = new Map<InfraCIType, Map<string, InfraCIPeer>>();
  for (const t of INFRA_COLUMN_ORDER) uniqueByType.set(t, new Map());

  for (const p of peers) {
    if (p.sysId === centerCi.id) continue;
    const bucket = uniqueByType.get(p.ciType);
    if (bucket && !bucket.has(p.sysId)) bucket.set(p.sysId, p);
  }

  const byType = new Map<InfraCIType, InfraCIPeer[]>();
  for (const t of INFRA_COLUMN_ORDER) {
    byType.set(t, [...(uniqueByType.get(t)?.values() ?? [])]);
  }
  const { columnX, centerX } = computeColumnLayout(byType);

  nodes.push({
    id: 'center',
    type: 'infraNode',
    position: { x: centerX, y: TOP_Y },
    hidden: false,
    data: {
      label: centerCi.name || 'Selected CI',
      ciType: centerType ?? 'center',
      isCenter: true,
      isGroup: false,
      sysClass: centerTable,
      searchHighlight: 'none',
      onOpenMenu: openMenu,
    } satisfies NodeData,
  });

  buildHubColumns(
    nodes,
    edges,
    infoMap,
    byType,
    columnX,
    openMenu,
    filters,
    peer => peers
      .filter(p => p.sysId === peer.sysId && p.sysId !== centerCi.id)
      .map(p => p.relType)
      .filter(Boolean),
  );

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
  const isGroup = d.isGroup === true;
  const style = d.ciType === 'center' ? null : INFRA_CI_STYLE[d.ciType as InfraCIType];
  const w = isCenter ? CW : (isGroup ? GW : NW);
  const h = isCenter ? CH : (isGroup ? GH : NH);
  const borderClr = isCenter && !style ? '#374151' : (style?.border ?? '#374151');
  const searchSty = SEARCH_EXTRA[d.searchHighlight ?? 'none'];

  return (
    <div style={{
      width: w,
      minHeight: h,
      background: isCenter && !style ? '#F3F4F6' : (style?.bg ?? '#F3F4F6'),
      border: `1.5px solid ${borderClr}`,
      borderRadius: 8,
      display: 'flex',
      alignItems: 'center',
      gap: 2,
      padding: isCenter ? '8px 10px' : (isGroup ? '6px 8px' : '5px 4px 5px 8px'),
      cursor: isGroup ? 'default' : 'grab',
      userSelect: 'none',
      overflow: 'hidden',
      transition: 'opacity 0.2s, box-shadow 0.2s, filter 0.2s',
      ...searchSty,
    }}>
      <Handle type="target" position={Position.Top} style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} style={HANDLE_STYLE} />

      <span style={{
        flex: 1,
        fontSize: isCenter ? 12 : (isGroup ? 11 : 11),
        fontWeight: isCenter || isGroup ? 600 : 400,
        color: isCenter && !style ? '#111827' : (style?.text ?? '#111827'),
        fontFamily: 'var(--font-sans)',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        lineHeight: '1.35',
        textAlign: 'center',
        pointerEvents: 'none',
      }}>{d.label}</span>

      {!isGroup && (
        <button
          className="nodrag flex-shrink-0"
          style={{ background: 'none', border: 'none', padding: '2px', cursor: 'pointer', lineHeight: 0 }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, isCenter, e); }}
          aria-label="Open menu"
        >
          <MoreVertical size={14} className="text-gray-400" />
        </button>
      )}
    </div>
  );
});

const NODE_TYPES = { infraNode: InfraNode };

function MI({ icon, label, onClick, cls = 'text-gray-700 hover:bg-gray-50' }: {
  icon: React.ReactNode; label: string; onClick: () => void; cls?: string;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left typo-body transition-colors ${cls}`}>
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
  centerCi,
  ciPeers,
  onViewCI,
  canEditCenterRecord = false,
  refreshKey = 0,
  onEditRelationships,
  onEditCiDetails,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string; label: string; isCenter: boolean } | null>(null);
  const nodeMenuRef = useRef<HTMLDivElement>(null);
  const [menuPermissions, setMenuPermissions] = useState<{ loading: boolean; canEdit: boolean } | null>(null);

  const infoMapRef = useRef(new Map<string, { name: string; sysClass: string; ciType: InfraCIType; relTypes?: string[] }>());
  const onViewCIRef = useRef(onViewCI);
  onViewCIRef.current = onViewCI;

  const { fitView } = useReactFlow();

  const closeMenu = useCallback(() => {
    setNodeMenu(null);
    setMenuPermissions(null);
  }, []);

  useDismissOnPointerDown(!!nodeMenu, nodeMenuRef, closeMenu);

  const openMenu = useCallback((nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent) => {
    if (isGroupNodeId(nodeId)) return;
    e.stopPropagation();
    setNodeMenu({
      x: Math.min(e.clientX, window.innerWidth - 260),
      y: Math.min(e.clientY + 6, window.innerHeight - 360),
      nodeId, label, isCenter,
    });
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
    const ciMode = !!centerCi?.id;

    if (ciMode) {
      if (ciPeers) {
        const { nodes: n, edges: e, infoMap } = buildCiDiagram(ciPeers, centerCi!, openMenu, filters);
        infoMapRef.current = infoMap;
        setNodes(n);
        setEdges(e);
        setLoading(false);
        setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 80);
        return;
      }

      let cancelled = false;
      setLoading(true);

      fetchInfraPeersForCi(centerCi!.id)
        .then(({ peers }) => {
          if (cancelled) return;
          const { nodes: n, edges: e, infoMap } = buildCiDiagram(peers, centerCi!, openMenu, filters);
          infoMapRef.current = infoMap;
          setNodes(n);
          setEdges(e);
          setTimeout(() => fitView({ padding: 0.18, duration: 300 }), 80);
        })
        .catch(() => {
          if (!cancelled) {
            setNodes([]);
            setEdges([]);
          }
        })
        .finally(() => { if (!cancelled) setLoading(false); });

      return () => { cancelled = true; };
    }

    const sysId = selectedApp?.sysId;
    if (!sysId) {
      setNodes([]);
      setEdges([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetchAllInfraPeers(sysId)
      .then(({ peers }) => {
        if (cancelled) return;
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
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApp?.sysId, selectedApp?.name, centerCi?.id, centerCi?.name, ciPeers, refreshKey]);

  useEffect(() => {
    setNodes(prev => prev.map(node => {
      if (node.id === 'center') return node;
      const ciType = (node.data as NodeData).ciType as InfraCIType | 'center';
      if (ciType === 'center') return node;
      const hidden = !filters[ciType as InfraCIType];
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
      if (node.id === 'center') {
        if (!q) {
          if ((node.data as NodeData).searchHighlight === 'none') return node;
          return { ...node, data: { ...node.data, searchHighlight: 'none' as SearchHighlight } };
        }
        const centerLabel = ((node.data as NodeData).label as string).toLowerCase();
        const sh: SearchHighlight = centerLabel.includes(q) ? 'match' : 'dim';
        if ((node.data as NodeData).searchHighlight === sh) return node;
        return { ...node, data: { ...node.data, searchHighlight: sh } };
      }

      if (isGroupNodeId(node.id)) {
        const label = ((node.data as NodeData).label as string).toLowerCase();
        const sh: SearchHighlight = q && label.includes(q) ? 'match' : q ? 'dim' : 'none';
        if ((node.data as NodeData).searchHighlight === sh) return node;
        return { ...node, data: { ...node.data, searchHighlight: sh } };
      }

      const label = ((node.data as NodeData).label as string).toLowerCase();
      const info = infoMapRef.current.get(node.id);
      const relMatch = info?.relTypes?.some(rt => rt.toLowerCase().includes(q)) ?? false;
      const sh: SearchHighlight = q && (label.includes(q) || relMatch) ? 'match' : q ? 'dim' : 'none';
      if ((node.data as NodeData).searchHighlight === sh) return node;
      return { ...node, data: { ...node.data, searchHighlight: sh } };
    }));
  }, [nodeSearch, setNodes]);

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: 400 }}>

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="typo-page-subtitle">Loading infrastructure…</span>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeOrigin={[0, 0]}
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

      {nodeMenu && createPortal(
        <div
          ref={nodeMenuRef}
          className="clsa-portal fixed w-60 bg-white rounded-xl shadow-2xl border border-gray-200 py-1 overflow-hidden"
          style={{ left: nodeMenu.x, top: nodeMenu.y, zIndex: Z_INDEX.diagramNodeMenu }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-gray-100 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="typo-panel-title truncate">{nodeMenu.label}</p>
              <p className="typo-caption mt-0.5">
                {nodeMenu.isCenter
                  ? (centerCi?.id ? 'Current CI' : 'Current Application')
                  : 'Infrastructure CI'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeMenu}
              className="p-1 hover:bg-gray-100 rounded shrink-0"
              aria-label="Close menu"
            >
              <X size={16} className="text-gray-500" />
            </button>
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
                ? {
                    sysClass: centerCi?.id
                      ? (centerCi.table || centerCi.class || 'cmdb_ci')
                      : (selectedApp?.table ?? 'cmdb_ci_service'),
                  }
                : infoMapRef.current.get(nodeMenu.nodeId);
              const sysId = nodeMenu.isCenter
                ? (centerCi?.id ?? selectedApp?.sysId)
                : nodeMenu.nodeId;
              const table = nodeMenu.isCenter
                ? (centerCi?.id
                    ? (centerCi.table || centerCi.class || 'cmdb_ci')
                    : (selectedApp?.table ?? 'cmdb_ci_service'))
                : (info?.sysClass ?? 'cmdb_ci');
              if (!sysId) return null;
              return (
                <a
                  href={`/${table}.do?sys_id=${sysId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={closeMenu}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left typo-body text-indigo-600 hover:bg-indigo-50 transition-colors"
                >
                  <ExternalLink size={14} className="flex-shrink-0" />
                  Open in ServiceNow
                </a>
              );
            })()}

            {nodeMenu.isCenter && !centerCi?.id && menuPermissions?.canEdit && selectedApp?.sysId && onEditRelationships && (
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

            {nodeMenu.isCenter && centerCi?.id && menuPermissions?.canEdit && (
              <>
                <div className="border-t border-gray-100 my-1" />
                <MI
                  icon={<Edit2 size={14} className="text-gray-400" />}
                  label="Edit CI Details"
                  onClick={() => {
                    onEditCiDetails({
                      sysId: centerCi.id,
                      name: centerCi.name,
                      table: centerCi.table || centerCi.class || 'cmdb_ci',
                    });
                    closeMenu();
                  }}
                />
              </>
            )}

            {!nodeMenu.isCenter && (
              <>
                {menuPermissions?.loading && (
                  <div className="flex items-center gap-2 px-3 py-2 typo-caption">
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
        </div>,
        document.body,
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

/**
 * Top-down app-family hierarchy diagram for detail pages.
 * 3-level: Business App → cmdb_ci_service → instances.
 * 2-level: App Family → instances (same rel_ci logic as app home).
 */

import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ReactFlow, ReactFlowProvider, useReactFlow,
  useNodesState, useEdgesState,
  Handle, Position, Controls, Background,
  type Node, type Edge, type NodeProps,
  MarkerType, BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Loader2, Network, MoreVertical, Eye, ExternalLink, X } from 'lucide-react';
import type { AppItem } from '../data/appData';
import {
  loadAppFamilyHierarchyForRecord,
  type AppFamilyHierarchyData,
  type ThreeLevelMapping,
  type TwoLevelMapping,
  type LiveInstance,
} from '../utils/appHomeLoader';
import { Z_INDEX } from '../utils/layering';
import { useDismissOnPointerDown } from '../utils/useDismissOnPointerDown';

interface Props {
  selectedApp: AppItem;
  hierarchyMode?: boolean;
  serviceType?: 'service' | 'instance' | null;
  nodeSearch?: string;
  refreshKey?: number;
  onSelectApp?: (app: AppItem) => void;
}

type HierarchyLevel = 'business' | 'service' | 'instance';

const LEVEL_STYLE: Record<HierarchyLevel, { bg: string; border: string; text: string; edge: string }> = {
  business: { bg: '#EEF2FF', border: '#4F46E5', text: '#312E81', edge: '#6366F1' },
  service:  { bg: '#EFF6FF', border: '#3B82F6', text: '#1E40AF', edge: '#3B82F6' },
  instance: { bg: '#F0FDF4', border: '#16A34A', text: '#166534', edge: '#22C55E' },
};

const TOP_Y = 70;
const SERVICE_Y = 210;
const INSTANCE_Y = 360;
const TWO_LEVEL_INSTANCE_Y = 220;
const NW = 148;
const NH = 44;
const CW = 168;
const CH = 52;
const INST_GAP = 24;
const SVC_GAP = 56;

const HANDLE_STYLE: React.CSSProperties = {
  width: 6, height: 6, background: 'transparent', border: 'none', opacity: 0,
};

interface NodeInfo {
  sysId: string;
  name: string;
  table: string;
  level: HierarchyLevel;
}

interface NodeData {
  label: string;
  level: HierarchyLevel;
  isCenter: boolean;
  sysId: string;
  table: string;
  searchHighlight: 'none' | 'match' | 'dim';
  onOpenMenu: (nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent) => void;
  [key: string]: unknown;
}

function buildHierarchyEdge(
  id: string,
  source: string,
  target: string,
  level: HierarchyLevel,
): Edge {
  const color = LEVEL_STYLE[level].edge;
  return {
    id,
    source,
    target,
    type: 'smoothstep',
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
  };
}

function buildThreeLevelDiagram(
  data: AppFamilyHierarchyData,
  instances: Map<string, LiveInstance>,
  openMenu: NodeData['onOpenMenu'],
  searchTerm: string,
): { nodes: Node[]; edges: Edge[]; infoMap: Map<string, NodeInfo> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const infoMap = new Map<string, NodeInfo>();
  const mapping = data.threeLevel!;
  const appSysId = data.rootId;
  const appName = data.rootName;
  const q = searchTerm.trim().toLowerCase();

  const highlight = (label: string): NodeData['searchHighlight'] => {
    if (!q) return 'none';
    return label.toLowerCase().includes(q) ? 'match' : 'dim';
  };

  const svcIds = [...new Set(mapping.bAppToSvcs.get(appSysId) ?? [])];
  svcIds.sort((a, b) => {
    const na = mapping.svcMap.get(a)?.name ?? a;
    const nb = mapping.svcMap.get(b)?.name ?? b;
    return na.localeCompare(nb);
  });

  type Subtree = { svcId: string; svcName: string; instIds: string[]; width: number };
  const subtrees: Subtree[] = svcIds.map(svcId => {
    const svcMeta = mapping.svcMap.get(svcId);
    const svcName = svcMeta?.name ?? svcId;
    const instIds = mapping.svcToInstIds.get(svcId) ?? [];
    const count = Math.max(instIds.length, 1);
    const width = count * NW + Math.max(0, count - 1) * INST_GAP;
    return { svcId, svcName, instIds, width };
  });

  const contentWidth = subtrees.reduce((sum, t) => sum + t.width, 0)
    + Math.max(0, subtrees.length - 1) * SVC_GAP;
  const xStart = 40;
  const rootX = xStart + contentWidth / 2 - CW / 2;

  infoMap.set(appSysId, {
    sysId: appSysId,
    name: appName,
    table: 'cmdb_ci_business_app',
    level: 'business',
  });

  nodes.push({
    id: appSysId,
    type: 'hierarchyNode',
    position: { x: rootX, y: TOP_Y },
    data: {
      label: appName,
      level: 'business',
      isCenter: data.centerSysId === appSysId,
      sysId: appSysId,
      table: 'cmdb_ci_business_app',
      searchHighlight: highlight(appName),
      onOpenMenu: openMenu,
    } satisfies NodeData,
  });

  let xCursor = xStart;

  for (const subtree of subtrees) {
    const svcCenterX = xCursor + subtree.width / 2 - NW / 2;

    infoMap.set(subtree.svcId, {
      sysId: subtree.svcId,
      name: subtree.svcName,
      table: 'cmdb_ci_service',
      level: 'service',
    });

    nodes.push({
      id: subtree.svcId,
      type: 'hierarchyNode',
      position: { x: svcCenterX, y: SERVICE_Y },
      data: {
        label: subtree.svcName,
        level: 'service',
        isCenter: data.centerSysId === subtree.svcId,
        sysId: subtree.svcId,
        table: 'cmdb_ci_service',
        searchHighlight: highlight(subtree.svcName),
        onOpenMenu: openMenu,
      } satisfies NodeData,
    });

    edges.push(buildHierarchyEdge(
      `e-app-${subtree.svcId}`,
      appSysId,
      subtree.svcId,
      'business',
    ));

    const instCount = Math.max(subtree.instIds.length, 1);
    const instRowWidth = instCount * NW + Math.max(0, instCount - 1) * INST_GAP;
    let instX = xCursor + (subtree.width - instRowWidth) / 2;

    if (subtree.instIds.length === 0) {
      instX = svcCenterX;
    }

    subtree.instIds.forEach((instId, i) => {
      const inst = instances.get(instId);
      const instName = inst?.name ?? instId;
      const instTable = inst?.sys_class_name || 'cmdb_ci_service_auto';

      infoMap.set(instId, {
        sysId: instId,
        name: instName,
        table: instTable,
        level: 'instance',
      });

      nodes.push({
        id: instId,
        type: 'hierarchyNode',
        position: { x: instX + i * (NW + INST_GAP), y: INSTANCE_Y },
        data: {
          label: instName,
          level: 'instance',
          isCenter: data.centerSysId === instId,
          sysId: instId,
          table: instTable,
          searchHighlight: highlight(instName),
          onOpenMenu: openMenu,
        } satisfies NodeData,
      });

      edges.push(buildHierarchyEdge(
        `e-svc-${subtree.svcId}-${instId}`,
        subtree.svcId,
        instId,
        'service',
      ));
    });

    xCursor += subtree.width + SVC_GAP;
  }

  return { nodes, edges, infoMap };
}

function buildTwoLevelDiagram(
  data: AppFamilyHierarchyData,
  instances: Map<string, LiveInstance>,
  openMenu: NodeData['onOpenMenu'],
  searchTerm: string,
): { nodes: Node[]; edges: Edge[]; infoMap: Map<string, NodeInfo> } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const infoMap = new Map<string, NodeInfo>();
  const mapping = data.twoLevel!;
  const familyId = data.rootId;
  const familyName = data.rootName;
  const q = searchTerm.trim().toLowerCase();

  const highlight = (label: string): NodeData['searchHighlight'] => {
    if (!q) return 'none';
    return label.toLowerCase().includes(q) ? 'match' : 'dim';
  };

  const instIds = [...(mapping.appToInstances.get(familyId) ?? [])];
  instIds.sort((a, b) => {
    const na = instances.get(a)?.name ?? a;
    const nb = instances.get(b)?.name ?? b;
    return na.localeCompare(nb);
  });

  const instCount = Math.max(instIds.length, 1);
  const instRowWidth = instCount * NW + Math.max(0, instCount - 1) * INST_GAP;
  const contentWidth = Math.max(instRowWidth, CW);
  const xStart = 40;
  const rootX = xStart + contentWidth / 2 - CW / 2;

  infoMap.set(familyId, {
    sysId: familyId,
    name: familyName,
    table: 'cmdb_ci_service',
    level: 'business',
  });

  nodes.push({
    id: familyId,
    type: 'hierarchyNode',
    position: { x: rootX, y: TOP_Y },
    data: {
      label: familyName,
      level: 'business',
      isCenter: data.centerSysId === familyId,
      sysId: familyId,
      table: 'cmdb_ci_service',
      searchHighlight: highlight(familyName),
      onOpenMenu: openMenu,
    } satisfies NodeData,
  });

  const instX = xStart + (contentWidth - instRowWidth) / 2;

  instIds.forEach((instId, i) => {
    const inst = instances.get(instId);
    const instName = inst?.name ?? instId;
    const instTable = inst?.sys_class_name || 'cmdb_ci_service';

    infoMap.set(instId, {
      sysId: instId,
      name: instName,
      table: instTable,
      level: 'instance',
    });

    nodes.push({
      id: instId,
      type: 'hierarchyNode',
      position: { x: instX + i * (NW + INST_GAP), y: TWO_LEVEL_INSTANCE_Y },
      data: {
        label: instName,
        level: 'instance',
        isCenter: data.centerSysId === instId,
        sysId: instId,
        table: instTable,
        searchHighlight: highlight(instName),
        onOpenMenu: openMenu,
      } satisfies NodeData,
    });

    edges.push(buildHierarchyEdge(
      `e-family-${instId}`,
      familyId,
      instId,
      'business',
    ));
  });

  return { nodes, edges, infoMap };
}

function buildHierarchyDiagram(
  data: AppFamilyHierarchyData,
  instances: Map<string, LiveInstance>,
  openMenu: NodeData['onOpenMenu'],
  searchTerm: string,
): { nodes: Node[]; edges: Edge[]; infoMap: Map<string, NodeInfo> } {
  if (data.hierarchyMode && data.threeLevel) {
    return buildThreeLevelDiagram(data, instances, openMenu, searchTerm);
  }
  if (!data.hierarchyMode && data.twoLevel) {
    return buildTwoLevelDiagram(data, instances, openMenu, searchTerm);
  }
  return { nodes: [], edges: [], infoMap: new Map() };
}

function hasHierarchyContent(data: AppFamilyHierarchyData | null): boolean {
  if (!data) return false;
  if (data.hierarchyMode && data.threeLevel) {
    return (data.threeLevel.bAppToSvcs.get(data.rootId) ?? []).length > 0;
  }
  if (!data.hierarchyMode && data.twoLevel) {
    return (data.twoLevel.appToInstances.get(data.rootId)?.size ?? 0) > 0;
  }
  return false;
}

const SEARCH_EXTRA: Record<NodeData['searchHighlight'], React.CSSProperties> = {
  none: {},
  match: { boxShadow: '0 0 0 2.5px #3B82F6, 0 0 14px 4px rgba(59,130,246,0.35)', borderColor: '#3B82F6' },
  dim: { opacity: 0.25, filter: 'grayscale(40%)' },
};

const CENTER_EXTRA: React.CSSProperties = {
  boxShadow: '0 0 0 2.5px #F59E0B, 0 0 12px 3px rgba(245,158,11,0.3)',
};

const HierarchyNode = memo(({ id, data }: NodeProps) => {
  const d = data as NodeData;
  const style = LEVEL_STYLE[d.level];
  const w = d.isCenter ? CW : NW;
  const h = d.isCenter ? CH : NH;
  const searchSty = SEARCH_EXTRA[d.searchHighlight ?? 'none'];
  const centerSty = d.isCenter ? CENTER_EXTRA : {};
  const targetPos = d.level === 'business' ? undefined : Position.Top;
  const sourcePos = d.level === 'instance' ? undefined : Position.Bottom;

  return (
    <div
      style={{
        width: w,
        minHeight: h,
        background: style.bg,
        border: `1.5px solid ${style.border}`,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: d.isCenter ? '8px 10px' : '5px 4px 5px 8px',
        cursor: 'grab',
        userSelect: 'none',
        transition: 'opacity 0.2s, box-shadow 0.2s',
        ...searchSty,
        ...centerSty,
      }}
    >
      {targetPos && <Handle type="target" position={targetPos} style={HANDLE_STYLE} />}
      {sourcePos && <Handle type="source" position={sourcePos} style={HANDLE_STYLE} />}

      <span style={{
        flex: 1,
        fontSize: d.isCenter ? 12 : 11,
        fontWeight: d.isCenter ? 600 : 500,
        color: style.text,
        fontFamily: 'var(--font-sans)',
        whiteSpace: 'normal',
        wordBreak: 'break-word',
        lineHeight: 1.35,
        textAlign: 'center',
        pointerEvents: 'none',
      }}>
        {d.label}
      </span>

      <button
        type="button"
        className="nodrag flex-shrink-0"
        style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', lineHeight: 0 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, d.isCenter, e); }}
        aria-label="Open menu"
      >
        <MoreVertical size={14} className="text-gray-400" />
      </button>
    </div>
  );
});

const NODE_TYPES = { hierarchyNode: HierarchyNode };

function MI({ icon, label, onClick }: {
  icon: React.ReactNode; label: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left typo-body text-gray-700 hover:bg-gray-50 transition-colors">
      {icon}<span>{label}</span>
    </button>
  );
}

function levelLabel(level: HierarchyLevel, hierarchyMode: boolean): string {
  if (level === 'business') return hierarchyMode ? 'Business App' : 'App Family';
  if (level === 'service') return 'Application Service';
  return 'Service Instance';
}

function DiagramCanvas({
  selectedApp,
  hierarchyMode = true,
  serviceType = null,
  nodeSearch = '',
  refreshKey = 0,
  onSelectApp,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hierarchyData, setHierarchyData] = useState<AppFamilyHierarchyData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [nodeMenu, setNodeMenu] = useState<{
    x: number; y: number; nodeId: string; label: string; isCenter: boolean;
  } | null>(null);
  const nodeMenuRef = useRef<HTMLDivElement>(null);
  const infoMapRef = useRef(new Map<string, NodeInfo>());
  const onSelectAppRef = useRef(onSelectApp);
  onSelectAppRef.current = onSelectApp;

  const { fitView } = useReactFlow();

  const closeMenu = useCallback(() => setNodeMenu(null), []);

  useDismissOnPointerDown(!!nodeMenu, nodeMenuRef, closeMenu);

  const openMenu = useCallback((
    nodeId: string,
    label: string,
    isCenter: boolean,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setNodeMenu({
      x: Math.min(e.clientX, window.innerWidth - 260),
      y: Math.min(e.clientY + 6, window.innerHeight - 200),
      nodeId,
      label,
      isCenter,
    });
  }, []);

  useEffect(() => {
    const sysId = selectedApp.sysId;
    const table = selectedApp.table ?? 'cmdb_ci_service';
    if (!sysId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    loadAppFamilyHierarchyForRecord(sysId, table, selectedApp.name, hierarchyMode, serviceType)
      .then(result => {
        if (cancelled) return;
        setHierarchyData(result);
      })
      .catch(e => {
        if (!cancelled) {
          setError(String((e as Error)?.message ?? e));
          setHierarchyData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedApp.sysId, selectedApp.name, selectedApp.table, hierarchyMode, serviceType, refreshKey]);

  useEffect(() => {
    if (!hierarchyData) {
      setNodes([]);
      setEdges([]);
      return;
    }
    const { nodes: n, edges: e, infoMap } = buildHierarchyDiagram(
      hierarchyData,
      hierarchyData.instances,
      openMenu,
      nodeSearch,
    );
    infoMapRef.current = infoMap;
    setNodes(n);
    setEdges(e);
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 80);
  }, [hierarchyData, nodeSearch, openMenu, setNodes, setEdges, fitView]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 gap-2 typo-body">
        <Loader2 className="w-5 h-5 animate-spin" /> Loading app family…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-600 typo-body px-6 text-center">
        Could not load app family: {error}
      </div>
    );
  }

  if (!hierarchyData || !hasHierarchyContent(hierarchyData)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
        <Network className="w-10 h-10 opacity-30" />
        <p className="typo-body">No related app family members found.</p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: 400 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        nodeOrigin={[0, 0]}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.25}
        maxZoom={1.75}
        proOptions={{ hideAttribution: true }}
        onPaneClick={closeMenu}
        style={{ background: '#F8FAFC' }}
      >
        <Controls showInteractive={false} />
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#E5E7EB" />
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
                {levelLabel(
                  infoMapRef.current.get(nodeMenu.nodeId)?.level ?? 'instance',
                  hierarchyData.hierarchyMode,
                )}
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
            <MI
              icon={<Eye size={14} className="text-gray-400" />}
              label="View Details"
              onClick={() => {
                const info = infoMapRef.current.get(nodeMenu.nodeId);
                const table = info?.table ?? selectedApp.table ?? 'cmdb_ci_service';
                const name = info?.name ?? nodeMenu.label;
                onSelectAppRef.current?.({
                  id: nodeMenu.nodeId,
                  sysId: nodeMenu.nodeId,
                  table,
                  name,
                  app: name,
                  family: '',
                  dept: '',
                  env: 'Production',
                  status: 'Operational',
                  incidents: 0,
                  changes: 0,
                  criticality: 'Medium',
                  servers: 0,
                  lastUpdated: '',
                });
                closeMenu();
              }}
            />

            {(() => {
              const info = infoMapRef.current.get(nodeMenu.nodeId);
              const sysId = nodeMenu.nodeId;
              const table = info?.table ?? selectedApp.table ?? 'cmdb_ci_service';
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
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function AppHierarchyDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <div className="w-full h-full">
        <DiagramCanvas {...props} />
      </div>
    </ReactFlowProvider>
  );
}

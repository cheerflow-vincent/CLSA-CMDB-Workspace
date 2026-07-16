/**
 * RelationshipDiagram — powered by React Flow (@xyflow/react)
 *
 * Why React Flow for ServiceNow Now Experience (Yokohama+)?
 *  ✅ ServiceNow Yokohama supports React via Now Experience UI Framework
 *  ✅ Nodes are pure JSX → 3-dots menu is natural React, zero workarounds
 *  ✅ Drag-and-drop built-in (useNodesState handles everything)
 *  ✅ Beautiful smooth bezier curves by default
 *  ✅ MIT licence, actively maintained
 *  ✅ Level expansion = just toggling `hidden` on node/edge state (pure React)
 *
 * ServiceNow deployment path:
 *  - Build with `now-cli` or Vite, deploy as a custom Now Component
 *  - All state logic below works identically inside a Now Component wrapper
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
import {
  MoreHorizontal, Eye, Edit2, Plus, Trash2,
  ArrowUp, ArrowDown, ArrowLeftRight, Network,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// Public types  (ApplicationDetails imports these)
// ─────────────────────────────────────────────────────────────────────────────
type Direction   = 'upstream' | 'downstream' | 'bidirectional';
type ServiceType = 'platform' | 'infrastructure' | 'business';

export interface DiagramFilters {
  upstream: boolean; downstream: boolean; bidirectional: boolean;
  platform: boolean; infrastructure: boolean; business: boolean;
}

interface Props { filters: DiagramFilters; onEditRelationship: () => void; }

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens  (re-exported so ApplicationDetails filter pills stay in sync)
// ──────────────────────────────────────────────────────────────���──────────────
export const DIR_COLOR: Record<Direction, string> = {
  upstream: '#F97316', downstream: '#3B82F6', bidirectional: '#8B5CF6',
};
export const SVC_STYLE: Record<ServiceType, { bg: string; border: string; text: string }> = {
  platform:       { bg: '#EFF6FF', border: '#3B82F6', text: '#1E40AF' },
  infrastructure: { bg: '#F8FAFC', border: '#64748B', text: '#334155' },
  business:       { bg: '#F0FDF4', border: '#16A34A', text: '#166534' },
};
export const NW = 148;   // standard node width
export const NH = 42;    // standard node height
const CW = 172;          // center-node width
const CH = 52;           // center-node height

// ─────────────────────────────────────────────────────────────────────────────
// Base graph data
// ─────────────────────────────────────────────────────────────────────────────
interface NodeDef { id: string; label: string; x: number; y: number; serviceType: ServiceType | 'center'; }
interface LinkDef { id: string; source: string; target: string; direction: Direction; serviceType: ServiceType; }

const NODE_DATA: NodeDef[] = [
  { id: 'center', label: 'ES - Cobra HK (HUB)',    x: 510, y: 290, serviceType: 'center'         },
  { id: 'up1',    label: 'ES - Aperture - HK',     x: 145, y: 75,  serviceType: 'platform'       },
  { id: 'up2',    label: 'ES - Cobra - AU',         x: 295, y: 52,  serviceType: 'platform'       },
  { id: 'up3',    label: 'ES - Cobra - IN',         x: 130, y: 200, serviceType: 'infrastructure' },
  { id: 'up4',    label: 'ES - Cobra - MY',         x: 238, y: 322, serviceType: 'business'       },
  { id: 'up5',    label: 'ES - Cobra - JP',         x: 135, y: 430, serviceType: 'platform'       },
  { id: 'up6',    label: 'ES - Cobra - KE',         x: 292, y: 462, serviceType: 'infrastructure' },
  { id: 'dn1',    label: 'CORP - Resilient Report', x: 755, y: 58,  serviceType: 'business'       },
  { id: 'dn2',    label: 'DS - XBrain - Global',    x: 865, y: 158, serviceType: 'platform'       },
  { id: 'dn3',    label: 'EOD - Halo - Global',     x: 882, y: 285, serviceType: 'platform'       },
  { id: 'dn4',    label: 'DS - CRD - Global',       x: 852, y: 400, serviceType: 'infrastructure' },
  { id: 'dn5',    label: 'ES - Cobra - GB',          x: 758, y: 475, serviceType: 'platform'       },
  { id: 'bi1',    label: 'ES - Cobra - PH',         x: 330, y: 512, serviceType: 'platform'       },
  { id: 'bi2',    label: 'ES - Cobra - SG',         x: 510, y: 532, serviceType: 'business'       },
  { id: 'bi3',    label: 'ES - Cobra - TH',         x: 665, y: 512, serviceType: 'platform'       },
];

const LINK_DATA: LinkDef[] = [
  { id: 'lu1', source: 'up1',    target: 'center', direction: 'upstream',      serviceType: 'platform'       },
  { id: 'lu2', source: 'up2',    target: 'center', direction: 'upstream',      serviceType: 'platform'       },
  { id: 'lu3', source: 'up3',    target: 'center', direction: 'upstream',      serviceType: 'infrastructure' },
  { id: 'lu4', source: 'up4',    target: 'center', direction: 'upstream',      serviceType: 'business'       },
  { id: 'lu5', source: 'up5',    target: 'center', direction: 'upstream',      serviceType: 'platform'       },
  { id: 'lu6', source: 'up6',    target: 'center', direction: 'upstream',      serviceType: 'infrastructure' },
  { id: 'ld1', source: 'center', target: 'dn1',    direction: 'downstream',    serviceType: 'business'       },
  { id: 'ld2', source: 'center', target: 'dn2',    direction: 'downstream',    serviceType: 'platform'       },
  { id: 'ld3', source: 'center', target: 'dn3',    direction: 'downstream',    serviceType: 'platform'       },
  { id: 'ld4', source: 'center', target: 'dn4',    direction: 'downstream',    serviceType: 'infrastructure' },
  { id: 'ld5', source: 'center', target: 'dn5',    direction: 'downstream',    serviceType: 'platform'       },
  { id: 'lb1', source: 'center', target: 'bi1',    direction: 'bidirectional', serviceType: 'platform'       },
  { id: 'lb2', source: 'center', target: 'bi2',    direction: 'bidirectional', serviceType: 'business'       },
  { id: 'lb3', source: 'center', target: 'bi3',    direction: 'bidirectional', serviceType: 'platform'       },
];

// ─────────────────────────────────────────────────────────────────────────────
// Multi-level downstream extension data
//   Example chain: Cobra HK → XBrain → Salesforce → ServiceNow ITSM
// ─────────────────────────────────────────────────────────────────────────────
interface LevelNode extends NodeDef { parentId: string; level: number; }
interface LevelLink extends LinkDef {}

const LEVEL_NODES: LevelNode[] = [
  // dn2 (XBrain Global) — max 2 levels
  { id: 'dn2_l1_1', label: 'Salesforce CRM',    x: 1055, y: 128, serviceType: 'business',       parentId: 'dn2',       level: 1 },
  { id: 'dn2_l1_2', label: 'Bloomberg Feed',    x: 1055, y: 196, serviceType: 'infrastructure', parentId: 'dn2',       level: 1 },
  { id: 'dn2_l2_1', label: 'ServiceNow ITSM',   x: 1218, y: 112, serviceType: 'platform',       parentId: 'dn2_l1_1', level: 2 },
  { id: 'dn2_l2_2', label: 'Jira Cloud',        x: 1218, y: 178, serviceType: 'platform',       parentId: 'dn2_l1_1', level: 2 },
  // dn3 (Halo Global) — max 2 levels
  { id: 'dn3_l1_1', label: 'Reuters Data',      x: 1055, y: 270, serviceType: 'infrastructure', parentId: 'dn3',       level: 1 },
  { id: 'dn3_l1_2', label: 'MSCI Analytics',    x: 1055, y: 336, serviceType: 'business',       parentId: 'dn3',       level: 1 },
  { id: 'dn3_l2_1', label: 'Refinitiv Eikon',   x: 1218, y: 258, serviceType: 'platform',       parentId: 'dn3_l1_1', level: 2 },
  // dn1, dn4, dn5, bi2 — 1 level each
  { id: 'dn1_l1_1', label: 'SharePoint Online', x: 1055, y: 52,  serviceType: 'platform',       parentId: 'dn1',       level: 1 },
  { id: 'dn4_l1_1', label: 'FIX Protocol Hub',  x: 1055, y: 396, serviceType: 'infrastructure', parentId: 'dn4',       level: 1 },
  { id: 'dn5_l1_1', label: 'EMEA Settlement',   x: 1055, y: 462, serviceType: 'business',       parentId: 'dn5',       level: 1 },
  { id: 'bi2_l1_1', label: 'SGX Connect',       x: 608,  y: 572, serviceType: 'infrastructure', parentId: 'bi2',       level: 1 },
];

const LEVEL_LINKS: LevelLink[] = [
  { id: 'dn2_l1_1_lk', source: 'dn2',       target: 'dn2_l1_1', direction: 'downstream',    serviceType: 'business'       },
  { id: 'dn2_l1_2_lk', source: 'dn2',       target: 'dn2_l1_2', direction: 'downstream',    serviceType: 'infrastructure' },
  { id: 'dn2_l2_1_lk', source: 'dn2_l1_1', target: 'dn2_l2_1', direction: 'downstream',    serviceType: 'platform'       },
  { id: 'dn2_l2_2_lk', source: 'dn2_l1_1', target: 'dn2_l2_2', direction: 'downstream',    serviceType: 'platform'       },
  { id: 'dn3_l1_1_lk', source: 'dn3',       target: 'dn3_l1_1', direction: 'downstream',    serviceType: 'infrastructure' },
  { id: 'dn3_l1_2_lk', source: 'dn3',       target: 'dn3_l1_2', direction: 'downstream',    serviceType: 'business'       },
  { id: 'dn3_l2_1_lk', source: 'dn3_l1_1', target: 'dn3_l2_1', direction: 'downstream',    serviceType: 'platform'       },
  { id: 'dn1_l1_1_lk', source: 'dn1',       target: 'dn1_l1_1', direction: 'downstream',    serviceType: 'platform'       },
  { id: 'dn4_l1_1_lk', source: 'dn4',       target: 'dn4_l1_1', direction: 'downstream',    serviceType: 'infrastructure' },
  { id: 'dn5_l1_1_lk', source: 'dn5',       target: 'dn5_l1_1', direction: 'downstream',    serviceType: 'business'       },
  { id: 'bi2_l1_1_lk', source: 'bi2',       target: 'bi2_l1_1', direction: 'bidirectional', serviceType: 'infrastructure' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Level helpers
// ─────────────────────────────────────────────────────────────────────────────
function getMaxLevels(nodeId: string): number {
  const l1 = LEVEL_NODES.filter(n => n.parentId === nodeId && n.level === 1);
  if (!l1.length) return 0;
  return l1.some(p => LEVEL_NODES.some(n => n.parentId === p.id && n.level === 2)) ? 2 : 1;
}

function levelNodeIds(rootId: string, depth: number): Set<string> {
  const s = new Set<string>();
  if (depth < 1) return s;
  const l1 = LEVEL_NODES.filter(n => n.parentId === rootId && n.level === 1);
  l1.forEach(n => s.add(n.id));
  if (depth >= 2)
    l1.forEach(p => LEVEL_NODES.filter(n => n.parentId === p.id).forEach(n => s.add(n.id)));
  return s;
}

function levelLinkIds(rootId: string, depth: number): Set<string> {
  const nodeSet = new Set([rootId, ...levelNodeIds(rootId, depth)]);
  return new Set(LEVEL_LINKS.filter(l => nodeSet.has(l.source) && nodeSet.has(l.target)).map(l => l.id));
}

// ─────────────────────────────────────────────────────────────────────────────
// Edge builder — produces a React Flow edge definition
// ─────────────────────────────────────────────────────────────────────────────
function buildEdge(l: LinkDef | LevelLink, hidden: boolean): Edge {
  const color = DIR_COLOR[l.direction];
  const isBi  = l.direction === 'bidirectional';
  return {
    id:     l.id,
    source: l.source,
    target: l.target,
    hidden,
    type:   'default',           // React Flow's default smooth bezier curve
    style:  {
      stroke: color, strokeWidth: 2, opacity: 0.88,
      ...(isBi ? { strokeDasharray: '7 4' } : {}),
    },
    markerEnd:   { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    ...(isBi ? { markerStart: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 } } : {}),
    data:   { direction: l.direction, serviceType: l.serviceType },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Initial state builders  (called ONCE on mount)
// ─────────────────────────────────────────────────────��───────────────────────
function buildInitialNodes(openMenu: NodeData['onOpenMenu']): Node[] {
  return [
    // Base nodes
    ...NODE_DATA.map(n => ({
      id:       n.id,
      type:     n.serviceType === 'center' ? 'centerNode' : 'appNode',
      position: { x: n.x, y: n.y },
      hidden:   false,
      data: {
        label:       n.label,
        serviceType: n.serviceType,
        isCenter:    n.serviceType === 'center',
        maxLevels:   n.serviceType === 'center' ? 0 : getMaxLevels(n.id),
        curLevel:    0,
        onOpenMenu:  openMenu,
      } satisfies NodeData,
    })),
    // Level nodes — all hidden initially
    ...LEVEL_NODES.map(n => ({
      id:       n.id,
      type:     'appNode',
      position: { x: n.x, y: n.y },
      hidden:   true,
      data: {
        label:       n.label,
        serviceType: n.serviceType,
        isCenter:    false,
        maxLevels:   0,
        curLevel:    0,
        onOpenMenu:  openMenu,
      } satisfies NodeData,
    })),
  ];
}

function buildInitialEdges(): Edge[] {
  return [
    ...LINK_DATA.map(l => buildEdge(l, false)),
    ...LEVEL_LINKS.map(l => buildEdge(l, true)),  // all hidden initially
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom node data shape
// ─────────────────────────────────────────────────────────────────────────────
interface NodeData {
  label:      string;
  serviceType: ServiceType | 'center';
  isCenter:   boolean;
  maxLevels:  number;
  curLevel:   number;
  onOpenMenu: (nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent) => void;
  [key: string]: unknown;   // React Flow requires this for generic Node<NodeData>
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom node: standard application node
// — Pure JSX, no canvas overlays, no hacks.
//   The ⋮ button and level badge are real React elements inside the node.
// ─────────────────────────────────────────────────────────────────────────────
const AppNode = memo(({ id, data }: NodeProps) => {
  const d = data as NodeData;
  const svc = d.serviceType === 'center' ? null : SVC_STYLE[d.serviceType as ServiceType];

  return (
    <div
      style={{
        width:        NW,
        height:       NH,
        background:   svc?.bg  ?? '#F3F4F6',
        border:       `1.5px solid ${svc?.border ?? '#9CA3AF'}`,
        borderRadius: 8,
        position:     'relative',
        display:      'flex',
        alignItems:   'center',
        justifyContent: 'center',
        cursor:       'grab',
        userSelect:   'none',
      }}
    >
      {/* React Flow connection handles — invisible, just used for edge routing */}
      <Handle type="target" position={Position.Left}  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />

      {/* Node label */}
      <span style={{
        fontSize: 11, color: svc?.text ?? '#374151',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        maxWidth: NW - 24, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {d.label}
      </span>

      {/* ⋮ Action button — naturally part of the node JSX */}
      <button
        className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-30 hover:opacity-100 hover:bg-black/10 text-gray-500 transition-opacity"
        style={{ fontSize: 0 }}
        onPointerDown={e => e.stopPropagation()} // don't start drag when clicking ⋮
        onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, false, e); }}
        title="Actions"
      >
        <MoreHorizontal size={13} />
      </button>

      {/* Level badge — shows expandable depth or current expansion */}
      {d.maxLevels > 0 && (
        <button
          className="absolute bottom-0.5 left-1 leading-none"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, false, e); }}
          title={d.curLevel > 0 ? `${d.curLevel} level(s) expanded` : `${d.maxLevels} level(s) available`}
        >
          <span
            className={`inline-flex items-center gap-px rounded-full px-1.5
              ${d.curLevel > 0
                ? 'bg-blue-600 text-white ring-1 ring-blue-400'
                : 'bg-white/90 text-gray-500 border border-gray-300'}`}
            style={{ fontSize: 8.5, fontWeight: 700, lineHeight: '15px' }}
          >
            {d.curLevel > 0 ? `L${d.curLevel}` : `+${d.maxLevels}`}
          </span>
        </button>
      )}
    </div>
  );
});
AppNode.displayName = 'AppNode';

// ─────────────────────────────────────────────────────────────────────────────
// Custom node: center / hub node
// ─────────────────────────────────────────────────────────────────────────────
const CenterNode = memo(({ id, data }: NodeProps) => {
  const d = data as NodeData;
  return (
    <div
      style={{
        width: CW, height: CH,
        background: '#1D4ED8', border: '2px solid #1E40AF',
        borderRadius: 10, position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'grab', userSelect: 'none',
        boxShadow: '0 2px 12px rgba(29,78,216,0.35)',
      }}
    >
      <Handle type="target" position={Position.Left}  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <span style={{
        fontSize: 12, fontWeight: 600, color: '#fff',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        maxWidth: CW - 28, overflow: 'hidden',
        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {d.label}
      </span>
      <button
        className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-40 hover:opacity-100 hover:bg-white/20 text-white transition-opacity"
        style={{ fontSize: 0 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, true, e); }}
        title="Hub actions"
      >
        <MoreHorizontal size={13} />
      </button>
    </div>
  );
});
CenterNode.displayName = 'CenterNode';

const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0, width: 6, height: 6,
  minWidth: 0, minHeight: 0,
  background: 'transparent', border: 'none',
  pointerEvents: 'none',
};

// nodeTypes must be defined OUTSIDE the component to avoid React Flow warnings
const NODE_TYPES = { appNode: AppNode, centerNode: CenterNode };

// ─────────────────────────────────────────────────────────────────────────────
// Context menu state
// ─────────────────────────────────────────────────────────────────────────────
interface MenuState {
  nodeId: string; label: string; isCenter: boolean;
  x: number; y: number;  // fixed viewport coords
}

// ─────────────────────────────────────────────────────────────────────────────
// Inner diagram (needs ReactFlowProvider context for useReactFlow)
// ─────────────────────────────────────────────────────────────────────────────
function DiagramFlow({ filters, onEditRelationship }: Props) {
  const { fitView } = useReactFlow();

  // ── Stable callbacks (empty deps — state setters are always stable) ──────────
  const [nodeMenu, setNodeMenu] = useState<MenuState | null>(null);
  const [expandedLevels, setExpandedLevels] = useState<Record<string, number>>({});

  const openMenu = useCallback((
    nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setNodeMenu({
      nodeId, label, isCenter,
      x: Math.min(e.clientX, window.innerWidth  - 240),
      y: Math.min(e.clientY + 6, window.innerHeight - 440),
    });
  }, []); // setNodeMenu is stable, so empty deps is correct

  const setLevel = useCallback((nodeId: string, lvl: number) => {
    setExpandedLevels(prev => ({ ...prev, [nodeId]: lvl }));
    setNodeMenu(null);
  }, []);

  const closeMenu = useCallback(() => setNodeMenu(null), []);

  // ── React Flow state (initialised ONCE with all nodes/edges) ─────────────────
  // Level nodes start hidden; visibility is toggled by the effects below.
  // useNodesState handles drag automatically — positions update on every drag move.
  const [nodes, setNodes, onNodesChange] = useNodesState(buildInitialNodes(openMenu));
  const [edges, setEdges, onEdgesChange] = useEdgesState(buildInitialEdges());

  // ── Update visibility when filters OR expanded levels change ─────────────────
  // Key insight: setNodes(prev => prev.map(...)) preserves drag positions because
  // only `hidden` and `data.curLevel` are updated — `position` is left untouched.
  useEffect(() => {
    // Which base-level edges are visible?
    const visibleBaseLinks = new Set(
      LINK_DATA
        .filter(l => filters[l.direction] && filters[l.serviceType])
        .map(l => l.id),
    );
    // Which base nodes have at least one visible edge?
    const visibleBaseNodes = new Set<string>(['center']);
    LINK_DATA.forEach(l => {
      if (visibleBaseLinks.has(l.id)) {
        visibleBaseNodes.add(l.source);
        visibleBaseNodes.add(l.target);
      }
    });

    // Which level node/edge ids should be visible?
    const visLevelNodeIds = new Set<string>();
    const visLevelLinkIds = new Set<string>();
    Object.entries(expandedLevels).forEach(([rootId, depth]) => {
      if (depth < 1) return;
      levelNodeIds(rootId, depth).forEach(id => visLevelNodeIds.add(id));
      levelLinkIds(rootId, depth).forEach(id => visLevelLinkIds.add(id));
    });

    setNodes(prev => prev.map(node => {
      const isLevelNode   = LEVEL_NODES.some(n => n.id === node.id);
      const newHidden     = isLevelNode
        ? !visLevelNodeIds.has(node.id)
        : !visibleBaseNodes.has(node.id);
      const newCurLevel   = expandedLevels[node.id] ?? 0;

      // Only create a new object reference when something actually changed
      if (node.hidden === newHidden && (node.data as NodeData).curLevel === newCurLevel) return node;

      return {
        ...node,
        hidden: newHidden,
        data:   { ...node.data, curLevel: newCurLevel },
      };
    }));

    setEdges(prev => prev.map(edge => {
      const baseLink  = LINK_DATA.find(l => l.id === edge.id);
      const levelLink = LEVEL_LINKS.find(l => l.id === edge.id);
      let   newHidden: boolean;

      if (baseLink)       newHidden = !visibleBaseLinks.has(edge.id);
      else if (levelLink) newHidden = !visLevelLinkIds.has(edge.id)
                                   || !filters[levelLink.direction]
                                   || !filters[levelLink.serviceType];
      else                newHidden = edge.hidden ?? false;

      if (edge.hidden === newHidden) return edge;
      return { ...edge, hidden: newHidden };
    }));
  }, [filters, expandedLevels, setNodes, setEdges]);

  // ── Smooth fit-view whenever expansion changes ────────────────────────────────
  const prevExpandRef = useRef('');
  useEffect(() => {
    const key = JSON.stringify(expandedLevels);
    if (key === prevExpandRef.current) return;
    prevExpandRef.current = key;
    // Small timeout so the hidden→visible DOM update settles first
    const t = setTimeout(() => fitView({ padding: 0.1, duration: 480 }), 60);
    return () => clearTimeout(t);
  }, [expandedLevels, fitView]);

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="relative w-full rounded-xl border border-gray-200 overflow-hidden" style={{ height: 590 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeOrigin={[0.5, 0.5]}   // positions refer to node centers
        fitView
        fitViewOptions={{ padding: 0.1 }}
        minZoom={0.2}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        onPaneClick={closeMenu}
        style={{ background: '#F8FAFC' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#E2E8F0" />
        <Controls showInteractive={false} className="rounded-lg" />
      </ReactFlow>

      {/* ── Context / action menu (position: fixed so it's never clipped) ─────── */}
      {nodeMenu && (
        <div
          className="fixed z-[9999] w-56 bg-white rounded-xl shadow-2xl border border-gray-200 py-1 overflow-hidden"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-800 truncate">{nodeMenu.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {nodeMenu.isCenter ? 'Current Application (Hub)' : 'Related Application'}
            </p>
          </div>

          {/* Common action */}
          <div className="py-1">
            <MI icon={<Eye size={14} className="text-gray-400" />} label="View Application Details" onClick={closeMenu} />

            {nodeMenu.isCenter ? (
              <>
                <MI icon={<ArrowUp    size={14} className="text-orange-400" />} label="Add Upstream Relationship"     onClick={closeMenu} />
                <MI icon={<ArrowDown  size={14} className="text-blue-400"   />} label="Add Downstream Relationship"   onClick={closeMenu} />
                <MI icon={<ArrowLeftRight size={14} className="text-violet-400" />} label="Add Bidirectional Relationship" onClick={closeMenu} />
                <div className="border-t border-gray-100 my-1" />
                <MI icon={<Edit2 size={14} className="text-gray-400" />} label="Edit CI Details"
                    onClick={() => { onEditRelationship(); closeMenu(); }} />
              </>
            ) : (
              <>
                <MI icon={<Edit2  size={14} className="text-gray-400" />} label="Edit Relationship"
                    onClick={() => { onEditRelationship(); closeMenu(); }} />
                <MI icon={<Plus   size={14} className="text-gray-400" />} label="Add New Relationship" onClick={closeMenu} />
                <div className="border-t border-gray-100 my-1" />
                <MI icon={<Trash2 size={14} className="text-red-400"  />} label="Remove Relationship"  onClick={closeMenu} danger />
              </>
            )}
          </div>

          {/* ── Relationship level picker (only for expandable nodes) ─────────── */}
          {!nodeMenu.isCenter && getMaxLevels(nodeMenu.nodeId) > 0 && (() => {
            const maxLvl = getMaxLevels(nodeMenu.nodeId);
            const curLvl = expandedLevels[nodeMenu.nodeId] ?? 0;
            return (
              <>
                <div className="border-t border-gray-100" />
                <div className="px-3 py-3">
                  <div className="flex items-center gap-1.5 mb-2.5">
                    <Network size={13} className="text-blue-500 flex-shrink-0" />
                    <span className="text-[11px] font-semibold text-gray-700">Expand Relationships</span>
                  </div>

                  {/* Level buttons 0 … maxLvl */}
                  <div
                    className="grid gap-1 mb-2"
                    style={{ gridTemplateColumns: `repeat(${maxLvl + 1}, 1fr)` }}
                  >
                    {Array.from({ length: maxLvl + 1 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setLevel(nodeMenu.nodeId, i)}
                        className="py-1.5 rounded-md border text-xs font-semibold transition-all"
                        style={{
                          background:  curLvl === i ? '#2563EB' : '#F9FAFB',
                          color:       curLvl === i ? '#fff'    : '#374151',
                          borderColor: curLvl === i ? '#2563EB' : '#E5E7EB',
                          boxShadow:   curLvl === i ? '0 1px 4px rgba(37,99,235,.4)' : 'none',
                        }}
                      >
                        {i === 0 ? '0' : `${i}L`}
                      </button>
                    ))}
                  </div>

                  <p className="text-[10px] text-gray-400 leading-snug">
                    {curLvl === 0
                      ? `Direct connection only · ${maxLvl} more level${maxLvl > 1 ? 's' : ''} available`
                      : `Showing ${curLvl} level${curLvl > 1 ? 's' : ''} of downstream relationships`}
                  </p>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* Drag hint */}
      <div className="absolute bottom-2 right-14 pointer-events-none">
        <span className="text-[10px] text-gray-400 bg-white/80 px-2 py-0.5 rounded-full border border-gray-200 shadow-sm">
          Drag to rearrange · Scroll to zoom
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Wrapper — ReactFlowProvider makes useReactFlow() available in DiagramFlow
// ─────────────────────────────────────────────────────────────────────────────
export default function RelationshipDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <DiagramFlow {...props} />
    </ReactFlowProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny menu-item helper
// ─────────────────────────────────────────────────────────────────────────────
function MI({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors
        ${danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-50'}`}
      onClick={onClick}
    >
      <span className="flex-shrink-0">{icon}</span>
      {label}
    </button>
  );
}

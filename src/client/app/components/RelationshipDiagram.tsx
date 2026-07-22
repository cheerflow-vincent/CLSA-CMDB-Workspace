/**
 * RelationshipDiagram — powered by React Flow (@xyflow/react)
 *
 * Relationship classification (from center app's perspective):
 *   center = parent → other CI is Downstream
 *   center = child  → other CI is Upstream
 *   Bidirectional   → same CI appears in both sets
 *
 * Multi-level expansion:
 *   System property x_citi4_clsa_cmd_0.app.relationship.depth controls max depth.
 *   L1 nodes (direct relations of center) show a +N badge indicating available
 *   expansion depth. The context menu level picker lets users show 0…N hops.
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
  MoreHorizontal, MoreVertical, Eye, Edit2, Plus, Trash2,
  ArrowUp, ArrowDown, ArrowLeftRight, Loader2, Network,
} from 'lucide-react';
import { queryTable, getSysProperties } from '../../api/servicenow';
import type { AppItem } from '../data/appData';

// ─── Public types ─────────────────────────────────────────────────────────────
type Direction   = 'upstream' | 'downstream' | 'bidirectional';
type ServiceType = 'platform' | 'infrastructure' | 'business';

export interface DiagramFilters {
  upstream: boolean; downstream: boolean; bidirectional: boolean;
  platform: boolean; infrastructure: boolean; business: boolean;
}

interface Props {
  filters:             DiagramFilters;
  onEditRelationship:  () => void;
  selectedApp?:        AppItem | null;
  onSelectApp?:        (app: AppItem) => void;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
export const DIR_COLOR: Record<Direction, string> = {
  upstream: '#F97316', downstream: '#3B82F6', bidirectional: '#8B5CF6',
};
export const SVC_STYLE: Record<ServiceType, { bg: string; border: string; text: string }> = {
  platform:       { bg: '#EFF6FF', border: '#3B82F6', text: '#1E40AF' },
  infrastructure: { bg: '#F8FAFC', border: '#64748B', text: '#334155' },
  business:       { bg: '#F0FDF4', border: '#16A34A', text: '#166534' },
};
export const NW = 148;
export const NH = 42;
const       CW = 172;
const       CH = 52;

const CENTER_X  = 500;
const CENTER_Y  = 260;
const DEPTH_PROP = 'x_citi4_clsa_cmd_0.app.relationship.depth';
const DEFAULT_DEPTH  = 2;
const MAX_PER_COL    = 10;   // max L1 nodes per vertical column before adding a second column
const COL_X_GAP      = 190;  // horizontal px between sub-columns (wider than NW=148)
const MIN_ROW_SPACING = 70;  // minimum px between node centres (keeps a visible gap at NH=54)
const MAX_BI_PER_ROW  = 6;   // bidirectional nodes per horizontal row
const BI_ROW_Y_GAP    = 85;  // vertical gap between bidir rows

const IMP_TYPE  = 'impacts::impacted by';
const RDF_TYPE  = 'Receives data from::Sends data to';

// ─── Data types ───────────────────────────────────────────────────────────────
interface RelCI {
  sysId:     string;
  name:      string;
  sysClass:  string;
  direction: Direction;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sn = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'value' in v)
    return String((v as Record<string, unknown>).value ?? '');
  return String(v);
};

function classToServiceType(cls: string): ServiceType {
  if (cls === 'cmdb_ci_service') return 'business';
  if (cls === 'cmdb_ci_service_auto') return 'platform';
  return 'infrastructure';
}

/** Actual depth of the subtree rooted at nodeId, up to maxRemaining hops. */
function getSubtreeDepth(nodeId: string, cm: Map<string, RelCI[]>, maxRemaining: number): number {
  if (maxRemaining <= 0) return 0;
  const children = cm.get(nodeId) ?? [];
  if (children.length === 0) return 0;
  return 1 + Math.max(0, ...children.map(c => getSubtreeDepth(c.sysId, cm, maxRemaining - 1)));
}

// ─── CMDB fetch — L1 (direct relations of center) ────────────────────────────
async function fetchRelationships(sysId: string): Promise<RelCI[]> {
  const TYPE_Q = `type.nameIN${IMP_TYPE},${RDF_TYPE}`;
  const [{ result: asParent = [] }, { result: asChild = [] }] = await Promise.all([
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^parent.sys_id=${sysId}`,
      fields: ['child.sys_id', 'child.name', 'child.sys_class_name'],
      limit: 300,
    }),
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^child.sys_id=${sysId}`,
      fields: ['parent.sys_id', 'parent.name', 'parent.sys_class_name'],
      limit: 300,
    }),
  ]);

  const upSet = new Set<string>();
  const dnSet = new Set<string>();
  const ciMap = new Map<string, { name: string; cls: string }>();

  for (const r of asParent) {
    const id = sn(r['child.sys_id']);
    if (!id || id === sysId) continue;
    ciMap.set(id, { name: sn(r['child.name']), cls: sn(r['child.sys_class_name']) });
    dnSet.add(id);
  }
  for (const r of asChild) {
    const id = sn(r['parent.sys_id']);
    if (!id || id === sysId) continue;
    ciMap.set(id, { name: sn(r['parent.name']), cls: sn(r['parent.sys_class_name']) });
    upSet.add(id);
  }

  return [...ciMap.entries()].map(([id, { name, cls }]) => ({
    sysId: id, name, sysClass: cls,
    direction: upSet.has(id) && dnSet.has(id) ? 'bidirectional' : upSet.has(id) ? 'upstream' : 'downstream',
  }));
}

// ─── CMDB fetch — children of multiple nodes (one hop each) ──────────────────
async function fetchChildrenForNodes(
  nodeIds: string[],
  visited: Set<string>,
): Promise<Map<string, RelCI[]>> {
  if (!nodeIds.length) return new Map();

  const nodeIdSet = new Set(nodeIds);
  const TYPE_Q = `type.nameIN${IMP_TYPE},${RDF_TYPE}`;
  const ids = nodeIds.join(',');

  const [{ result: asParent = [] }, { result: asChild = [] }] = await Promise.all([
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^parent.sys_idIN${ids}`,
      fields: ['parent.sys_id', 'child.sys_id', 'child.name', 'child.sys_class_name'],
      limit: 500,
    }),
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^child.sys_idIN${ids}`,
      fields: ['child.sys_id', 'parent.sys_id', 'parent.name', 'parent.sys_class_name'],
      limit: 500,
    }),
  ]);

  const result = new Map<string, RelCI[]>();
  const seenPairs = new Set<string>();

  const add = (parentId: string, child: RelCI) => {
    const key = `${parentId}:${child.sysId}`;
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    if (!result.has(parentId)) result.set(parentId, []);
    result.get(parentId)!.push(child);
  };

  for (const r of asParent) {
    const pId  = sn(r['parent.sys_id']);
    const cId  = sn(r['child.sys_id']);
    if (!cId || visited.has(cId) || !nodeIdSet.has(pId)) continue;
    add(pId, { sysId: cId, name: sn(r['child.name']), sysClass: sn(r['child.sys_class_name']), direction: 'downstream' });
  }
  for (const r of asChild) {
    const cId  = sn(r['child.sys_id']);
    const pId  = sn(r['parent.sys_id']);
    if (!pId || visited.has(pId) || !nodeIdSet.has(cId)) continue;
    add(cId, { sysId: pId, name: sn(r['parent.name']), sysClass: sn(r['parent.sys_class_name']), direction: 'upstream' });
  }

  return result;
}

// ─── Edge builder ─────────────────────────────────────────────────────────────
interface EdgeDef { id: string; source: string; target: string; direction: Direction; serviceType: ServiceType; }

function buildEdge({ id, source, target, direction, serviceType }: EdgeDef, hidden: boolean): Edge {
  const color = DIR_COLOR[direction];
  const isBi  = direction === 'bidirectional';
  return {
    id, source, target, hidden, type: 'default',
    style: { stroke: color, strokeWidth: 2, opacity: 0.88, ...(isBi ? { strokeDasharray: '7 4' } : {}) },
    markerEnd:  { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    ...(isBi ? { markerStart: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 } } : {}),
    data: { direction, serviceType },
  };
}

// ─── Node data shape ──────────────────────────────────────────────────────────
interface NodeData {
  label:       string;
  serviceType: ServiceType | 'center';
  isCenter:    boolean;
  maxLevels:   number;
  curLevel:    number;
  onOpenMenu:  (nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent) => void;
  [key: string]: unknown;
}

// ─── Recursive child placer ───────────────────────────────────────────────────
type ChainDir = 'left' | 'right';

/**
 * Places children of `parentId` and recurses.
 *
 * `remainingDepth` tracks how many more levels to show:
 *   - Starts at the parent node's curLevel (how deep the user expanded).
 *   - Decrements by 1 each level.
 *   - If a child node itself has its own `expandedLevels` entry, we use
 *     Math.max(remainingDepth - 1, child.curLevel) so the child's own
 *     expansion overrides the decrement — making every visible node
 *     independently expandable.
 */
function placeChildrenRecursive(
  parentId:       string,
  parentPos:      { x: number; y: number },
  chainDir:       ChainDir,
  remainingDepth: number,               // levels left to show; stop when 0
  childrenByNode: Map<string, RelCI[]>,
  expandedLevels: Record<string, number>,
  maxDepth:       number,               // cap for getSubtreeDepth badge calc
  openMenu:       NodeData['onOpenMenu'],
  nodes:          Node[],
  edges:          Edge[],
  placedIds:      Set<string>,
): void {
  if (remainingDepth <= 0) return;

  const children = childrenByNode.get(parentId) ?? [];
  if (!children.length) return;

  const X_STEP  = chainDir === 'left' ? -200 : 200;
  const x       = parentPos.x + X_STEP;
  const spacing = Math.max(MIN_ROW_SPACING, Math.min(130, 600 / Math.max(1, children.length)));
  const startY  = parentPos.y - ((children.length - 1) * spacing) / 2;

  children.forEach((child, i) => {
    if (placedIds.has(child.sysId)) return;
    placedIds.add(child.sysId);

    const pos     = { x, y: startY + i * spacing };
    const svcType = classToServiceType(child.sysClass);
    const maxLvls = getSubtreeDepth(child.sysId, childrenByNode, maxDepth);
    const curLvl  = expandedLevels[child.sysId] ?? 0;

    nodes.push({
      id: child.sysId, type: 'appNode', position: pos, hidden: false,
      data: {
        label: child.name || child.sysId, serviceType: svcType,
        isCenter: false, maxLevels: maxLvls, curLevel: curLvl, onOpenMenu: openMenu,
      } satisfies NodeData,
    });

    const src = child.direction === 'upstream' ? child.sysId : parentId;
    const tgt = child.direction === 'upstream' ? parentId    : child.sysId;
    edges.push(buildEdge({ id: `e-lv-${parentId}-${child.sysId}`, source: src, target: tgt, direction: child.direction, serviceType: svcType }, false));

    // Child's own expansion overrides the decrement so it can show more levels
    placeChildrenRecursive(child.sysId, pos, chainDir, Math.max(remainingDepth - 1, curLvl), childrenByNode, expandedLevels, maxDepth, openMenu, nodes, edges, placedIds);
  });
}

// ─── Multi-column L1 layout helper ───────────────────────────────────────────
/**
 * Distributes `nodes` across as many vertical sub-columns as needed so that
 * no column exceeds MAX_PER_COL entries. Each extra column steps COL_X_GAP px
 * further away from the center (left side goes further left, right side right).
 */
function layoutSide(
  cis:      RelCI[],
  baseX:    number,
  centerY:  number,
  side:     'left' | 'right',
): Array<{ ci: RelCI; x: number; y: number }> {
  const count = cis.length;
  if (!count) return [];

  const numCols = Math.ceil(count / MAX_PER_COL);
  const perCol  = Math.ceil(count / numCols);

  return cis.map((ci, i) => {
    const col          = Math.floor(i / perCol);
    const row          = i % perCol;
    const thisColCount = Math.min(perCol, count - col * perCol);
    const spacing      = Math.max(MIN_ROW_SPACING, Math.min(130, 640 / thisColCount));
    const startY       = centerY - ((thisColCount - 1) * spacing) / 2;
    const x            = side === 'left' ? baseX - col * COL_X_GAP : baseX + col * COL_X_GAP;
    return { ci, x, y: startY + row * spacing };
  });
}

// ─── Full diagram builder ─────────────────────────────────────────────────────
interface DiagramResult {
  nodes:     Node[];
  edges:     Edge[];
  // Used by the filter-update effect to determine visibility per node
  nodeL1Map: Map<string, { direction: Direction; svcType: ServiceType }>;
}

function buildDiagram(
  relCIs:         RelCI[],
  childrenByNode: Map<string, RelCI[]>,
  expandedLevels: Record<string, number>,
  maxDepth:       number,
  selectedApp:    AppItem | null | undefined,
  openMenu:       NodeData['onOpenMenu'],
): DiagramResult {
  const CX = CENTER_X, CY = CENTER_Y;

  const upstream   = relCIs.filter(r => r.direction === 'upstream');
  const downstream = relCIs.filter(r => r.direction === 'downstream');
  const bidir      = relCIs.filter(r => r.direction === 'bidirectional');

  const nodes:     Node[] = [];
  const edges:     Edge[] = [];
  const placedIds  = new Set<string>(['center']);
  const nodeL1Map  = new Map<string, { direction: Direction; svcType: ServiceType }>();

  // Center
  nodes.push({
    id: 'center', type: 'centerNode', position: { x: CX, y: CY }, hidden: false,
    data: { label: selectedApp?.name ?? 'Selected Application', serviceType: 'center', isCenter: true, maxLevels: 0, curLevel: 0, onOpenMenu: openMenu } satisfies NodeData,
  });

  const placeL1 = (ci: RelCI, pos: { x: number; y: number }, chainDir: ChainDir, edgeSrc: string, edgeTgt: string) => {
    const svcType = classToServiceType(ci.sysClass);
    const maxLvls = getSubtreeDepth(ci.sysId, childrenByNode, maxDepth - 1);
    const curLvl  = expandedLevels[ci.sysId] ?? 0;
    const l1Info  = { direction: ci.direction, svcType };

    placedIds.add(ci.sysId);
    nodeL1Map.set(ci.sysId, l1Info);

    nodes.push({
      id: ci.sysId, type: 'appNode', position: pos, hidden: false,
      data: { label: ci.name || ci.sysId, serviceType: svcType, isCenter: false, maxLevels: maxLvls, curLevel: curLvl, onOpenMenu: openMenu } satisfies NodeData,
    });
    edges.push(buildEdge({ id: `e-${edgeSrc === 'center' ? 'dn' : 'up'}-${ci.sysId}`, source: edgeSrc, target: edgeTgt, direction: ci.direction, serviceType: svcType }, false));

    if (curLvl > 0) {
      placeChildrenRecursive(ci.sysId, pos, chainDir, curLvl, childrenByNode, expandedLevels, maxDepth, openMenu, nodes, edges, placedIds);
      nodes.forEach(n => { if (!nodeL1Map.has(n.id) && n.id !== 'center') nodeL1Map.set(n.id, l1Info); });
    }
  };

  layoutSide(upstream, 200, CY, 'left').forEach(({ ci, x, y }) =>
    placeL1(ci, { x, y }, 'left', ci.sysId, 'center'));

  layoutSide(downstream, 800, CY, 'right').forEach(({ ci, x, y }) =>
    placeL1(ci, { x, y }, 'right', 'center', ci.sysId));

  bidir.forEach((ci, i) => {
    const row         = Math.floor(i / MAX_BI_PER_ROW);
    const col         = i % MAX_BI_PER_ROW;
    const rowCount    = Math.min(MAX_BI_PER_ROW, bidir.length - row * MAX_BI_PER_ROW);
    const biSpacing   = rowCount > 1 ? Math.min(190, 560 / (rowCount - 1)) : 0;
    const biStartX    = CX - ((rowCount - 1) * biSpacing) / 2;
    const svcType     = classToServiceType(ci.sysClass);
    const maxLvls     = getSubtreeDepth(ci.sysId, childrenByNode, maxDepth - 1);
    const curLvl      = expandedLevels[ci.sysId] ?? 0;
    const pos         = { x: biStartX + col * biSpacing, y: CY + 220 + row * BI_ROW_Y_GAP };
    const l1Info      = { direction: ci.direction as Direction, svcType };

    placedIds.add(ci.sysId);
    nodeL1Map.set(ci.sysId, l1Info);

    nodes.push({
      id: ci.sysId, type: 'appNode', position: pos, hidden: false,
      data: { label: ci.name || ci.sysId, serviceType: svcType, isCenter: false, maxLevels: maxLvls, curLevel: curLvl, onOpenMenu: openMenu } satisfies NodeData,
    });
    edges.push(buildEdge({ id: `e-bi-${ci.sysId}`, source: 'center', target: ci.sysId, direction: 'bidirectional', serviceType: svcType }, false));

    if (curLvl > 0) {
      placeChildrenRecursive(ci.sysId, pos, 'right', curLvl, childrenByNode, expandedLevels, maxDepth, openMenu, nodes, edges, placedIds);
      nodes.forEach(n => { if (!nodeL1Map.has(n.id) && n.id !== 'center') nodeL1Map.set(n.id, l1Info); });
    }
  });

  return { nodes, edges, nodeL1Map };
}

// ─── AppNode ──────────────────────────────────────────────────────────────────
// Layout mirrors the React Flow "Action Bar Node" pattern:
//   [label — flex:1]  [+N badge]  [⋮ menu]
// The badge takes the position of a "specific action icon" (like trash), and
// the vertical ⋮ takes the position of the generic dropdown trigger.
const AppNode = memo(({ id, data }: NodeProps) => {
  const d         = data as NodeData;
  const svc       = d.serviceType === 'center' ? null : SVC_STYLE[d.serviceType as ServiceType];
  const hasExpand = d.maxLevels > 0;
  const borderClr = svc?.border ?? '#9CA3AF';

  return (
    <div style={{
      width: NW, minHeight: NH,
      background: svc?.bg ?? '#F3F4F6', border: `1.5px solid ${borderClr}`,
      borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 2,
      padding: '5px 4px 5px 8px',
      cursor: 'grab', userSelect: 'none', overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Left}  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />

      {/* Label — grows to fill remaining width, centered */}
      <span style={{
        flex: 1,
        fontSize: 11, color: svc?.text ?? '#374151',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        whiteSpace: 'normal', wordBreak: 'break-word',
        lineHeight: '1.35', textAlign: 'center',
        pointerEvents: 'none',
      }}>{d.label}</span>

      {/* +N / Lx badge — sits where the "trash" icon would be in the action bar */}
      {hasExpand && (
        <button
          className="nodrag flex-shrink-0"
          style={{ background: 'none', border: 'none', padding: '1px 0', cursor: 'pointer', lineHeight: 0 }}
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, false, e); }}
          title={d.curLevel > 0 ? `${d.curLevel} level(s) expanded` : `${d.maxLevels} level(s) available`}
        >
          <span
            className={`inline-flex items-center rounded-full px-1.5
              ${d.curLevel > 0 ? 'bg-blue-600 text-white ring-1 ring-blue-400' : 'bg-white/80 text-gray-400 border border-gray-300'}`}
            style={{ fontSize: 8.5, fontWeight: 700, lineHeight: '15px' }}
          >
            {d.curLevel > 0 ? `L${d.curLevel}` : `+${d.maxLevels}`}
          </span>
        </button>
      )}

      {/* ⋮ vertical dropdown trigger */}
      <button
        className="nodrag flex-shrink-0 p-0.5 rounded opacity-40 hover:opacity-100 hover:bg-black/10 text-gray-500 transition-opacity"
        style={{ lineHeight: 0 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, false, e); }}
        title="Actions"
      ><MoreVertical size={13} /></button>
    </div>
  );
});
AppNode.displayName = 'AppNode';

// ─── CenterNode ───────────────────────────────────────────────────────────────
const CenterNode = memo(({ id, data }: NodeProps) => {
  const d = data as NodeData;
  return (
    <div style={{
      width: CW, height: CH,
      background: '#1D4ED8', border: '2px solid #1E40AF', borderRadius: 10,
      position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      cursor: 'grab', userSelect: 'none', boxShadow: '0 2px 12px rgba(29,78,216,0.35)',
    }}>
      <Handle type="target" position={Position.Left}  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <span style={{
        fontSize: 12, fontWeight: 600, color: '#fff',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        maxWidth: CW - 28, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>{d.label}</span>
      <button
        className="absolute top-0.5 right-0.5 p-0.5 rounded opacity-40 hover:opacity-100 hover:bg-white/20 text-white transition-opacity"
        style={{ fontSize: 0 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, true, e); }}
        title="Hub actions"
      ><MoreHorizontal size={13} /></button>
    </div>
  );
});
CenterNode.displayName = 'CenterNode';

const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0, width: 6, height: 6, minWidth: 0, minHeight: 0,
  background: 'transparent', border: 'none', pointerEvents: 'none',
};

const NODE_TYPES = { appNode: AppNode, centerNode: CenterNode };

interface MenuState { nodeId: string; label: string; isCenter: boolean; x: number; y: number; }

// ─── DiagramFlow ──────────────────────────────────────────────────────────────
function DiagramFlow({ filters, onEditRelationship, selectedApp, onSelectApp }: Props) {
  const { setCenter } = useReactFlow();

  const [nodeMenu,        setNodeMenu]        = useState<MenuState | null>(null);
  const [relCIs,          setRelCIs]          = useState<RelCI[]>([]);
  const [childrenByNode,  setChildrenByNode]  = useState<Map<string, RelCI[]>>(new Map());
  const [expandedLevels,  setExpandedLevels]  = useState<Record<string, number>>({});
  const [maxDepth,        setMaxDepth]        = useState<number>(DEFAULT_DEPTH);
  const [loading,         setLoading]         = useState(false);
  const [nodes, setNodes, onNodesChange]      = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange]      = useEdgesState<Edge>([]);

  // Stable refs for callbacks that need current state
  const relCIsRef        = useRef<RelCI[]>([]);
  const childrenRef      = useRef(new Map<string, RelCI[]>());
  const onSelectAppRef   = useRef<typeof onSelectApp>(onSelectApp);
  const nodeL1MapRef     = useRef(new Map<string, { direction: Direction; svcType: ServiceType }>());
  useEffect(() => { relCIsRef.current      = relCIs; },         [relCIs]);
  useEffect(() => { childrenRef.current    = childrenByNode; }, [childrenByNode]);
  useEffect(() => { onSelectAppRef.current = onSelectApp; },    [onSelectApp]);

  // Fetch max depth from system property once on mount
  useEffect(() => {
    getSysProperties([DEPTH_PROP])
      .then(props => {
        const v = parseInt(props[DEPTH_PROP] ?? '', 10);
        if (!isNaN(v) && v > 0) setMaxDepth(v);
      })
      .catch(() => {});
  }, []);

  const openMenu = useCallback((
    nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    setNodeMenu({
      nodeId, label, isCenter,
      x: Math.min(e.clientX,     window.innerWidth  - 260),
      y: Math.min(e.clientY + 6, window.innerHeight - 360),
    });
  }, []);

  const closeMenu  = useCallback(() => setNodeMenu(null), []);
  const setLevel   = useCallback((nodeId: string, lvl: number) => {
    setExpandedLevels(prev => ({ ...prev, [nodeId]: lvl }));
    setNodeMenu(null);
  }, []);

  // ── Fetch L1 relationships when selected app changes ─────────────────────
  useEffect(() => {
    const sysId = selectedApp?.sysId;
    if (!sysId) { setRelCIs([]); setChildrenByNode(new Map()); setExpandedLevels({}); return; }

    setLoading(true);
    setRelCIs([]);
    setChildrenByNode(new Map());
    setExpandedLevels({});

    fetchRelationships(sysId)
      .then(async l1Nodes => {
        setRelCIs(l1Nodes);

        // Fetch deeper levels up to maxDepth + 1.
        // The extra level ensures every visible node has children data available for +N badges.
        if (maxDepth <= 1 || !l1Nodes.length) return;

        const visited  = new Set<string>([sysId, ...l1Nodes.map(n => n.sysId)]);
        const combined = new Map<string, RelCI[]>();

        let currentLevel = l1Nodes.map(n => n.sysId);

        for (let depth = 2; depth <= maxDepth + 1; depth++) {
          if (!currentLevel.length) break;
          const levelMap = await fetchChildrenForNodes(currentLevel, visited);
          const nextLevel: string[] = [];

          for (const [parentId, children] of levelMap) {
            combined.set(parentId, children);
            for (const c of children) {
              if (!visited.has(c.sysId)) { visited.add(c.sysId); nextLevel.push(c.sysId); }
            }
          }
          currentLevel = nextLevel;
        }

        setChildrenByNode(combined);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  // maxDepth intentionally included so deep levels are fetched if property loads after app
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedApp?.sysId, maxDepth]);

  // ── Rebuild diagram whenever data or expansion changes ────────────────────
  const prevSysIdRef = useRef('');
  useEffect(() => {
    const sysId    = selectedApp?.sysId ?? '';
    const isNewApp = sysId !== prevSysIdRef.current;
    prevSysIdRef.current = sysId;

    const { nodes: n, edges: e, nodeL1Map } = buildDiagram(
      relCIs, childrenByNode, expandedLevels, maxDepth, selectedApp, openMenu,
    );
    nodeL1MapRef.current = nodeL1Map;
    setNodes(n);
    setEdges(e);

    if (isNewApp || relCIs.length > 0) {
      const zoom = Math.max(0.5, 1.1 - relCIs.length * 0.035);
      setTimeout(() => setCenter(CENTER_X, CENTER_Y, { zoom, duration: 420 }), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relCIs, childrenByNode, expandedLevels, maxDepth, selectedApp?.sysId]);

  // ── Filter changes: update hidden only (preserve drag positions) ──────────
  useEffect(() => {
    setNodes(prev => prev.map(node => {
      if (node.id === 'center') return node;
      const l1Info = nodeL1MapRef.current.get(node.id);
      if (!l1Info) return node;
      const newHidden = !(filters[l1Info.direction] && filters[l1Info.svcType]);
      if (node.hidden === newHidden) return node;
      return { ...node, hidden: newHidden };
    }));
    setEdges(prev => prev.map(edge => {
      const sourceL1 = nodeL1MapRef.current.get(edge.source);
      const targetL1 = nodeL1MapRef.current.get(edge.target);
      const l1Info   = sourceL1 ?? targetL1;
      if (!l1Info) return edge;
      const newHidden = !(filters[l1Info.direction] && filters[l1Info.svcType]);
      if (edge.hidden === newHidden) return edge;
      return { ...edge, hidden: newHidden };
    }));
  }, [filters, setNodes, setEdges]);

  // ─── Render ────────────────────────────────────────────────────────────────
  // How many levels can the currently-hovered node expand?
  const menuNodeMaxLvl  = nodeMenu && !nodeMenu.isCenter
    ? getSubtreeDepth(nodeMenu.nodeId, childrenRef.current, maxDepth - 1)
    : 0;
  const menuNodeCurLvl  = nodeMenu ? (expandedLevels[nodeMenu.nodeId] ?? 0) : 0;
  const isL1Node        = nodeMenu ? relCIsRef.current.some(r => r.sysId === nodeMenu.nodeId) : false;

  return (
    <div className="relative w-full rounded-xl border border-gray-200 overflow-hidden" style={{ height: 590 }}>

      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <span className="text-sm text-gray-500">Loading relationships…</span>
          </div>
        </div>
      )}

      {!loading && relCIs.length === 0 && selectedApp?.sysId && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-center text-gray-400 px-6">
            <p className="text-sm font-medium text-gray-500">No relationships found</p>
            <p className="text-xs mt-1 leading-relaxed">
              No upstream or downstream connections of type<br />
              <span className="font-medium text-gray-500 italic">impacts::impacted by</span> or{' '}
              <span className="font-medium text-gray-500 italic">Receives data from::Sends data to</span>
            </p>
          </div>
        </div>
      )}

      <ReactFlow
        nodes={nodes} edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeOrigin={[0.5, 0.5]}
        fitView fitViewOptions={{ padding: 0.15 }}
        minZoom={0.2} maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        onPaneClick={closeMenu}
        style={{ background: '#F8FAFC' }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#E2E8F0" />
        <Controls showInteractive={false} className="rounded-lg" />
      </ReactFlow>

      {/* ── Context menu ────────────────────────────────────────────────────── */}
      {nodeMenu && (
        <div
          className="fixed z-[9999] w-60 bg-white rounded-xl shadow-2xl border border-gray-200 py-1 overflow-hidden"
          style={{ left: nodeMenu.x, top: nodeMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-800 truncate">{nodeMenu.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {nodeMenu.isCenter ? 'Current Application (Hub)' : 'Related Application'}
            </p>
          </div>

          <div className="py-1">
            <MI
              icon={<Eye size={14} className="text-gray-400" />}
              label="View Application Details"
              onClick={() => {
                if (!nodeMenu.isCenter) {
                  const rel = relCIsRef.current.find(r => r.sysId === nodeMenu.nodeId);
                  if (rel && onSelectAppRef.current) {
                    onSelectAppRef.current({
                      id: rel.sysId, name: rel.name, sysId: rel.sysId,
                      table: rel.sysClass || 'cmdb_ci_service',
                      app: rel.name, dept: '', env: '', status: '',
                      incidents: 0, changes: 0, criticality: '', servers: 0, lastUpdated: '',
                    });
                  }
                }
                closeMenu();
              }}
            />

            {nodeMenu.isCenter ? (
              <>
                <MI icon={<ArrowUp        size={14} className="text-orange-400" />} label="Add Upstream Relationship"     onClick={closeMenu} />
                <MI icon={<ArrowDown      size={14} className="text-blue-400"   />} label="Add Downstream Relationship"   onClick={closeMenu} />
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

          {/* ── Level expansion picker (any node with descendants) ─── */}
          {menuNodeMaxLvl > 0 && (
            <>
              <div className="border-t border-gray-100" />
              <div className="px-3 py-3">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Network size={13} className="text-blue-500 flex-shrink-0" />
                  <span className="text-[11px] font-semibold text-gray-700">Expand Relationships</span>
                </div>

                <div
                  className="grid gap-1 mb-2"
                  style={{ gridTemplateColumns: `repeat(${menuNodeMaxLvl + 1}, 1fr)` }}
                >
                  {Array.from({ length: menuNodeMaxLvl + 1 }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => setLevel(nodeMenu.nodeId, i)}
                      className="py-1.5 rounded-md border text-xs font-semibold transition-all"
                      style={{
                        background:  menuNodeCurLvl === i ? '#2563EB' : '#F9FAFB',
                        color:       menuNodeCurLvl === i ? '#fff'    : '#374151',
                        borderColor: menuNodeCurLvl === i ? '#2563EB' : '#E5E7EB',
                        boxShadow:   menuNodeCurLvl === i ? '0 1px 4px rgba(37,99,235,.4)' : 'none',
                      }}
                    >
                      {i === 0 ? '0' : `${i}L`}
                    </button>
                  ))}
                </div>

                <p className="text-[10px] text-gray-400 leading-snug">
                  {menuNodeCurLvl === 0
                    ? `Direct connection only · up to ${menuNodeMaxLvl} more level${menuNodeMaxLvl > 1 ? 's' : ''} available`
                    : `Showing ${menuNodeCurLvl} level${menuNodeCurLvl > 1 ? 's' : ''} of relationships`}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      <div className="absolute bottom-2 right-14 pointer-events-none">
        <span className="text-[10px] text-gray-400 bg-white/80 px-2 py-0.5 rounded-full border border-gray-200 shadow-sm">
          Drag to rearrange · Scroll to zoom
        </span>
      </div>
    </div>
  );
}

// ─── Wrapper ──────────────────────────────────────────────────────────────────
export default function RelationshipDiagram(props: Props) {
  return (
    <ReactFlowProvider>
      <DiagramFlow {...props} />
    </ReactFlowProvider>
  );
}

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

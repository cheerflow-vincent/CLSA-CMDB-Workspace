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
  MoreVertical, Eye, Edit2, Trash2,
  Loader2, Network, ExternalLink,
} from 'lucide-react';
import {
  queryTable, getSysProperties, fetchRelationshipChangesForApp,
  fetchFieldAccess,
  requestRelationshipDelete,
  type RelationshipChangeRequest,
} from '../../api/servicenow';
import { loadAppRelationshipPeers, loadAppRelationships, type RelCIPeer } from '../utils/appRelationships';
import { canRemoveRelationship } from '../utils/relationshipEdit';
import { isDirectCenterPeer } from '../utils/diagramLinkPartner';
import { canEditRecord } from '../utils/acl';
import { raw, str } from '../utils/viewFields';
import { serviceTypeFromDepartment, type ServiceType } from '../utils/serviceTypeFromDepartment';
import type { RelationshipMutation } from './EditRelationshipModal';
import type { AppItem } from '../data/appData';

// ─── Public types ─────────────────────────────────────────────────────────────
type Direction   = 'upstream' | 'downstream' | 'bidirectional';
export type { ServiceType };

export interface DiagramFilters {
  upstream: boolean; downstream: boolean; bidirectional: boolean;
  platform: boolean; infrastructure: boolean; business: boolean;
}

interface Props {
  filters:             DiagramFilters;
  nodeSearch?:         string;
  selectedApp?:        AppItem | null;
  onSelectApp?:        (app: AppItem) => void;
  /** Bumps when relationship changes update — refetches pending edge styling. */
  pendingRefreshKey?:  number;
  /** ACL gate for the center (hub) node menu edit actions. */
  canEditCenterRecord?: boolean;
  onEditRelationships: (app: { sysId: string; name: string }) => void;
  onEditCiDetails:     (app: { sysId: string; name: string; table: string }) => void;
  onRelationshipMutations?: (mutations: RelationshipMutation[]) => void;
}

// ─── Design tokens ────────────────────────────────────────────────────────────
export const DIR_COLOR: Record<Direction, string> = {
  upstream: '#F97316', downstream: '#3B82F6', bidirectional: '#8B5CF6',
};
/** Dashed stroke for edges with a pending removal approval. */
export const PENDING_EDGE_DASH = '7 4';
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
const BI_Y_OFFSET     = 220; // distance above center node for first bidir row

const IMP_TYPE  = 'impacts::impacted by';
const RDF_TYPE  = 'Receives data from::Sends data to';

// ─── Data types ───────────────────────────────────────────────────────────────
interface RelCI {
  sysId:     string;
  name:      string;
  sysClass:  string;
  departmentDescription: string;
  direction: Direction;
}

function peerToRelCI(peer: RelCIPeer): RelCI {
  return {
    sysId: peer.sysId,
    name: peer.name,
    sysClass: peer.sysClass,
    departmentDescription: peer.departmentDescription,
    direction: peer.direction,
  };
}

function relCIToServiceType(ci: Pick<RelCI, 'departmentDescription'>): ServiceType {
  return serviceTypeFromDepartment(ci.departmentDescription);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sn = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'value' in v)
    return String((v as Record<string, unknown>).value ?? '');
  return String(v);
};


/** Actual depth of the subtree rooted at nodeId, up to maxRemaining hops. */
function getSubtreeDepth(nodeId: string, cm: Map<string, RelCI[]>, maxRemaining: number): number {
  if (maxRemaining <= 0) return 0;
  const children = cm.get(nodeId) ?? [];
  if (children.length === 0) return 0;
  return 1 + Math.max(0, ...children.map(c => getSubtreeDepth(c.sysId, cm, maxRemaining - 1)));
}

// ─── CMDB fetch — L1 (direct relations of center) ────────────────────────────
async function fetchRelationships(sysId: string): Promise<RelCI[]> {
  const peers = await loadAppRelationshipPeers(sysId);
  return peers.map(peerToRelCI);
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
      fields: ['parent.sys_id', 'child.sys_id', 'child.name', 'child.sys_class_name', 'child.department.description'],
      limit: 500,
      displayValue: 'all',
    }),
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^child.sys_idIN${ids}`,
      fields: ['child.sys_id', 'parent.sys_id', 'parent.name', 'parent.sys_class_name', 'parent.department.description'],
      limit: 500,
      displayValue: 'all',
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
    const pId  = raw(r['parent.sys_id']);
    const cId  = raw(r['child.sys_id']);
    if (!cId || visited.has(cId) || !nodeIdSet.has(pId)) continue;
    add(pId, {
      sysId: cId,
      name: str(r['child.name']),
      sysClass: raw(r['child.sys_class_name']),
      departmentDescription: str(r['child.department.description']),
      direction: 'downstream',
    });
  }
  for (const r of asChild) {
    const cId  = raw(r['child.sys_id']);
    const pId  = raw(r['parent.sys_id']);
    if (!pId || visited.has(pId) || !nodeIdSet.has(cId)) continue;
    add(cId, {
      sysId: pId,
      name: str(r['parent.name']),
      sysClass: raw(r['parent.sys_class_name']),
      departmentDescription: str(r['parent.department.description']),
      direction: 'upstream',
    });
  }

  return result;
}

function pendingRemovalPeerIds(
  centerSysId: string,
  changes: RelationshipChangeRequest[],
): Set<string> {
  const peers = new Set<string>();
  for (const c of changes) {
    if (c.action !== 'delete' || c.state !== 'pending_approval') continue;
    if (c.parent_ci_sys_id === centerSysId) peers.add(c.child_ci_sys_id);
    if (c.child_ci_sys_id === centerSysId) peers.add(c.parent_ci_sys_id);
  }
  return peers;
}

// ─── Edge builder ─────────────────────────────────────────────────────────────
interface EdgeDef {
  id: string; source: string; target: string; direction: Direction; serviceType: ServiceType;
  pendingRemoval?: boolean;
}

function buildEdge(
  { id, source, target, direction, serviceType, pendingRemoval = false }: EdgeDef,
  hidden: boolean,
): Edge {
  const color = DIR_COLOR[direction];
  const isBi  = direction === 'bidirectional';
  return {
    id, source, target, hidden, type: 'default',
    style: {
      stroke: color,
      strokeWidth: 2,
      opacity: 0.88,
      ...(pendingRemoval ? { strokeDasharray: PENDING_EDGE_DASH } : {}),
    },
    markerEnd:  { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    ...(isBi ? { markerStart: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 } } : {}),
    data: { direction, serviceType, pendingRemoval },
  };
}

// ─── Node data shape ──────────────────────────────────────────────────────────
type SearchHighlight = 'none' | 'match' | 'dim';

interface NodeData {
  label:           string;
  serviceType:     ServiceType | 'center';
  isCenter:        boolean;
  maxLevels:       number;
  curLevel:        number;
  searchHighlight: SearchHighlight;
  onOpenMenu:      (nodeId: string, label: string, isCenter: boolean, e: React.MouseEvent) => void;
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
    const svcType = relCIToServiceType(child);
    const maxLvls = getSubtreeDepth(child.sysId, childrenByNode, maxDepth);
    const curLvl  = expandedLevels[child.sysId] ?? 0;

    nodes.push({
      id: child.sysId, type: 'appNode', position: pos, hidden: false,
      data: {
        label: child.name || child.sysId, serviceType: svcType,
        isCenter: false, maxLevels: maxLvls, curLevel: curLvl, searchHighlight: 'none', onOpenMenu: openMenu,
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
  nodes:       Node[];
  edges:       Edge[];
  // Used by the filter-update effect to determine visibility per node
  nodeL1Map:   Map<string, { direction: Direction; svcType: ServiceType }>;
  // Used by the context menu to navigate to any placed node's detail page
  nodeInfoMap: Map<string, { name: string; sysClass: string }>;
}

function buildDiagram(
  relCIs:         RelCI[],
  childrenByNode: Map<string, RelCI[]>,
  expandedLevels: Record<string, number>,
  maxDepth:       number,
  selectedApp:    AppItem | null | undefined,
  openMenu:       NodeData['onOpenMenu'],
  pendingPeerIds: Set<string>,
): DiagramResult {
  const CX = CENTER_X, CY = CENTER_Y;

  const upstream   = relCIs.filter(r => r.direction === 'upstream');
  const downstream = relCIs.filter(r => r.direction === 'downstream');
  const bidir      = relCIs.filter(r => r.direction === 'bidirectional');

  const nodes:       Node[] = [];
  const edges:       Edge[] = [];
  const placedIds    = new Set<string>(['center']);
  const nodeL1Map    = new Map<string, { direction: Direction; svcType: ServiceType }>();
  const nodeInfoMap  = new Map<string, { name: string; sysClass: string }>();

  // Center
  nodes.push({
    id: 'center', type: 'centerNode', position: { x: CX, y: CY }, hidden: false,
    data: { label: selectedApp?.name ?? 'Selected Application', serviceType: 'center', isCenter: true, maxLevels: 0, curLevel: 0, searchHighlight: 'none', onOpenMenu: openMenu } satisfies NodeData,
  });

  const placeL1 = (ci: RelCI, pos: { x: number; y: number }, chainDir: ChainDir, edgeSrc: string, edgeTgt: string) => {
    const svcType = relCIToServiceType(ci);
    const maxLvls = getSubtreeDepth(ci.sysId, childrenByNode, maxDepth);
    const curLvl  = expandedLevels[ci.sysId] ?? 0;
    const l1Info  = { direction: ci.direction, svcType };

    placedIds.add(ci.sysId);
    nodeL1Map.set(ci.sysId, l1Info);
    nodeInfoMap.set(ci.sysId, { name: ci.name, sysClass: ci.sysClass });

    nodes.push({
      id: ci.sysId, type: 'appNode', position: pos, hidden: false,
      data: { label: ci.name || ci.sysId, serviceType: svcType, isCenter: false, maxLevels: maxLvls, curLevel: curLvl, searchHighlight: 'none', onOpenMenu: openMenu } satisfies NodeData,
    });
    edges.push(buildEdge({
      id: `e-${edgeSrc === 'center' ? 'dn' : 'up'}-${ci.sysId}`,
      source: edgeSrc, target: edgeTgt, direction: ci.direction, serviceType: svcType,
      pendingRemoval: pendingPeerIds.has(ci.sysId),
    }, false));

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
    const svcType     = relCIToServiceType(ci);
    const maxLvls     = getSubtreeDepth(ci.sysId, childrenByNode, maxDepth);
    const curLvl      = expandedLevels[ci.sysId] ?? 0;
    const pos         = { x: biStartX + col * biSpacing, y: CY - BI_Y_OFFSET - row * BI_ROW_Y_GAP };
    const l1Info      = { direction: ci.direction as Direction, svcType };

    placedIds.add(ci.sysId);
    nodeL1Map.set(ci.sysId, l1Info);
    nodeInfoMap.set(ci.sysId, { name: ci.name, sysClass: ci.sysClass });

    nodes.push({
      id: ci.sysId, type: 'appNode', position: pos, hidden: false,
      data: { label: ci.name || ci.sysId, serviceType: svcType, isCenter: false, maxLevels: maxLvls, curLevel: curLvl, searchHighlight: 'none', onOpenMenu: openMenu } satisfies NodeData,
    });
    edges.push(buildEdge({
      id: `e-bi-${ci.sysId}`, source: 'center', target: ci.sysId,
      direction: 'bidirectional', serviceType: svcType,
      pendingRemoval: pendingPeerIds.has(ci.sysId),
    }, false));

    if (curLvl > 0) {
      placeChildrenRecursive(ci.sysId, pos, 'right', curLvl, childrenByNode, expandedLevels, maxDepth, openMenu, nodes, edges, placedIds);
      nodes.forEach(n => { if (!nodeL1Map.has(n.id) && n.id !== 'center') nodeL1Map.set(n.id, l1Info); });
    }
  });

  // Also register any expanded child nodes into nodeInfoMap
  // (placeChildrenRecursive already placed them as Node objects; extract info from childrenByNode)
  const addChildInfo = (parentId: string, depth: number) => {
    if (depth <= 0) return;
    for (const child of childrenByNode.get(parentId) ?? []) {
      if (!nodeInfoMap.has(child.sysId)) nodeInfoMap.set(child.sysId, { name: child.name, sysClass: child.sysClass });
      addChildInfo(child.sysId, depth - 1);
    }
  };
  for (const ci of relCIs) addChildInfo(ci.sysId, maxDepth);

  return { nodes, edges, nodeL1Map, nodeInfoMap };
}

// ─── AppNode ──────────────────────────────────────────────────────────────────
// Layout mirrors the React Flow "Action Bar Node" pattern:
//   [label — flex:1]  [+N badge]  [⋮ menu]
// The badge takes the position of a "specific action icon" (like trash), and
// the vertical ⋮ takes the position of the generic dropdown trigger.
const SEARCH_EXTRA: Record<SearchHighlight, React.CSSProperties> = {
  none:  {},
  match: { boxShadow: '0 0 0 2.5px #3B82F6, 0 0 14px 4px rgba(59,130,246,0.40)', borderColor: '#3B82F6' },
  dim:   { opacity: 0.22, filter: 'grayscale(40%)' },
};

const AppNode = memo(({ id, data }: NodeProps) => {
  const d         = data as NodeData;
  const svc       = d.serviceType === 'center' ? null : SVC_STYLE[d.serviceType as ServiceType];
  const hasExpand = d.maxLevels > 0;
  const borderClr = svc?.border ?? '#9CA3AF';
  const searchSty = SEARCH_EXTRA[d.searchHighlight ?? 'none'];

  return (
    <div style={{
      width: NW, minHeight: NH,
      background: svc?.bg ?? '#F3F4F6', border: `1.5px solid ${borderClr}`,
      borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 2,
      padding: '5px 4px 5px 8px',
      cursor: 'grab', userSelect: 'none', overflow: 'hidden',
      transition: 'opacity 0.2s, box-shadow 0.2s, filter 0.2s',
      ...searchSty,
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
      width: CW, minHeight: CH,
      background: '#1D4ED8', border: '2px solid #1E40AF', borderRadius: 10,
      display: 'flex', alignItems: 'center', gap: 2,
      padding: '5px 4px 5px 8px',
      cursor: 'grab', userSelect: 'none', boxShadow: '0 2px 12px rgba(29,78,216,0.35)',
    }}>
      <Handle type="target" position={Position.Left}  style={HANDLE_STYLE} />
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} />
      <span style={{
        flex: 1,
        fontSize: 12, fontWeight: 600, color: '#fff',
        fontFamily: 'system-ui,-apple-system,sans-serif',
        whiteSpace: 'normal', wordBreak: 'break-word',
        lineHeight: '1.35', textAlign: 'center',
        pointerEvents: 'none',
      }}>{d.label}</span>
      <button
        className="nodrag flex-shrink-0 p-0.5 rounded opacity-40 hover:opacity-100 hover:bg-white/20 text-white transition-opacity"
        style={{ lineHeight: 0 }}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); d.onOpenMenu(id, d.label, true, e); }}
        title="Hub actions"
      ><MoreVertical size={13} /></button>
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

interface MenuPermissions {
  loading: boolean;
  canEdit: boolean;
  canRemove: boolean;
  removing: boolean;
  removeError: string;
}

// ─── DiagramFlow ──────────────────────────────────────────────────────────────
function DiagramFlow({
  filters, nodeSearch = '', selectedApp, onSelectApp, pendingRefreshKey = 0,
  canEditCenterRecord = false, onEditRelationships, onEditCiDetails, onRelationshipMutations,
}: Props) {
  const { setCenter, getZoom } = useReactFlow();

  const [nodeMenu,        setNodeMenu]        = useState<MenuState | null>(null);
  const [menuPermissions, setMenuPermissions] = useState<MenuPermissions | null>(null);
  const [relCIs,          setRelCIs]          = useState<RelCI[]>([]);
  const [childrenByNode,  setChildrenByNode]  = useState<Map<string, RelCI[]>>(new Map());
  const [expandedLevels,  setExpandedLevels]  = useState<Record<string, number>>({});
  const [maxDepth,        setMaxDepth]        = useState<number>(DEFAULT_DEPTH);
  const [loading,         setLoading]         = useState(false);
  const [pendingPeerIds,  setPendingPeerIds]  = useState<Set<string>>(new Set());
  const [nodes, setNodes, onNodesChange]      = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange]      = useEdgesState<Edge>([]);

  // Stable refs for callbacks that need current state
  const relCIsRef        = useRef<RelCI[]>([]);
  const childrenRef      = useRef(new Map<string, RelCI[]>());
  const onSelectAppRef   = useRef<typeof onSelectApp>(onSelectApp);
  const nodeL1MapRef     = useRef(new Map<string, { direction: Direction; svcType: ServiceType }>());
  const nodeInfoMapRef   = useRef(new Map<string, { name: string; sysClass: string }>());
  const nodeSearchRef    = useRef(nodeSearch);
  const focusNodeIdRef   = useRef<string | null>(null);
  useEffect(() => { relCIsRef.current      = relCIs; },         [relCIs]);
  useEffect(() => { childrenRef.current    = childrenByNode; }, [childrenByNode]);
  useEffect(() => { onSelectAppRef.current = onSelectApp; },    [onSelectApp]);
  useEffect(() => { nodeSearchRef.current  = nodeSearch; },     [nodeSearch]);

  const onRelationshipMutationsRef = useRef(onRelationshipMutations);
  useEffect(() => { onRelationshipMutationsRef.current = onRelationshipMutations; }, [onRelationshipMutations]);

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

  const closeMenu  = useCallback(() => {
    setNodeMenu(null);
    setMenuPermissions(null);
  }, []);

  // ── Menu permissions (edit CI + remove relationship) ───────────────────────
  useEffect(() => {
    if (!nodeMenu) {
      setMenuPermissions(null);
      return;
    }

    if (nodeMenu.isCenter) {
      setMenuPermissions({
        loading: false,
        canEdit: canEditCenterRecord,
        canRemove: false,
        removing: false,
        removeError: '',
      });
      return;
    }

    let cancelled = false;
    const nodeId = nodeMenu.nodeId;
    const info = nodeInfoMapRef.current.get(nodeId);
    const table = info?.sysClass || 'cmdb_ci_service';
    const centerSysId = selectedApp?.sysId ?? '';

    setMenuPermissions({
      loading: true,
      canEdit: false,
      canRemove: false,
      removing: false,
      removeError: '',
    });

    (async () => {
      const isL1Peer = isDirectCenterPeer(nodeId, relCIsRef.current);

      try {
        const [access, rels, pendingRes] = await Promise.all([
          fetchFieldAccess(table, nodeId, ['name']),
          isL1Peer && centerSysId ? loadAppRelationships(nodeId) : Promise.resolve([]),
          fetchRelationshipChangesForApp(nodeId),
        ]);

        if (cancelled) return;

        const canEdit = canEditRecord(access);
        const pending = pendingRes.result ?? [];
        const linkRels = isL1Peer
          ? rels.filter(r => r.otherAppSysId === centerSysId)
          : [];
        const canRemove = canEdit && isL1Peer && linkRels.some(r => !canRemoveRelationship(r, pending));

        setMenuPermissions({
          loading: false,
          canEdit,
          canRemove,
          removing: false,
          removeError: '',
        });
      } catch {
        if (!cancelled) {
          setMenuPermissions({
            loading: false,
            canEdit: false,
            canRemove: false,
            removing: false,
            removeError: '',
          });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [nodeMenu, canEditCenterRecord, selectedApp?.sysId]);

  const handleRemoveRelationship = useCallback(async () => {
    if (!nodeMenu || nodeMenu.isCenter) return;

    const nodeId = nodeMenu.nodeId;
    const centerSysId = selectedApp?.sysId;
    if (!centerSysId || !isDirectCenterPeer(nodeId, relCIsRef.current)) return;

    const partnerSysId = centerSysId;

    setMenuPermissions(prev => prev
      ? { ...prev, removing: true, removeError: '' }
      : { loading: false, canEdit: false, canRemove: true, removing: true, removeError: '' },
    );

    try {
      const [rels, { result: pending }] = await Promise.all([
        loadAppRelationships(nodeId),
        fetchRelationshipChangesForApp(nodeId),
      ]);

      const linkRels = rels.filter(r => r.otherAppSysId === partnerSysId);
      const removable = linkRels.filter(r => canRemoveRelationship(r, pending) === null);

      if (!removable.length) {
        setMenuPermissions(prev => prev
          ? { ...prev, removing: false, removeError: 'No removable relationship found.' }
          : null,
        );
        return;
      }

      const mutations: RelationshipMutation[] = [];
      const biRel = removable.find(r => r.direction === 'bidirectional');

      if (biRel && biRel.relationshipSysIds.length >= 2) {
        const res = await requestRelationshipDelete({
          source_ci_sys_id: nodeId,
          relationship_sys_ids: biRel.relationshipSysIds,
          direction: 'bidirectional',
        });
        if (!res.ok) {
          setMenuPermissions(prev => prev
            ? { ...prev, removing: false, removeError: res.error }
            : null,
          );
          return;
        }
        mutations.push({ changeSysId: res.change.sys_id, action: 'delete' });
      } else {
        for (const rel of removable) {
          const res = await requestRelationshipDelete({
            source_ci_sys_id: nodeId,
            relationship_sys_ids: rel.relationshipSysIds?.length ? rel.relationshipSysIds : [rel.sysId],
            direction: rel.direction,
          });
          if (!res.ok) {
            setMenuPermissions(prev => prev
              ? { ...prev, removing: false, removeError: res.error }
              : null,
            );
            return;
          }
          mutations.push({ changeSysId: res.change.sys_id, action: 'delete' });
        }
      }

      closeMenu();
      onRelationshipMutationsRef.current?.(mutations);
    } catch {
      setMenuPermissions(prev => prev
        ? { ...prev, removing: false, removeError: 'Failed to request relationship removal.' }
        : null,
      );
    }
  }, [nodeMenu, selectedApp?.sysId, closeMenu]);

  const setLevel   = useCallback((nodeId: string, lvl: number) => {
    if (lvl > 0) focusNodeIdRef.current = nodeId;
    setExpandedLevels(prev => ({ ...prev, [nodeId]: lvl }));
    setNodeMenu(null);
  }, []);

  // ── Pending removal edges (center ↔ L1 peer) ───────────────────────────────
  useEffect(() => {
    const sysId = selectedApp?.sysId;
    if (!sysId) { setPendingPeerIds(new Set()); return; }

    fetchRelationshipChangesForApp(sysId)
      .then(({ result }) => setPendingPeerIds(pendingRemovalPeerIds(sysId, result)))
      .catch(() => setPendingPeerIds(new Set()));
  }, [selectedApp?.sysId, pendingRefreshKey]);

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

    const { nodes: n, edges: e, nodeL1Map, nodeInfoMap } = buildDiagram(
      relCIs, childrenByNode, expandedLevels, maxDepth, selectedApp, openMenu, pendingPeerIds,
    );
    nodeL1MapRef.current   = nodeL1Map;
    nodeInfoMapRef.current = nodeInfoMap;

    // Apply active search highlight immediately so rebuild doesn't reset glow/dim
    const q = nodeSearchRef.current.trim().toLowerCase();
    const styledNodes = q
      ? n.map(node => {
          if (node.id === 'center') return node;
          const label = ((node.data as NodeData).label as string).toLowerCase();
          const sh: SearchHighlight = label.includes(q) ? 'match' : 'none';
          return { ...node, data: { ...node.data, searchHighlight: sh } };
        })
      : n;
    setNodes(styledNodes);
    setEdges(e);

    const focusId = focusNodeIdRef.current;
    if (focusId) {
      focusNodeIdRef.current = null;
      const target = styledNodes.find(n => n.id === focusId);
      if (target) {
        setTimeout(() => setCenter(target.position.x, target.position.y, { zoom: getZoom(), duration: 420 }), 80);
      }
    } else if (isNewApp) {
      const zoom = Math.max(0.5, 1.1 - relCIs.length * 0.035);
      setTimeout(() => setCenter(CENTER_X, CENTER_Y, { zoom, duration: 420 }), 80);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relCIs, childrenByNode, expandedLevels, maxDepth, selectedApp?.sysId, pendingPeerIds]);

  // ── Search: glow matches, dim non-matches (preserve positions) ───────────
  useEffect(() => {
    const q = nodeSearch.trim().toLowerCase();
    setNodes(prev => prev.map(node => {
      if (node.id === 'center') return node;
      const label = ((node.data as NodeData).label as string).toLowerCase();
      const sh: SearchHighlight = q && label.includes(q) ? 'match' : 'none';
      if ((node.data as NodeData).searchHighlight === sh) return node;
      return { ...node, data: { ...node.data, searchHighlight: sh } };
    }));
  }, [nodeSearch, setNodes]);

  // ── Filter changes: update hidden only (preserve drag positions) ──────────
  useEffect(() => {
    setNodes(prev => prev.map(node => {
      if (node.id === 'center') return node;
      const l1Info = nodeL1MapRef.current.get(node.id);
      if (!l1Info) return node;
      const svcType = (node.data as NodeData).serviceType;
      if (svcType === 'center') return node;
      const newHidden = !(filters[l1Info.direction] && filters[svcType as ServiceType]);
      if (node.hidden === newHidden) return node;
      return { ...node, hidden: newHidden };
    }));
    setEdges(prev => prev.map(edge => {
      const sourceL1 = nodeL1MapRef.current.get(edge.source);
      const targetL1 = nodeL1MapRef.current.get(edge.target);
      const l1Info   = sourceL1 ?? targetL1;
      if (!l1Info) return edge;
      const svcType = ((edge.data as { serviceType?: ServiceType })?.serviceType) ?? l1Info.svcType;
      const newHidden = !(filters[l1Info.direction] && filters[svcType]);
      if (edge.hidden === newHidden) return edge;
      return { ...edge, hidden: newHidden };
    }));
  }, [filters, setNodes, setEdges]);

  // ─── Render ────────────────────────────────────────────────────────────────
  // How many levels can the currently-hovered node expand?
  const menuNodeMaxLvl  = nodeMenu && !nodeMenu.isCenter
    ? getSubtreeDepth(nodeMenu.nodeId, childrenRef.current, maxDepth)
    : 0;
  const menuNodeCurLvl  = nodeMenu ? (expandedLevels[nodeMenu.nodeId] ?? 0) : 0;
  const isL1Node        = nodeMenu ? relCIsRef.current.some(r => r.sysId === nodeMenu.nodeId) : false;

  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: 400 }}>

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
            {!nodeMenu.isCenter && (
              <MI
                icon={<Eye size={14} className="text-gray-400" />}
                label="View Application Details"
                onClick={() => {
                  const info = nodeInfoMapRef.current.get(nodeMenu.nodeId);
                  if (info && onSelectAppRef.current) {
                    onSelectAppRef.current({
                      id: nodeMenu.nodeId, name: info.name, sysId: nodeMenu.nodeId,
                      table: info.sysClass || 'cmdb_ci_service',
                      app: info.name, dept: '', env: '', status: '',
                      incidents: 0, changes: 0, criticality: '', servers: 0, lastUpdated: '',
                    });
                  }
                  closeMenu();
                }}
              />
            )}

            {/* Open in ServiceNow — available for all nodes */}
            {(() => {
              const info     = nodeInfoMapRef.current.get(nodeMenu.nodeId);
              const sysId    = nodeMenu.isCenter ? selectedApp?.sysId  : nodeMenu.nodeId;
              const table    = nodeMenu.isCenter ? (selectedApp?.table || 'cmdb_ci_service') : (info?.sysClass || 'cmdb_ci_service');
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

            {nodeMenu.isCenter ? (
              menuPermissions?.canEdit && selectedApp?.sysId && (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  <MI icon={<Network size={14} className="text-blue-500" />} label="Edit Relationships"
                      onClick={() => {
                        onEditRelationships({ sysId: selectedApp.sysId!, name: selectedApp.name });
                        closeMenu();
                      }} />
                  <MI icon={<Edit2 size={14} className="text-gray-400" />} label="Edit CI Details"
                      onClick={() => {
                        onEditCiDetails({
                          sysId: selectedApp.sysId!,
                          name: selectedApp.name,
                          table: selectedApp.table ?? 'cmdb_ci_service',
                        });
                        closeMenu();
                      }} />
                </>
              )
            ) : (
              <>
                {menuPermissions?.loading && (
                  <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
                    <Loader2 size={12} className="animate-spin" /> Checking permissions…
                  </div>
                )}
                {!menuPermissions?.loading && menuPermissions?.canEdit && (() => {
                  const info = nodeInfoMapRef.current.get(nodeMenu.nodeId);
                  const table = info?.sysClass || 'cmdb_ci_service';
                  return (
                    <>
                      <div className="border-t border-gray-100 my-1" />
                      <MI icon={<Network size={14} className="text-blue-500" />} label="Edit Relationships"
                          onClick={() => {
                            onEditRelationships({ sysId: nodeMenu.nodeId, name: nodeMenu.label });
                            closeMenu();
                          }} />
                      <MI icon={<Edit2 size={14} className="text-gray-400" />} label="Edit CI Details"
                          onClick={() => {
                            onEditCiDetails({
                              sysId: nodeMenu.nodeId,
                              name: nodeMenu.label,
                              table,
                            });
                            closeMenu();
                          }} />
                    </>
                  );
                })()}
                {!menuPermissions?.loading && menuPermissions?.canRemove && (
                  <>
                    <div className="border-t border-gray-100 my-1" />
                    <MI
                      icon={menuPermissions.removing
                        ? <Loader2 size={14} className="text-red-400 animate-spin" />
                        : <Trash2 size={14} className="text-red-400" />}
                      label={menuPermissions.removing ? 'Requesting removal…' : 'Remove Relationship'}
                      onClick={() => { if (!menuPermissions.removing) void handleRemoveRelationship(); }}
                      danger
                    />
                    {menuPermissions.removeError && (
                      <p className="px-3 py-1.5 text-[11px] text-red-600 leading-snug">{menuPermissions.removeError}</p>
                    )}
                  </>
                )}
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

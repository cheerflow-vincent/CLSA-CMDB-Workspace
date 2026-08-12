import { queryTable } from '../../api/servicenow';
import { getAppRelationshipTypes } from './appRelationshipTypes';
import { raw, str } from './viewFields';

export type RelationshipDirection = 'upstream' | 'downstream' | 'bidirectional';

export interface LiveRelationship {
  sysId: string;
  /** cmdb_rel_ci sys_ids — one for uni-directional, two for bi-directional. */
  relationshipSysIds: string[];
  otherAppSysId: string;
  otherAppName: string;
  direction: RelationshipDirection;
  relType: string;
  parentCi: string;
  childCi: string;
}

const sn = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'value' in v)
    return String((v as Record<string, unknown>).value ?? '');
  return String(v);
};

function classifyDirection(
  centerSysId: string,
  parentCi: string,
  childCi: string,
  upSet: Set<string>,
  dnSet: Set<string>,
): RelationshipDirection {
  const otherId = parentCi === centerSysId ? childCi : parentCi;
  if (upSet.has(otherId) && dnSet.has(otherId)) return 'bidirectional';
  if (upSet.has(otherId)) return 'upstream';
  return 'downstream';
}

/** Row-level relationships for edit modal and change tracking. */
export async function loadAppRelationships(centerSysId: string): Promise<LiveRelationship[]> {
  const { typeQuery } = await getAppRelationshipTypes();
  const [{ result: asParent = [] }, { result: asChild = [] }] = await Promise.all([
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${typeQuery}^parent.sys_id=${centerSysId}`,
      fields: ['sys_id', 'child.sys_id', 'child.name', 'type.name', 'parent.sys_id', 'child.sys_id'],
      limit: 300,
    }),
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${typeQuery}^child.sys_id=${centerSysId}`,
      fields: ['sys_id', 'parent.sys_id', 'parent.name', 'type.name', 'parent.sys_id', 'child.sys_id'],
      limit: 300,
    }),
  ]);

  const upSet = new Set<string>();
  const dnSet = new Set<string>();
  const rows: Omit<LiveRelationship, 'direction' | 'relationshipSysIds'>[] = [];

  for (const r of asParent) {
    const childId = sn(r['child.sys_id']);
    if (!childId || childId === centerSysId) continue;
    dnSet.add(childId);
    const relType = sn(r['type.name']);
    const sysId = sn(r.sys_id);
    rows.push({
      sysId,
      otherAppSysId: childId,
      otherAppName: sn(r['child.name']),
      relType,
      parentCi: centerSysId,
      childCi: childId,
    });
  }

  for (const r of asChild) {
    const parentId = sn(r['parent.sys_id']);
    if (!parentId || parentId === centerSysId) continue;
    upSet.add(parentId);
    const relType = sn(r['type.name']);
    const sysId = sn(r.sys_id);
    rows.push({
      sysId,
      otherAppSysId: parentId,
      otherAppName: sn(r['parent.name']),
      relType,
      parentCi: parentId,
      childCi: centerSysId,
    });
  }

  const classified = rows.map(row => ({
    ...row,
    relationshipSysIds: [row.sysId],
    direction: classifyDirection(centerSysId, row.parentCi, row.childCi, upSet, dnSet),
  }));

  return consolidateLiveRelationships(classified);
}

/** Merge bi-directional cmdb_rel_ci pairs into one logical row per peer + type. */
export function consolidateLiveRelationships(rels: LiveRelationship[]): LiveRelationship[] {
  const uni: LiveRelationship[] = [];
  const biMap = new Map<string, LiveRelationship>();

  for (const rel of rels) {
    if (rel.direction !== 'bidirectional') {
      uni.push({ ...rel, relationshipSysIds: rel.relationshipSysIds?.length ? rel.relationshipSysIds : [rel.sysId] });
      continue;
    }
    const key = `${rel.otherAppSysId}\0${rel.relType}`;
    const existing = biMap.get(key);
    if (!existing) {
      biMap.set(key, { ...rel, relationshipSysIds: [...rel.relationshipSysIds] });
      continue;
    }
    for (const id of rel.relationshipSysIds) {
      if (!existing.relationshipSysIds.includes(id)) existing.relationshipSysIds.push(id);
    }
  }

  return [...uni, ...biMap.values()];
}

/** Collapsed peer list for diagram (one entry per peer CI). */
export interface RelCIPeer {
  sysId: string;
  name: string;
  sysClass: string;
  /** From app.department.description — drives Platform / Infrastructure / Business legend. */
  departmentDescription: string;
  direction: RelationshipDirection;
}

export async function loadAppRelationshipPeers(centerSysId: string): Promise<RelCIPeer[]> {
  const { typeQuery } = await getAppRelationshipTypes();
  const [{ result: asParent = [] }, { result: asChild = [] }] = await Promise.all([
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${typeQuery}^parent.sys_id=${centerSysId}`,
      fields: ['child.sys_id', 'child.name', 'child.sys_class_name', 'child.department.description'],
      limit: 300,
      displayValue: 'all',
    }),
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${typeQuery}^child.sys_id=${centerSysId}`,
      fields: ['parent.sys_id', 'parent.name', 'parent.sys_class_name', 'parent.department.description'],
      limit: 300,
      displayValue: 'all',
    }),
  ]);

  const upSet = new Set<string>();
  const dnSet = new Set<string>();
  const ciMap = new Map<string, { name: string; cls: string; deptDesc: string }>();

  for (const r of asParent) {
    const id = raw(r['child.sys_id']);
    if (!id || id === centerSysId) continue;
    ciMap.set(id, {
      name: str(r['child.name']),
      cls: raw(r['child.sys_class_name']),
      deptDesc: str(r['child.department.description']),
    });
    dnSet.add(id);
  }
  for (const r of asChild) {
    const id = raw(r['parent.sys_id']);
    if (!id || id === centerSysId) continue;
    ciMap.set(id, {
      name: str(r['parent.name']),
      cls: raw(r['parent.sys_class_name']),
      deptDesc: str(r['parent.department.description']),
    });
    upSet.add(id);
  }

  return [...ciMap.entries()].map(([id, { name, cls, deptDesc }]) => ({
    sysId: id,
    name,
    sysClass: cls,
    departmentDescription: deptDesc,
    direction: upSet.has(id) && dnSet.has(id) ? 'bidirectional' : upSet.has(id) ? 'upstream' : 'downstream',
  }));
}

import { queryTable } from '../../api/servicenow';
import type { RelTypeChoice } from './relationshipTypeMap';
import { IMPACT_REL_TYPE, DATA_FLOW_REL_TYPE } from './relationshipTypeMap';

export type RelationshipDirection = 'upstream' | 'downstream' | 'bidirectional';

export interface LiveRelationship {
  sysId: string;
  otherAppSysId: string;
  otherAppName: string;
  direction: RelationshipDirection;
  relType: RelTypeChoice;
  parentCi: string;
  childCi: string;
}

export const IMP_TYPE = IMPACT_REL_TYPE;
export const RDF_TYPE = DATA_FLOW_REL_TYPE;

const TYPE_Q = `type.nameIN${IMP_TYPE},${RDF_TYPE}`;

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
  const [{ result: asParent = [] }, { result: asChild = [] }] = await Promise.all([
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^parent.sys_id=${centerSysId}`,
      fields: ['sys_id', 'child.sys_id', 'child.name', 'type.name', 'parent.sys_id', 'child.sys_id'],
      limit: 300,
    }),
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^child.sys_id=${centerSysId}`,
      fields: ['sys_id', 'parent.sys_id', 'parent.name', 'type.name', 'parent.sys_id', 'child.sys_id'],
      limit: 300,
    }),
  ]);

  const upSet = new Set<string>();
  const dnSet = new Set<string>();
  const rows: Omit<LiveRelationship, 'direction'>[] = [];

  for (const r of asParent) {
    const childId = sn(r['child.sys_id']);
    if (!childId || childId === centerSysId) continue;
    dnSet.add(childId);
    const relType = sn(r['type.name']);
    rows.push({
      sysId: sn(r.sys_id),
      otherAppSysId: childId,
      otherAppName: sn(r['child.name']),
      relType: (relType === RDF_TYPE ? RDF_TYPE : IMP_TYPE) as RelTypeChoice,
      parentCi: centerSysId,
      childCi: childId,
    });
  }

  for (const r of asChild) {
    const parentId = sn(r['parent.sys_id']);
    if (!parentId || parentId === centerSysId) continue;
    upSet.add(parentId);
    const relType = sn(r['type.name']);
    rows.push({
      sysId: sn(r.sys_id),
      otherAppSysId: parentId,
      otherAppName: sn(r['parent.name']),
      relType: (relType === RDF_TYPE ? RDF_TYPE : IMP_TYPE) as RelTypeChoice,
      parentCi: parentId,
      childCi: centerSysId,
    });
  }

  return rows.map(row => ({
    ...row,
    direction: classifyDirection(centerSysId, row.parentCi, row.childCi, upSet, dnSet),
  }));
}

/** Collapsed peer list for diagram (one entry per peer CI). */
export interface RelCIPeer {
  sysId: string;
  name: string;
  sysClass: string;
  direction: RelationshipDirection;
}

export async function loadAppRelationshipPeers(centerSysId: string): Promise<RelCIPeer[]> {
  const [{ result: asParent = [] }, { result: asChild = [] }] = await Promise.all([
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^parent.sys_id=${centerSysId}`,
      fields: ['child.sys_id', 'child.name', 'child.sys_class_name'],
      limit: 300,
    }),
    queryTable<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: `${TYPE_Q}^child.sys_id=${centerSysId}`,
      fields: ['parent.sys_id', 'parent.name', 'parent.sys_class_name'],
      limit: 300,
    }),
  ]);

  const upSet = new Set<string>();
  const dnSet = new Set<string>();
  const ciMap = new Map<string, { name: string; cls: string }>();

  for (const r of asParent) {
    const id = sn(r['child.sys_id']);
    if (!id || id === centerSysId) continue;
    ciMap.set(id, { name: sn(r['child.name']), cls: sn(r['child.sys_class_name']) });
    dnSet.add(id);
  }
  for (const r of asChild) {
    const id = sn(r['parent.sys_id']);
    if (!id || id === centerSysId) continue;
    ciMap.set(id, { name: sn(r['parent.name']), cls: sn(r['parent.sys_class_name']) });
    upSet.add(id);
  }

  return [...ciMap.entries()].map(([id, { name, cls }]) => ({
    sysId: id,
    name,
    sysClass: cls,
    direction: upSet.has(id) && dnSet.has(id) ? 'bidirectional' : upSet.has(id) ? 'upstream' : 'downstream',
  }));
}

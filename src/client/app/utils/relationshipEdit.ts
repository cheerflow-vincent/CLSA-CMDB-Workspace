import type { RelationshipChangeRequest } from '../../api/servicenow';
import type { LiveRelationship, RelationshipDirection } from './appRelationships';
import { relKey, resolveParentChild } from './relationshipTypeMap';

export interface DraftAdd {
  id: string;
  otherAppSysId: string;
  otherAppName: string;
  direction: RelationshipDirection;
  relType: string;
}

export interface DirectionGroup {
  existing: LiveRelationship[];
  draftRemovals: LiveRelationship[];
  draftAdds: DraftAdd[];
  serverPendingRemovals: LiveRelationship[];
}

export type DirectionGroups = Record<RelationshipDirection, DirectionGroup>;

let draftIdCounter = 0;
export function nextDraftId(): string {
  draftIdCounter += 1;
  return `draft-${draftIdCounter}`;
}

export function emptyDirectionGroup(): DirectionGroup {
  return { existing: [], draftRemovals: [], draftAdds: [], serverPendingRemovals: [] };
}

/** Parse relationship list field (comma-separated sys_ids) from API row. */
export function relationshipSysIdsFromChange(change: RelationshipChangeRequest): string[] {
  if (change.relationship_sys_ids?.length) return change.relationship_sys_ids;
  if (!change.relationship_sys_id) return [];
  return change.relationship_sys_id.split(',').map(s => s.trim()).filter(Boolean);
}

function pendingDeleteRelIds(pendingChanges: RelationshipChangeRequest[]): Set<string> {
  const ids = new Set<string>();
  for (const c of pendingChanges) {
    if (c.action !== 'delete' || c.state !== 'pending_approval') continue;
    for (const id of relationshipSysIdsFromChange(c)) ids.add(id);
  }
  return ids;
}

function relMatchesPendingDelete(rel: LiveRelationship, pendingIds: Set<string>): boolean {
  const relIds = rel.relationshipSysIds?.length ? rel.relationshipSysIds : [rel.sysId];
  return relIds.some(id => pendingIds.has(id));
}

export function buildInitialGroups(
  live: LiveRelationship[],
  pendingChanges: RelationshipChangeRequest[],
): DirectionGroups {
  const pendingDeleteIds = pendingDeleteRelIds(pendingChanges);

  const groups: DirectionGroups = {
    upstream: emptyDirectionGroup(),
    downstream: emptyDirectionGroup(),
    bidirectional: emptyDirectionGroup(),
  };

  for (const rel of live) {
    const bucket = groups[rel.direction];
    if (relMatchesPendingDelete(rel, pendingDeleteIds)) {
      bucket.serverPendingRemovals.push(rel);
    } else {
      bucket.existing.push(rel);
    }
  }

  return groups;
}

export function groupHasChanges(g: DirectionGroup): boolean {
  return g.draftRemovals.length > 0 || g.draftAdds.length > 0;
}

export function allGroupsHaveChanges(groups: DirectionGroups): boolean {
  return Object.values(groups).some(groupHasChanges);
}

export function countDraftRemovals(groups: DirectionGroups): number {
  return Object.values(groups).reduce((n, g) => n + g.draftRemovals.length, 0);
}

export function countDraftAdds(groups: DirectionGroups): number {
  return Object.values(groups).reduce((n, g) => n + g.draftAdds.length, 0);
}

function activeRelKeys(
  live: LiveRelationship[],
  pendingChanges: RelationshipChangeRequest[],
  draftRemovals: LiveRelationship[],
  draftAdds: DraftAdd[],
  sourceCi: string,
): Set<string> {
  const removalIds = new Set(
    draftRemovals.flatMap(r => (r.relationshipSysIds?.length ? r.relationshipSysIds : [r.sysId])),
  );
  const pendingDeleteIds = pendingDeleteRelIds(pendingChanges);

  const keys = new Set<string>();

  for (const rel of live) {
    const relIds = rel.relationshipSysIds?.length ? rel.relationshipSysIds : [rel.sysId];
    if (relIds.some(id => removalIds.has(id) || pendingDeleteIds.has(id))) continue;
    keys.add(relKey(rel.parentCi, rel.childCi, rel.relType));
  }

  for (const add of draftAdds) {
    const mapped = resolveParentChild(sourceCi, add.otherAppSysId, add.direction, add.relType);
    keys.add(relKey(mapped.parentCi, mapped.childCi, add.relType));
  }

  return keys;
}

export function canAddRelationship(
  sourceCi: string,
  add: DraftAdd,
  live: LiveRelationship[],
  pendingChanges: RelationshipChangeRequest[],
  allDraftRemovals: LiveRelationship[],
  allDraftAdds: DraftAdd[],
  /** Draft ids to ignore when checking duplicates (the add under validation). */
  excludeDraftIds: string[] = [],
): string | null {
  if (add.otherAppSysId === sourceCi) return 'Cannot relate an application to itself.';

  const mapped = resolveParentChild(sourceCi, add.otherAppSysId, add.direction, add.relType);
  const key = relKey(mapped.parentCi, mapped.childCi, add.relType);
  const draftAddsForCheck = excludeDraftIds.length
    ? allDraftAdds.filter(a => !excludeDraftIds.includes(a.id))
    : allDraftAdds;
  const active = activeRelKeys(live, pendingChanges, allDraftRemovals, draftAddsForCheck, sourceCi);

  if (active.has(key)) return 'Relationship already exists or is already in this draft.';

  const pendingDelete = pendingChanges.some(
    c => c.action === 'delete'
      && c.state === 'pending_approval'
      && c.parent_ci_sys_id === mapped.parentCi
      && c.child_ci_sys_id === mapped.childCi
      && c.rel_type === add.relType,
  );
  if (pendingDelete) return 'A pending delete exists for this relationship — approve or reject it first.';

  return null;
}

export function canRemoveRelationship(
  rel: LiveRelationship,
  pendingChanges: RelationshipChangeRequest[],
): string | null {
  const pendingIds = pendingDeleteRelIds(pendingChanges);
  if (relMatchesPendingDelete(rel, pendingIds)) return 'Already pending approval for removal.';
  return null;
}

export interface SubmitItemCreate {
  kind: 'create';
  source_ci_sys_id: string;
  target_ci_sys_id: string;
  direction: RelationshipDirection;
  rel_type: string;
}

export interface SubmitItemDelete {
  kind: 'delete';
  source_ci_sys_id: string;
  relationship_sys_ids: string[];
  direction: RelationshipDirection;
  rel: LiveRelationship;
}

export type SubmitItem = SubmitItemCreate | SubmitItemDelete;

export function buildSubmitBatch(
  sourceCi: string,
  groups: DirectionGroups,
): SubmitItem[] {
  const items: SubmitItem[] = [];

  for (const dir of ['upstream', 'downstream', 'bidirectional'] as RelationshipDirection[]) {
    const g = groups[dir];
    for (const add of g.draftAdds) {
      items.push({
        kind: 'create',
        source_ci_sys_id: sourceCi,
        target_ci_sys_id: add.otherAppSysId,
        direction: add.direction,
        rel_type: add.relType,
      });
    }
    for (const rel of g.draftRemovals) {
      items.push({
        kind: 'delete',
        source_ci_sys_id: sourceCi,
        relationship_sys_ids: rel.relationshipSysIds?.length ? rel.relationshipSysIds : [rel.sysId],
        direction: rel.direction,
        rel,
      });
    }
  }

  return items;
}

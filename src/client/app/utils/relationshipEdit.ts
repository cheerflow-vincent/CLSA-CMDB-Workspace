import type { RelationshipChangeRequest } from '../../api/servicenow';
import type { LiveRelationship, RelationshipDirection } from './appRelationships';
import type { RelTypeChoice } from './relationshipTypeMap';
import { relKey, resolveParentChild } from './relationshipTypeMap';

export interface DraftAdd {
  id: string;
  otherAppSysId: string;
  otherAppName: string;
  direction: RelationshipDirection;
  relType: RelTypeChoice;
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

export function buildInitialGroups(
  live: LiveRelationship[],
  pendingChanges: RelationshipChangeRequest[],
): DirectionGroups {
  const pendingDeleteRelIds = new Set(
    pendingChanges
      .filter(c => c.action === 'delete' && c.state === 'pending_approval' && c.relationship_sys_id)
      .map(c => c.relationship_sys_id),
  );

  const groups: DirectionGroups = {
    upstream: emptyDirectionGroup(),
    downstream: emptyDirectionGroup(),
    bidirectional: emptyDirectionGroup(),
  };

  for (const rel of live) {
    const bucket = groups[rel.direction];
    if (pendingDeleteRelIds.has(rel.sysId)) {
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
  const removalIds = new Set(draftRemovals.map(r => r.sysId));
  const pendingDeleteIds = new Set(
    pendingChanges
      .filter(c => c.action === 'delete' && c.state === 'pending_approval')
      .map(c => c.relationship_sys_id),
  );

  const keys = new Set<string>();

  for (const rel of live) {
    if (removalIds.has(rel.sysId) || pendingDeleteIds.has(rel.sysId)) continue;
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
  const pending = pendingChanges.some(
    c => c.action === 'delete'
      && c.state === 'pending_approval'
      && c.relationship_sys_id === rel.sysId,
  );
  if (pending) return 'Already pending approval for removal.';
  return null;
}

export interface SubmitItemCreate {
  kind: 'create';
  source_ci_sys_id: string;
  target_ci_sys_id: string;
  direction: RelationshipDirection;
  rel_type: RelTypeChoice;
}

export interface SubmitItemDelete {
  kind: 'delete';
  source_ci_sys_id: string;
  relationship_sys_id: string;
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
        relationship_sys_id: rel.sysId,
        rel,
      });
    }
  }

  return items;
}

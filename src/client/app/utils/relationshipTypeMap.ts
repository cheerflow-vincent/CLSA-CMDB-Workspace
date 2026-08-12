export type RelationshipDirection = 'upstream' | 'downstream' | 'bidirectional';

/** Map center app + direction + type to cmdb_rel_ci parent/child. */
export function resolveParentChild(
  sourceCiSysId: string,
  targetCiSysId: string,
  direction: RelationshipDirection,
  _relType: string,
): { parentCi: string; childCi: string } {
  if (direction === 'downstream') {
    return { parentCi: sourceCiSysId, childCi: targetCiSysId };
  }
  if (direction === 'upstream') {
    return { parentCi: targetCiSysId, childCi: sourceCiSysId };
  }
  return { parentCi: sourceCiSysId, childCi: targetCiSysId };
}

export function relKey(parentCi: string, childCi: string, relType: string): string {
  return `${parentCi}|${childCi}|${relType}`;
}

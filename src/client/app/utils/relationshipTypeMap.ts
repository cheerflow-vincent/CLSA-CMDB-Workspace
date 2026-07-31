export const IMPACT_REL_TYPE = 'impacts::impacted by' as const;
export const DATA_FLOW_REL_TYPE = 'Receives data from::Sends data to' as const;

export type RelTypeChoice = typeof IMPACT_REL_TYPE | typeof DATA_FLOW_REL_TYPE;

export const REL_TYPE_OPTIONS: { value: RelTypeChoice; label: string }[] = [
  { value: IMPACT_REL_TYPE, label: 'Impact' },
  { value: DATA_FLOW_REL_TYPE, label: 'Data flow' },
];

export type RelationshipDirection = 'upstream' | 'downstream' | 'bidirectional';

export function relTypeLabel(relType: string): string {
  const opt = REL_TYPE_OPTIONS.find(o => o.value === relType);
  return opt?.label ?? relType;
}

/** Map center app + direction + type to cmdb_rel_ci parent/child. */
export function resolveParentChild(
  sourceCiSysId: string,
  targetCiSysId: string,
  direction: RelationshipDirection,
  _relType: RelTypeChoice,
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

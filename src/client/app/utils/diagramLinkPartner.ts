/** Direct diagram parent for a node: center for L1 peers, otherwise the expanded parent CI. */
export function findDiagramLinkPartner(
  nodeId: string,
  l1Peers: Array<{ sysId: string }>,
  childrenByNode: Map<string, Array<{ sysId: string }>>,
): string | null {
  if (l1Peers.some(p => p.sysId === nodeId)) return 'center';
  for (const [parentId, children] of childrenByNode) {
    if (children.some(c => c.sysId === nodeId)) return parentId;
  }
  return null;
}

/** True when the node is an L1 peer of the center app (not an expanded deeper hop). */
export function isDirectCenterPeer(
  nodeId: string,
  l1Peers: Array<{ sysId: string }>,
): boolean {
  return l1Peers.some(p => p.sysId === nodeId);
}

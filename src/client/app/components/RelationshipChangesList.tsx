import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, Loader2, GitBranch } from 'lucide-react';
import {
  fetchRelationshipChangesForApp,
  fetchRelationshipApprovalsForApp,
  type RelationshipChangeRequest,
  type RelationshipApprovalRecord,
} from '../../api/servicenow';
import RelationshipChangeActions, {
  RelationshipChangeStateBadge,
  RelationshipProcessingBadge,
} from './RelationshipChangeActions';
import { relTypeLabel } from '../utils/relationshipTypeMap';

interface Props {
  appSysId: string | undefined;
  appName?: string;
  isOpen: boolean;
  onToggle: () => void;
  refreshKey?: number;
  processingChangeIds?: string[];
  onProcessingStart?: (changeSysId: string) => void;
  onChanged?: (options?: { refreshDiagram?: boolean }) => void;
}

function peerName(row: RelationshipChangeRequest, appSysId: string): string {
  if (row.source_ci_sys_id === appSysId) return row.target_ci_name || row.target_ci_sys_id;
  return row.source_ci_name || row.source_ci_sys_id;
}

export default function RelationshipChangesList({
  appSysId,
  isOpen,
  onToggle,
  refreshKey = 0,
  processingChangeIds = [],
  onProcessingStart,
  onChanged,
}: Props) {
  const [rows, setRows] = useState<RelationshipChangeRequest[]>([]);
  const [approvals, setApprovals] = useState<RelationshipApprovalRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [localProcessingIds, setLocalProcessingIds] = useState<string[]>([]);

  const processingSet = useMemo(() => {
    return new Set([...processingChangeIds, ...localProcessingIds]);
  }, [processingChangeIds, localProcessingIds]);

  const approvalByDocumentId = useMemo(() => {
    const map = new Map<string, RelationshipApprovalRecord>();
    for (const a of approvals) {
      if (a.document_id) map.set(a.document_id, a);
    }
    return map;
  }, [approvals]);

  const reload = useCallback(() => {
    if (!appSysId) {
      setRows([]);
      setApprovals([]);
      return;
    }
    setLoading(true);
    Promise.all([
      fetchRelationshipChangesForApp(appSysId),
      fetchRelationshipApprovalsForApp(appSysId),
    ])
      .then(([changes, approvalRes]) => {
        setRows(changes.result);
        setApprovals(approvalRes.result);
      })
      .catch(() => {
        setRows([]);
        setApprovals([]);
      })
      .finally(() => setLoading(false));
  }, [appSysId]);

  useEffect(() => {
    if (isOpen) reload();
  }, [isOpen, reload, refreshKey]);

  const pendingCount = rows.filter(r => r.state === 'pending_approval').length;

  const handleProcessingStart = (changeSysId: string) => {
    setLocalProcessingIds(prev => (prev.includes(changeSysId) ? prev : [...prev, changeSysId]));
    onProcessingStart?.(changeSysId);
  };

  const handleDone = () => {
    setLocalProcessingIds([]);
    reload();
    onChanged?.({ refreshDiagram: true });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left"
      >
        <div className="p-1.5 bg-amber-100 rounded flex-shrink-0">
          <GitBranch className="w-4 h-4 text-amber-700" />
        </div>
        <span className="flex-1 text-xs text-gray-700 font-medium">Relationship Changes</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        {pendingCount > 0 && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
            {pendingCount} pending
          </span>
        )}
        {!loading && pendingCount === 0 && rows.length > 0 && (
          <span className="text-[10px] text-gray-400">{rows.length} total</span>
        )}
      </button>

      {isOpen && (
        <div className="border-t border-gray-100">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-gray-400 gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="px-3 py-4 text-xs text-gray-400 italic">No relationship changes for this application.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2 font-semibold">Action</th>
                    <th className="px-3 py-2 font-semibold">Peer</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">State</th>
                    <th className="px-3 py-2 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(row => {
                    const approval = approvalByDocumentId.get(row.sys_id);
                    const isProcessing = processingSet.has(row.sys_id);
                    return (
                      <tr
                        key={row.sys_id}
                        className={row.state === 'pending_approval' || isProcessing ? 'bg-amber-50/40' : ''}
                      >
                        <td className="px-3 py-2 capitalize text-gray-700">{row.action}</td>
                        <td className="px-3 py-2 text-gray-800">{appSysId ? peerName(row, appSysId) : '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{relTypeLabel(row.rel_type)}</td>
                        <td className="px-3 py-2">
                          {isProcessing ? (
                            <RelationshipProcessingBadge compact />
                          ) : (
                            <RelationshipChangeStateBadge state={row.state} />
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {approval && !isProcessing && (
                            <RelationshipChangeActions
                              approvalSysId={approval.sys_id}
                              changeSysId={row.sys_id}
                              appSysId={appSysId}
                              enableAsyncPoll
                              onProcessingStart={handleProcessingStart}
                              onDone={handleDone}
                              compact
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, GitBranch } from 'lucide-react';
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
import { RELATED_CI_PAGE_SIZE } from '../utils/relatedCIs';

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

function PaginationBar({
  start,
  end,
  totalCount,
  page,
  pageSize,
  onPrev,
  onNext,
}: {
  start: number;
  end: number;
  totalCount: number;
  page: number;
  pageSize: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
      <span className="text-[11px] text-gray-400">
        Showing {start}–{end} of {totalCount}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={(page + 1) * pageSize >= totalCount}
          className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>
    </div>
  );
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
  const [totalCount, setTotalCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [localProcessingIds, setLocalProcessingIds] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const autoExpandedRef = useRef<string | null>(null);

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

  const actionableIds = useMemo(() => {
    return rows
      .filter(r => approvalByDocumentId.has(r.sys_id) && !processingSet.has(r.sys_id))
      .map(r => r.sys_id);
  }, [rows, approvalByDocumentId, processingSet]);

  const pageSize = RELATED_CI_PAGE_SIZE;

  const reload = useCallback(() => {
    if (!appSysId) {
      setRows([]);
      setApprovals([]);
      setTotalCount(0);
      setPendingCount(0);
      return;
    }
    setLoading(true);
    Promise.all([
      fetchRelationshipChangesForApp(appSysId, {
        limit: pageSize,
        offset: page * pageSize,
      }),
      fetchRelationshipApprovalsForApp(appSysId),
    ])
      .then(([changes, approvalRes]) => {
        setRows(changes.result);
        setTotalCount(changes.total_count ?? changes.result.length);
        setPendingCount(changes.pending_count ?? changes.result.filter(r => r.state === 'pending_approval').length);
        setApprovals(approvalRes.result);
      })
      .catch(() => {
        setRows([]);
        setApprovals([]);
        setTotalCount(0);
        setPendingCount(0);
      })
      .finally(() => setLoading(false));
  }, [appSysId, page, pageSize]);

  useEffect(() => {
    setPage(0);
    setExpandedId(null);
    autoExpandedRef.current = null;
  }, [appSysId, refreshKey]);

  useEffect(() => {
    if (isOpen) reload();
  }, [isOpen, reload]);

  useEffect(() => {
    const maxPage = Math.max(0, Math.ceil(totalCount / pageSize) - 1);
    if (page > maxPage) setPage(maxPage);
  }, [totalCount, page, pageSize]);

  useEffect(() => {
    if (actionableIds.length === 1) {
      const onlyId = actionableIds[0];
      if (autoExpandedRef.current !== onlyId) {
        autoExpandedRef.current = onlyId;
        setExpandedId(onlyId);
      }
    } else if (actionableIds.length === 0) {
      autoExpandedRef.current = null;
    } else if (expandedId && !actionableIds.includes(expandedId)) {
      setExpandedId(null);
    }
  }, [actionableIds, expandedId]);

  const start = totalCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalCount);
  const showPagination = totalCount > pageSize;

  const handleProcessingStart = (changeSysId: string) => {
    setLocalProcessingIds(prev => (prev.includes(changeSysId) ? prev : [...prev, changeSysId]));
    setExpandedId(null);
    onProcessingStart?.(changeSysId);
  };

  const handleDone = () => {
    setLocalProcessingIds([]);
    setExpandedId(null);
    reload();
    onChanged?.({ refreshDiagram: true });
  };

  const toggleExpanded = (rowId: string) => {
    setExpandedId(prev => (prev === rowId ? null : rowId));
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
        {!loading && pendingCount === 0 && totalCount > 0 && (
          <span className="text-[10px] text-gray-400">{totalCount} total</span>
        )}
      </button>

      {isOpen && (
        <div className="border-t border-gray-100">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-gray-400 gap-2 text-xs">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : totalCount === 0 ? (
            <p className="px-3 py-4 text-xs text-gray-400 italic">No relationship changes for this application.</p>
          ) : (
            <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
                    <th className="px-3 py-2 font-semibold w-8" aria-label="Expand" />
                    <th className="px-3 py-2 font-semibold">Action</th>
                    <th className="px-3 py-2 font-semibold">Peer</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 font-semibold">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(row => {
                    const approval = approvalByDocumentId.get(row.sys_id);
                    const isProcessing = processingSet.has(row.sys_id);
                    const canAct = !!approval && !isProcessing;
                    const isExpanded = expandedId === row.sys_id && canAct;

                    return (
                      <Fragment key={row.sys_id}>
                        <tr
                          className={
                            row.state === 'pending_approval' || isProcessing
                              ? 'bg-amber-50/40'
                              : ''
                          }
                        >
                          <td className="px-2 py-2 w-8">
                            {canAct ? (
                              <button
                                type="button"
                                onClick={() => toggleExpanded(row.sys_id)}
                                className="p-0.5 rounded hover:bg-amber-100 text-amber-700"
                                aria-expanded={isExpanded}
                                aria-label={isExpanded ? 'Collapse approval panel' : 'Review removal request'}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                              </button>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 capitalize text-gray-700">{row.action}</td>
                          <td className="px-3 py-2 text-gray-800">
                            {appSysId ? peerName(row, appSysId) : '—'}
                          </td>
                          <td className="px-3 py-2 text-gray-600">{relTypeLabel(row.rel_type)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {isProcessing ? (
                                <RelationshipProcessingBadge compact />
                              ) : (
                                <RelationshipChangeStateBadge state={row.state} />
                              )}
                              {canAct && !isExpanded && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(row.sys_id)}
                                  className="text-[10px] font-medium text-amber-800 underline underline-offset-2 hover:text-amber-900"
                                >
                                  Review
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && approval && (
                          <tr className="bg-amber-50/30">
                            <td colSpan={5} className="px-3 py-3 border-t border-amber-100/80">
                              <RelationshipChangeActions
                                variant="panel"
                                approvalSysId={approval.sys_id}
                                changeSysId={row.sys_id}
                                appSysId={appSysId}
                                enableAsyncPoll
                                requestedByName={row.requested_by_name}
                                requestedAt={row.requested_at}
                                onProcessingStart={handleProcessingStart}
                                onDone={handleDone}
                                onCancel={() => setExpandedId(null)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {showPagination && (
              <PaginationBar
                start={start}
                end={end}
                totalCount={totalCount}
                page={page}
                pageSize={pageSize}
                onPrev={() => {
                  setExpandedId(null);
                  setPage(p => Math.max(0, p - 1));
                }}
                onNext={() => {
                  setExpandedId(null);
                  setPage(p => p + 1);
                }}
              />
            )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

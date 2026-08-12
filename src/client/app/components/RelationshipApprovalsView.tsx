import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
import { Loader2, Clock, GitBranch, ChevronDown, ChevronRight } from 'lucide-react';
import { fetchRelationshipApprovalInbox, type RelationshipApprovalRecord } from '../../api/servicenow';
import RelationshipChangeActions, {
  RelationshipChangeStateBadge,
  RelationshipProcessingBadge,
} from './RelationshipChangeActions';
import { relTypeLabel } from '../utils/appRelationshipTypes';

interface Props {
  onNavigateToApp?: (sysId: string) => void;
}

function AppNameLink({
  sysId,
  name,
  onNavigate,
}: {
  sysId?: string;
  name?: string;
  onNavigate?: (sysId: string) => void;
}) {
  const label = name || '—';
  if (!sysId || !onNavigate) {
    return <span className="text-gray-800">{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onNavigate(sysId)}
      className="text-left text-blue-700 hover:text-blue-900 hover:underline font-medium"
    >
      {label}
    </button>
  );
}

export default function RelationshipApprovalsView({ onNavigateToApp }: Props) {
  const [rows, setRows] = useState<RelationshipApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [processingIds, setProcessingIds] = useState<string[]>([]);
  const autoExpandedRef = useRef<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetchRelationshipApprovalInbox()
      .then(({ result }) => setRows(result))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const actionableIds = rows
    .filter(r => !processingIds.includes(r.sys_id))
    .map(r => r.sys_id);

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

  const toggleExpanded = (rowId: string) => {
    setExpandedId(prev => (prev === rowId ? null : rowId));
  };

  const handleProcessingStart = (approvalSysId: string) => {
    setProcessingIds(prev => (prev.includes(approvalSysId) ? prev : [...prev, approvalSysId]));
    setExpandedId(null);
  };

  const handleDone = () => {
    setProcessingIds([]);
    setExpandedId(null);
    reload();
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Clock className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="typo-page-title">Relationship Approvals</h1>
            <p className="typo-page-subtitle">
              Pending removal requests assigned to you via ServiceNow approval.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <div className="max-w-md mx-auto text-center py-16">
            <GitBranch className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="typo-body text-gray-500">No pending relationship removal requests.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-left typo-label text-gray-400">
                    <th className="px-3 py-2 w-8" aria-label="Expand" />
                    <th className="px-3 py-2">Source app</th>
                    <th className="px-3 py-2">Target app</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2">Requested by</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 typo-body">
                  {rows.map(row => {
                    const change = row.change;
                    const isProcessing = processingIds.includes(row.sys_id);
                    const canAct = !isProcessing;
                    const isExpanded = expandedId === row.sys_id && canAct;

                    return (
                      <Fragment key={row.sys_id}>
                        <tr className={isProcessing || isExpanded ? 'bg-amber-50/40' : ''}>
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
                          <td className="px-3 py-2">
                            <AppNameLink
                              sysId={change?.source_ci_sys_id}
                              name={change?.source_ci_name}
                              onNavigate={onNavigateToApp}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <AppNameLink
                              sysId={change?.target_ci_sys_id}
                              name={change?.target_ci_name}
                              onNavigate={onNavigateToApp}
                            />
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {change ? relTypeLabel(change.rel_type) : '—'}
                          </td>
                          <td className="px-3 py-2 text-gray-600 capitalize">
                            {change?.direction || '—'}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {change?.requested_by_name || '—'}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              {isProcessing ? (
                                <RelationshipProcessingBadge compact />
                              ) : (
                                <RelationshipChangeStateBadge state={change?.state || row.state} />
                              )}
                              {canAct && !isExpanded && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(row.sys_id)}
                                  className="typo-badge text-amber-800 underline underline-offset-2 hover:text-amber-900"
                                >
                                  Review
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-amber-50/30">
                            <td colSpan={7} className="px-3 py-3 border-t border-amber-100/80">
                              <RelationshipChangeActions
                                variant="panel"
                                commentsPlacement="below"
                                approvalSysId={row.sys_id}
                                changeSysId={change?.sys_id}
                                requestedByName={change?.requested_by_name}
                                requestedAt={change?.requested_at}
                                onProcessingStart={() => handleProcessingStart(row.sys_id)}
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
          </div>
        )}
      </div>
    </div>
  );
}

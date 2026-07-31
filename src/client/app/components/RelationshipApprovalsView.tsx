import { useState, useEffect, useCallback } from 'react';
import { Loader2, Clock, GitBranch } from 'lucide-react';
import { fetchRelationshipApprovalInbox, type RelationshipApprovalRecord } from '../../api/servicenow';
import RelationshipChangeActions, { RelationshipChangeStateBadge } from './RelationshipChangeActions';
import { relTypeLabel } from '../utils/relationshipTypeMap';

export default function RelationshipApprovalsView() {
  const [rows, setRows] = useState<RelationshipApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    fetchRelationshipApprovalInbox()
      .then(({ result }) => setRows(result))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Clock className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Relationship Approvals</h1>
            <p className="text-sm text-gray-500">
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
            <p className="text-sm text-gray-500">No pending relationship removal requests.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Source app</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Target app</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Type</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Direction</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Requested by</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500">Status</th>
                  <th className="px-4 py-2.5 text-xs font-semibold text-gray-500 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(row => {
                  const change = row.change;
                  return (
                    <tr key={row.sys_id} className="hover:bg-gray-50/80">
                      <td className="px-4 py-3 text-gray-800">{change?.source_ci_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-800">{change?.target_ci_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{change ? relTypeLabel(change.rel_type) : '—'}</td>
                      <td className="px-4 py-3 text-gray-600 capitalize">{change?.direction || '—'}</td>
                      <td className="px-4 py-3 text-gray-600">{change?.requested_by_name || '—'}</td>
                      <td className="px-4 py-3">
                        <RelationshipChangeStateBadge state={change?.state || row.state} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RelationshipChangeActions
                          approvalSysId={row.sys_id}
                          onDone={reload}
                          compact
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

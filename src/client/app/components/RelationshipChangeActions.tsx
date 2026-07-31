import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import {
  decideRelationshipApproval,
  type RelationshipApprovalDecision,
} from '../../api/servicenow';
import { pollChangeUntilSettled } from '../utils/pollRelationshipChange';

interface Props {
  approvalSysId: string;
  changeSysId?: string;
  appSysId?: string;
  enableAsyncPoll?: boolean;
  onProcessingStart?: (changeSysId: string) => void;
  onDone: () => void;
  compact?: boolean;
}

export function RelationshipProcessingBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-full border bg-amber-100 text-amber-800 border-amber-200 ${
        compact ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
      }`}
    >
      <Loader2 className={`animate-spin ${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
      Processing…
    </span>
  );
}

export default function RelationshipChangeActions({
  approvalSysId,
  changeSysId,
  appSysId,
  enableAsyncPoll = false,
  onProcessingStart,
  onDone,
  compact = false,
}: Props) {
  const [busy, setBusy] = useState<RelationshipApprovalDecision | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [timeoutMsg, setTimeoutMsg] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [comments, setComments] = useState('');

  const run = async (decision: RelationshipApprovalDecision) => {
    if (decision === 'reject' && !comments.trim()) {
      setError('Comments are required when rejecting.');
      return;
    }
    setBusy(decision);
    setError('');
    setTimeoutMsg('');
    const result = await decideRelationshipApproval(approvalSysId, decision, comments);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setShowReject(false);
    setComments('');

    const shouldPoll = enableAsyncPoll && changeSysId && appSysId;
    if (!shouldPoll) {
      onDone();
      return;
    }

    setProcessing(true);
    onProcessingStart?.(changeSysId);

    const pollResult = await pollChangeUntilSettled(appSysId, changeSysId);
    setProcessing(false);

    if (!pollResult.settled) {
      setTimeoutMsg("Approval submitted. Refresh if the diagram hasn't updated yet.");
    }

    onDone();
  };

  if (processing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <RelationshipProcessingBadge compact={compact} />
      </div>
    );
  }

  const btnCls = compact
    ? 'px-2 py-1 text-[11px] rounded border font-medium transition-colors'
    : 'px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors';

  return (
    <div className="flex flex-col items-end gap-1">
      {showReject ? (
        <div className="flex flex-col gap-1.5 w-full min-w-[180px]">
          <input
            type="text"
            value={comments}
            onChange={e => setComments(e.target.value)}
            placeholder="Rejection comments (required)"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
          />
          <div className="flex gap-1 justify-end">
            <button
              type="button"
              disabled={!!busy}
              onClick={() => setShowReject(false)}
              className={`${btnCls} border-gray-300 text-gray-600 hover:bg-gray-50`}
            >
              Back
            </button>
            <button
              type="button"
              disabled={!!busy}
              onClick={() => run('reject')}
              className={`${btnCls} border-red-300 text-red-700 hover:bg-red-50`}
            >
              {busy === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm reject'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!!busy}
            onClick={() => setShowReject(true)}
            className={`${btnCls} border-red-300 text-red-700 hover:bg-red-50`}
          >
            <X className="w-3 h-3 inline mr-0.5" />
            Reject
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() => run('approve')}
            className={`${btnCls} border-green-300 text-green-700 hover:bg-green-50`}
          >
            {busy === 'approve' ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <>
                <Check className="w-3 h-3 inline mr-0.5" />
                Approve
              </>
            )}
          </button>
        </div>
      )}
      {error && <p className="text-[10px] text-red-600 max-w-[200px] text-right">{error}</p>}
      {timeoutMsg && (
        <p className="text-[10px] text-amber-700 max-w-[200px] text-right">{timeoutMsg}</p>
      )}
    </div>
  );
}

export function RelationshipChangeStateBadge({ state }: { state: string }) {
  const cls =
    state === 'pending_approval' ? 'bg-amber-100 text-amber-800 border-amber-200' :
    state === 'requested'           ? 'bg-amber-100 text-amber-800 border-amber-200' :
    state === 'completed'           ? 'bg-green-100 text-green-800 border-green-200' :
    state === 'approved'            ? 'bg-green-100 text-green-800 border-green-200' :
    state === 'rejected'            ? 'bg-red-100 text-red-700 border-red-200' :
    state === 'cancelled'           ? 'bg-gray-100 text-gray-600 border-gray-200' :
                                      'bg-gray-100 text-gray-600 border-gray-200';
  const label =
    state === 'pending_approval' ? 'Pending approval' :
    state === 'requested'           ? 'Pending approval' :
    state === 'completed'           ? 'Completed' :
    state === 'approved'            ? 'Approved' :
    state === 'rejected'            ? 'Rejected' :
    state === 'cancelled'           ? 'Cancelled' :
                                      state;

  return (
    <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

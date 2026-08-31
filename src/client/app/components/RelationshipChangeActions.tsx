import { useState, type ReactNode } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import {
  decideRelationshipApproval,
  type RelationshipApprovalDecision,
} from '../../api/servicenow';
import { pollChangeUntilSettled } from '../utils/pollRelationshipChange';

interface ExecuteDecisionOpts {
  readonly approvalSysId: string;
  readonly decision: RelationshipApprovalDecision;
  readonly comments: string;
  readonly enableAsyncPoll: boolean;
  readonly changeSysId?: string;
  readonly appSysId?: string;
  readonly setBusy: (d: RelationshipApprovalDecision | null) => void;
  readonly setError: (e: string) => void;
  readonly setTimeoutMsg: (m: string) => void;
  readonly setShowReject: (v: boolean) => void;
  readonly setComments: (v: string) => void;
  readonly setProcessing: (v: boolean) => void;
  readonly onDone: () => void;
  readonly onProcessingStart?: (changeSysId: string) => void;
}

async function executeRelationshipDecision(opts: ExecuteDecisionOpts): Promise<void> {
  const {
    approvalSysId, decision, comments, enableAsyncPoll, changeSysId, appSysId,
    setBusy, setError, setTimeoutMsg, setShowReject, setComments, setProcessing,
    onDone, onProcessingStart,
  } = opts;
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
}

interface Props {
  readonly approvalSysId: string;
  readonly changeSysId?: string;
  readonly appSysId?: string;
  readonly enableAsyncPoll?: boolean;
  readonly onProcessingStart?: (changeSysId: string) => void;
  readonly onDone: () => void;
  readonly onCancel?: () => void;
  /** inline = table column (inbox); panel = full-width sub-row (app detail) */
  readonly variant?: 'inline' | 'panel';
  /** Panel only: comment field above or below action buttons */
  readonly commentsPlacement?: 'above' | 'below';
  readonly requestedByName?: string;
  readonly requestedAt?: string;
}

interface PanelCtx {
  readonly busy: RelationshipApprovalDecision | null;
  readonly comments: string;
  readonly setComments: (v: string) => void;
  readonly run: (d: RelationshipApprovalDecision) => void;
  readonly onCancel?: () => void;
  readonly requestedByName?: string;
  readonly requestedAt?: string;
  readonly commentsPlacement?: 'above' | 'below';
  readonly error: string;
  readonly timeoutMsg: string;
  readonly btnCls: string;
}

function renderPanel(ctx: PanelCtx): ReactNode {
  const { busy, comments, setComments, run, onCancel, requestedByName, requestedAt, commentsPlacement, error, timeoutMsg, btnCls } = ctx;
  const commentsField = (
    <div>
      <label htmlFor="reject-comments" className="block typo-label mb-1">
        Comments <span className="font-normal normal-case text-gray-400">(required to reject)</span>
      </label>
      <textarea id="reject-comments" value={comments} onChange={e => setComments(e.target.value)}
        placeholder="Explain why you are rejecting this removal request…" rows={4}
        className="w-full typo-body border border-gray-300 rounded-lg px-3 py-2 resize-y min-h-[96px] focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
      />
    </div>
  );
  const actionButtons = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {onCancel && <button type="button" disabled={!!busy} onClick={onCancel} className={`${btnCls} border-gray-300 text-gray-600 hover:bg-gray-50`}>Close</button>}
      <button type="button" disabled={!!busy} onClick={() => run('reject')} className={`${btnCls} border-red-300 text-red-700 hover:bg-red-50`}>
        {busy === 'reject' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : <><X className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />Reject</>}
      </button>
      <button type="button" disabled={!!busy} onClick={() => run('approve')} className={`${btnCls} border-green-300 text-green-700 hover:bg-green-50`}>
        {busy === 'approve' ? <Loader2 className="w-3.5 h-3.5 animate-spin inline" /> : <><Check className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />Approve</>}
      </button>
    </div>
  );
  return (
    <div className="space-y-3 text-left">
      {(requestedByName || requestedAt) && (
        <p className="typo-body text-gray-600">
          {requestedByName && <span>Requested by {requestedByName}</span>}
          {requestedByName && requestedAt && <span className="mx-1.5 text-gray-300">·</span>}
          {requestedAt && <span>{requestedAt}</span>}
        </p>
      )}
      {commentsPlacement === 'above' ? <>{commentsField}{actionButtons}</> : <>{actionButtons}{commentsField}</>}
      {error && <p className="typo-caption text-red-600">{error}</p>}
      {timeoutMsg && <p className="typo-caption text-amber-700">{timeoutMsg}</p>}
    </div>
  );
}

interface InlineCtx {
  readonly busy: RelationshipApprovalDecision | null;
  readonly comments: string;
  readonly setComments: (v: string) => void;
  readonly run: (d: RelationshipApprovalDecision) => void;
  readonly showReject: boolean;
  readonly setShowReject: (v: boolean) => void;
  readonly error: string;
  readonly timeoutMsg: string;
  readonly btnCls: string;
}

function renderInline(ctx: InlineCtx): ReactNode {
  const { busy, comments, setComments, run, showReject, setShowReject, error, timeoutMsg, btnCls } = ctx;
  return (
    <div className="flex flex-col items-end gap-1">
      {showReject ? (
        <div className="flex flex-col gap-1.5 w-full min-w-[180px]">
          <input type="text" value={comments} onChange={e => setComments(e.target.value)}
            placeholder="Rejection comments (required)" className="w-full typo-body border border-gray-300 rounded px-2 py-1" />
          <div className="flex gap-1 justify-end">
            <button type="button" disabled={!!busy} onClick={() => setShowReject(false)} className={`${btnCls} border-gray-300 text-gray-600 hover:bg-gray-50`}>Back</button>
            <button type="button" disabled={!!busy} onClick={() => run('reject')} className={`${btnCls} border-red-300 text-red-700 hover:bg-red-50`}>
              {busy === 'reject' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Confirm reject'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <button type="button" disabled={!!busy} onClick={() => setShowReject(true)} className={`${btnCls} border-red-300 text-red-700 hover:bg-red-50`}>
            <X className="w-3 h-3 inline mr-0.5" />Reject
          </button>
          <button type="button" disabled={!!busy} onClick={() => run('approve')} className={`${btnCls} border-green-300 text-green-700 hover:bg-green-50`}>
            {busy === 'approve' ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Check className="w-3 h-3 inline mr-0.5" />Approve</>}
          </button>
        </div>
      )}
      {error && <p className="typo-caption text-red-600 max-w-[200px] text-right">{error}</p>}
      {timeoutMsg && <p className="typo-caption text-amber-700 max-w-[200px] text-right">{timeoutMsg}</p>}
    </div>
  );
}

export function RelationshipProcessingBadge({ compact = false }: { readonly compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-full border bg-amber-100 text-amber-800 border-amber-200 ${
        compact ? 'typo-badge px-2 py-0.5' : 'typo-badge px-2.5 py-1'
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
  onCancel,
  variant = 'inline',
  commentsPlacement = 'above',
  requestedByName,
  requestedAt,
}: Props) {
  const [busy, setBusy] = useState<RelationshipApprovalDecision | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [timeoutMsg, setTimeoutMsg] = useState('');
  const [showReject, setShowReject] = useState(false);
  const [comments, setComments] = useState('');
  const isPanel = variant === 'panel';

  const run = (decision: RelationshipApprovalDecision) =>
    executeRelationshipDecision({
      approvalSysId, decision, comments, enableAsyncPoll, changeSysId, appSysId,
      setBusy, setError, setTimeoutMsg, setShowReject, setComments, setProcessing,
      onDone, onProcessingStart,
    });

  if (processing) {
    return (
      <div className={isPanel ? 'py-1' : 'flex flex-col items-end gap-1'}>
        <RelationshipProcessingBadge compact={!isPanel} />
      </div>
    );
  }

  const btnCls = isPanel
    ? 'px-3 py-1.5 typo-badge rounded-lg border font-medium transition-colors'
    : 'px-2 py-1 typo-body rounded border font-medium transition-colors';

  if (isPanel) return renderPanel({ busy, comments, setComments, run, onCancel, requestedByName, requestedAt, commentsPlacement, error, timeoutMsg, btnCls });
  return renderInline({ busy, comments, setComments, run, showReject, setShowReject, error, timeoutMsg, btnCls });
}

const STATE_BADGE_CLASS: Record<string, string> = {
  pending_approval: 'bg-amber-100 text-amber-800 border-amber-200',
  requested: 'bg-amber-100 text-amber-800 border-amber-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  approved: 'bg-green-100 text-green-800 border-green-200',
  rejected: 'bg-red-100 text-red-700 border-red-200',
};

const STATE_BADGE_LABEL: Record<string, string> = {
  pending_approval: 'Pending approval',
  requested: 'Pending approval',
  completed: 'Completed',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function RelationshipChangeStateBadge({ state }: { readonly state: string }) {
  const cls = STATE_BADGE_CLASS[state] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  const label = STATE_BADGE_LABEL[state] ?? state;

  return (
    <span className={`inline-flex typo-badge font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

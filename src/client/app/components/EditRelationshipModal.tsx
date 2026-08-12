import { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Check, AlertTriangle, ArrowUp, ArrowDown, ArrowLeftRight,
  Clock, Loader2,
} from 'lucide-react';
import ReferenceAutocomplete from './ReferenceAutocomplete';
import { loadAppRelationships, type LiveRelationship, type RelationshipDirection } from '../utils/appRelationships';
import {
  fetchRelationshipChangesForApp,
  createRelationshipChange,
  requestRelationshipDelete,
  type RelationshipChangeRequest,
} from '../../api/servicenow';
import {
  buildInitialGroups,
  allGroupsHaveChanges,
  countDraftRemovals,
  countDraftAdds,
  buildSubmitBatch,
  canAddRelationship,
  canRemoveRelationship,
  nextDraftId,
  type DirectionGroups,
  type DraftAdd,
  type DirectionGroup,
} from '../utils/relationshipEdit';
import {
  getAppRelationshipTypes,
  relTypeLabel,
  type AppRelationshipTypeConfig,
} from '../utils/appRelationshipTypes';
import { getApplicationReferenceSearch } from '../utils/applicationReferenceSearch';
import type { EditFieldValue } from '../utils/viewFields';
import { editDisplayValue, editRawValue } from '../utils/editValues';

type ModalStep = 'edit' | 'review' | 'complete';

export interface RelationshipMutation {
  changeSysId: string;
  action: 'create' | 'delete';
}

interface EditRelationshipModalProps {
  selectedApp: { sysId: string; name: string };
  hierarchyMode?: boolean;
  onClose: () => void;
  onSubmitted?: (mutations: RelationshipMutation[]) => void;
}

const DIR_META: Record<RelationshipDirection, { label: string; tagCls: string; icon: React.ReactNode }> = {
  upstream: {
    label: 'Upstream',
    tagCls: 'bg-orange-100 text-orange-800 border-orange-200',
    icon: <ArrowUp size={12} className="text-orange-500" />,
  },
  downstream: {
    label: 'Downstream',
    tagCls: 'bg-blue-100 text-blue-800 border-blue-200',
    icon: <ArrowDown size={12} className="text-blue-500" />,
  },
  bidirectional: {
    label: 'Bi-directional',
    tagCls: 'bg-violet-100 text-violet-800 border-violet-200',
    icon: <ArrowLeftRight size={12} className="text-violet-500" />,
  },
};

const DIRS: RelationshipDirection[] = ['upstream', 'downstream', 'bidirectional'];

function emptyRefValue(): EditFieldValue {
  return { value: '', display_value: '' };
}

function AddRelationshipRow({
  direction,
  defaultRelType,
  relTypeOptions,
  referenceTable,
  referenceQuery,
  onAdd,
  disabled,
  error,
}: {
  direction: RelationshipDirection;
  defaultRelType: string;
  relTypeOptions: { value: string; label: string }[];
  referenceTable: string;
  referenceQuery: string;
  onAdd: (appSysId: string, appName: string, relType: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  const [refValue, setRefValue] = useState<EditFieldValue>(emptyRefValue());
  const [relType, setRelType] = useState(defaultRelType);

  useEffect(() => {
    setRelType(defaultRelType);
  }, [defaultRelType]);

  const handleAdd = () => {
    const sysId = editRawValue(refValue);
    const name = editDisplayValue(refValue) || sysId;
    if (!sysId) return;
    onAdd(sysId, name, relType);
    setRefValue(emptyRefValue());
  };

  const noTypes = relTypeOptions.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <ReferenceAutocomplete
            label="Application"
            referenceTable={referenceTable}
            referenceQuery={referenceQuery}
            value={refValue}
            disabled={disabled || noTypes}
            onChange={setRefValue}
          />
        </div>
        <div className="w-36">
          <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Type</label>
          <select
            value={relType}
            disabled={disabled || noTypes}
            onChange={e => setRelType(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white"
          >
            {relTypeOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={disabled || noTypes || !editRawValue(refValue)}
          onClick={handleAdd}
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
        >
          Add
        </button>
      </div>
      {noTypes && (
        <p className="text-xs text-amber-700">No relationship types are configured. Set system property app.to.app.relationship.types.</p>
      )}
      {direction === 'bidirectional' && (
        <p className="text-[10px] text-gray-400">
          Bidirectional adds create two relationship rows (upstream and downstream) with the selected type.
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function RelSection({
  direction,
  group,
  liveRels,
  pendingChanges,
  allDraftRemovals,
  allDraftAdds,
  sourceCi,
  referenceTable,
  referenceQuery,
  relTypeOptions,
  onRemoveExisting,
  onUndoRemove,
  onAdd,
  onRemoveAdded,
}: {
  direction: RelationshipDirection;
  group: DirectionGroup;
  liveRels: LiveRelationship[];
  pendingChanges: RelationshipChangeRequest[];
  allDraftRemovals: LiveRelationship[];
  allDraftAdds: DraftAdd[];
  sourceCi: string;
  referenceTable: string;
  referenceQuery: string;
  relTypeOptions: { value: string; label: string }[];
  onRemoveExisting: (rel: LiveRelationship) => void;
  onUndoRemove: (rel: LiveRelationship) => void;
  onAdd: (appSysId: string, appName: string, relType: string) => void;
  onRemoveAdded: (id: string) => void;
}) {
  const meta = DIR_META[direction];
  const [addError, setAddError] = useState('');

  const handleAdd = (appSysId: string, appName: string, relType: string) => {
    if (direction === 'bidirectional') {
      const upDraft: DraftAdd = { id: nextDraftId(), otherAppSysId: appSysId, otherAppName: appName, direction: 'upstream', relType };
      const dnDraft: DraftAdd = { id: nextDraftId(), otherAppSysId: appSysId, otherAppName: appName, direction: 'downstream', relType };
      const upErr = canAddRelationship(sourceCi, upDraft, liveRels, pendingChanges, allDraftRemovals, allDraftAdds, [upDraft.id, dnDraft.id]);
      const dnErr = canAddRelationship(sourceCi, dnDraft, liveRels, pendingChanges, allDraftRemovals, [...allDraftAdds, upDraft], [dnDraft.id]);
      if (upErr || dnErr) {
        setAddError(upErr || dnErr || 'Cannot add relationship.');
        return;
      }
      onAdd(appSysId, appName, relType);
      setAddError('');
      return;
    }

    const draft: DraftAdd = { id: nextDraftId(), otherAppSysId: appSysId, otherAppName: appName, direction, relType };
    const err = canAddRelationship(sourceCi, draft, liveRels, pendingChanges, allDraftRemovals, allDraftAdds, [draft.id]);
    if (err) {
      setAddError(err);
      return;
    }
    setAddError('');
    onAdd(appSysId, appName, relType);
  };

  const pendingCount = group.draftRemovals.length + group.serverPendingRemovals.length;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 mb-2">
        {meta.icon}
        <label className="text-sm font-semibold text-gray-800">{meta.label} Relationships</label>
        {pendingCount > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            <Clock size={9} /> {pendingCount} pending removal
          </span>
        )}
      </div>

      <div className="border border-gray-200 rounded-lg p-3 mb-2 min-h-[52px] bg-gray-50/50">
        {group.existing.length === 0 && group.draftAdds.length === 0
          && group.draftRemovals.length === 0 && group.serverPendingRemovals.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No relationships</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {group.existing.map(rel => (
              <span key={`${rel.otherAppSysId}:${rel.relType}:${rel.direction}`} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${meta.tagCls}`}>
                <span className="truncate max-w-[180px]" title={rel.otherAppName}>
                  {rel.otherAppName}
                </span>
                <span className="text-[9px] opacity-70">({relTypeLabel(rel.relType)})</span>
                <button
                  type="button"
                  className="ml-0.5 hover:bg-black/10 rounded-full p-px"
                  onClick={() => onRemoveExisting(rel)}
                  title="Mark for removal (requires approval)"
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            {group.draftAdds.map(add => (
              <span key={add.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border bg-green-50 text-green-800 border-green-200">
                <span className="text-green-500 font-bold text-[10px]">+</span>
                {add.otherAppName}
                <span className="text-[9px] opacity-70">({relTypeLabel(add.relType)})</span>
                <button type="button" className="ml-0.5 hover:bg-green-200 rounded-full p-px" onClick={() => onRemoveAdded(add.id)}>
                  <X size={10} />
                </button>
              </span>
            ))}

            {group.draftRemovals.map(rel => (
              <span key={`rm-${rel.otherAppSysId}:${rel.relType}:${rel.direction}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border bg-red-50 text-red-400 border-red-200 line-through">
                {rel.otherAppName}
                <button type="button" className="ml-0.5 hover:bg-red-200 rounded-full p-px no-underline" onClick={() => onUndoRemove(rel)}>
                  <span className="text-red-500 not-italic">↩</span>
                </button>
              </span>
            ))}

            {group.serverPendingRemovals.map(rel => (
              <span key={`srv-${rel.otherAppSysId}:${rel.relType}:${rel.direction}`} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border bg-amber-50 text-amber-700 border-amber-200">
                <Clock size={9} />
                {rel.otherAppName}
                <span className="text-[9px]">pending approval</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <AddRelationshipRow
        direction={direction}
        defaultRelType={relTypeOptions[0]?.value ?? ''}
        relTypeOptions={relTypeOptions}
        referenceTable={referenceTable}
        referenceQuery={referenceQuery}
        onAdd={handleAdd}
        error={addError}
      />
    </div>
  );
}

export default function EditRelationshipModal({
  selectedApp,
  hierarchyMode = true,
  onClose,
  onSubmitted,
}: EditRelationshipModalProps) {
  const [step, setStep] = useState<ModalStep>('edit');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [liveRels, setLiveRels] = useState<LiveRelationship[]>([]);
  const [pendingChanges, setPendingChanges] = useState<RelationshipChangeRequest[]>([]);
  const [groups, setGroups] = useState<DirectionGroups>(() => buildInitialGroups([], []));
  const [relTypeConfig, setRelTypeConfig] = useState<AppRelationshipTypeConfig | null>(null);

  useEffect(() => {
    getAppRelationshipTypes()
      .then(setRelTypeConfig)
      .catch(() => setRelTypeConfig(null));
  }, []);

  const relTypeOptions = relTypeConfig?.options ?? [];

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [rels, changes] = await Promise.all([
        loadAppRelationships(selectedApp.sysId),
        fetchRelationshipChangesForApp(selectedApp.sysId),
      ]);
      setLiveRels(rels);
      setPendingChanges(changes.result);
      setGroups(buildInitialGroups(rels, changes.result));
    } catch {
      setLiveRels([]);
      setPendingChanges([]);
    } finally {
      setLoading(false);
    }
  }, [selectedApp.sysId]);

  useEffect(() => { reload(); }, [reload]);

  const allDraftRemovals = useMemo(
    () => DIRS.flatMap(d => groups[d].draftRemovals),
    [groups],
  );
  const allDraftAdds = useMemo(
    () => DIRS.flatMap(d => groups[d].draftAdds),
    [groups],
  );

  const appReferenceSearch = useMemo(
    () => getApplicationReferenceSearch(hierarchyMode, selectedApp.sysId),
    [hierarchyMode, selectedApp.sysId],
  );

  const updateGroup = (dir: RelationshipDirection, fn: (g: DirectionGroup) => DirectionGroup) =>
    setGroups(prev => ({ ...prev, [dir]: fn(prev[dir]) }));

  const removeExisting = (dir: RelationshipDirection, rel: LiveRelationship) => {
    const err = canRemoveRelationship(rel, pendingChanges);
    if (err) return;
    const relIds = new Set(rel.relationshipSysIds?.length ? rel.relationshipSysIds : [rel.sysId]);
    updateGroup(dir, g => ({
      ...g,
      existing: g.existing.filter(r => {
        const ids = r.relationshipSysIds?.length ? r.relationshipSysIds : [r.sysId];
        return !ids.some(id => relIds.has(id));
      }),
      draftRemovals: [...g.draftRemovals, rel],
    }));
  };

  const undoRemove = (dir: RelationshipDirection, rel: LiveRelationship) => {
    const relIds = new Set(rel.relationshipSysIds?.length ? rel.relationshipSysIds : [rel.sysId]);
    updateGroup(dir, g => ({
      ...g,
      draftRemovals: g.draftRemovals.filter(r => {
        const ids = r.relationshipSysIds?.length ? r.relationshipSysIds : [r.sysId];
        return !ids.some(id => relIds.has(id));
      }),
      existing: [...g.existing, rel],
    }));
  };

  const addApp = (dir: RelationshipDirection, appSysId: string, appName: string, relType: string) => {
    if (dir === 'bidirectional') {
      const upDraft: DraftAdd = { id: nextDraftId(), otherAppSysId: appSysId, otherAppName: appName, direction: 'upstream', relType };
      const dnDraft: DraftAdd = { id: nextDraftId(), otherAppSysId: appSysId, otherAppName: appName, direction: 'downstream', relType };
      setGroups(prev => ({
        ...prev,
        upstream: { ...prev.upstream, draftAdds: [...prev.upstream.draftAdds, upDraft] },
        downstream: { ...prev.downstream, draftAdds: [...prev.downstream.draftAdds, dnDraft] },
      }));
      return;
    }
    const draft: DraftAdd = { id: nextDraftId(), otherAppSysId: appSysId, otherAppName: appName, direction: dir, relType };
    updateGroup(dir, g => ({ ...g, draftAdds: [...g.draftAdds, draft] }));
  };

  const removeAdded = (dir: RelationshipDirection, id: string) =>
    updateGroup(dir, g => ({ ...g, draftAdds: g.draftAdds.filter(a => a.id !== id) }));

  const hasChanges = allGroupsHaveChanges(groups);
  const totalRemoved = countDraftRemovals(groups);
  const totalAdded = countDraftAdds(groups);

  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError('');
    const batch = buildSubmitBatch(selectedApp.sysId, groups);
    const mutations: RelationshipMutation[] = [];

    for (const item of batch) {
      if (item.kind === 'create') {
        const res = await createRelationshipChange({
          source_ci_sys_id: item.source_ci_sys_id,
          target_ci_sys_id: item.target_ci_sys_id,
          direction: item.direction,
          rel_type: item.rel_type,
        });
        if (!res.ok) {
          setSubmitError(res.error);
          setSubmitting(false);
          return;
        }
        mutations.push({ changeSysId: res.change.sys_id, action: 'create' });
      } else {
        const res = await requestRelationshipDelete({
          source_ci_sys_id: item.source_ci_sys_id,
          relationship_sys_ids: item.relationship_sys_ids,
          direction: item.direction,
        });
        if (!res.ok) {
          setSubmitError(res.error);
          setSubmitting(false);
          return;
        }
        mutations.push({ changeSysId: res.change.sys_id, action: 'delete' });
      }
    }

    setSubmitting(false);
    setStep('complete');
    onSubmitted?.(mutations);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Edit Relationship</h2>
            <p className="text-xs text-gray-500 mt-0.5">{selectedApp.name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-2.5 border-b border-gray-100 flex items-center gap-3">
          {(['edit', 'review', 'complete'] as ModalStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                ${step === s ? 'bg-blue-600 text-white' : step === 'complete' || (step === 'review' && i === 0) ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
                {(step === 'review' && i === 0) || step === 'complete' ? <Check size={10} /> : i + 1}
              </div>
              <span className={`text-xs font-medium ${step === s ? 'text-blue-700' : 'text-gray-400'}`}>
                {s === 'edit' ? 'Edit' : s === 'review' ? 'Review' : 'Done'}
              </span>
              {i < 2 && <div className="w-6 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading relationships…
            </div>
          ) : step === 'edit' ? (
            <div>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                Add or remove applications from each relationship direction.
                Select a relationship type when adding.
                <span className="text-amber-700 font-medium"> Removals require approval from the target app owner.</span>
              </p>
              {DIRS.map(dir => (
                <RelSection
                  key={dir}
                  direction={dir}
                  group={groups[dir]}
                  liveRels={liveRels}
                  pendingChanges={pendingChanges}
                  allDraftRemovals={allDraftRemovals}
                  allDraftAdds={allDraftAdds}
                  sourceCi={selectedApp.sysId}
                  referenceTable={appReferenceSearch.table}
                  referenceQuery={appReferenceSearch.referenceQuery}
                  relTypeOptions={relTypeOptions}
                  onRemoveExisting={rel => removeExisting(dir, rel)}
                  onUndoRemove={rel => undoRemove(dir, rel)}
                  onAdd={(sysId, name, relType) => addApp(dir, sysId, name, relType)}
                  onRemoveAdded={id => removeAdded(dir, id)}
                />
              ))}
            </div>
          ) : step === 'review' ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">Please review the changes before confirming.</p>
              {DIRS.map(dir => {
                const g = groups[dir];
                const meta = DIR_META[dir];
                if (g.draftAdds.length === 0 && g.draftRemovals.length === 0) return null;
                return (
                  <div key={dir} className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                      {meta.icon}
                      <span className="text-sm font-semibold text-gray-700">{meta.label}</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {g.draftAdds.map(add => (
                        <div key={add.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-green-600 font-bold text-xs">+</span>
                          </span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{add.otherAppName}</p>
                            <p className="text-xs text-green-600 mt-0.5">
                              {relTypeLabel(add.relType)} — will be added immediately
                            </p>
                          </div>
                        </div>
                      ))}
                      {g.draftRemovals.map(rel => (
                        <div key={`${rel.otherAppSysId}:${rel.relType}:${rel.direction}`} className="flex items-start gap-3 px-4 py-3 bg-amber-50/60">
                          <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-medium text-gray-800">{rel.otherAppName}</p>
                            <p className="text-xs text-amber-700 mt-0.5">
                              {relTypeLabel(rel.relType)} — requires target app owner approval
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {totalRemoved > 0 && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800">
                    <strong>{totalRemoved} removal request{totalRemoved > 1 ? 's' : ''}</strong> will be sent for approval.
                    Relationships stay active until approved.
                  </p>
                </div>
              )}
              {submitError && <p className="text-sm text-red-600">{submitError}</p>}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={24} className="text-green-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Changes Submitted</h3>
              <p className="text-sm text-gray-500 mb-6">{selectedApp.name}</p>
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-left space-y-2 text-xs">
                {totalAdded > 0 && <p className="text-green-600">{totalAdded} relationship{totalAdded > 1 ? 's' : ''} added</p>}
                {totalRemoved > 0 && <p className="text-amber-600">{totalRemoved} removal approval{totalRemoved > 1 ? 's' : ''} pending</p>}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
          {step === 'edit' && (
            <>
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setStep('review')}
                disabled={!hasChanges || loading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
              >
                Review Changes
              </button>
            </>
          )}
          {step === 'review' && (
            <>
              <button type="button" onClick={() => setStep('edit')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100">
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 inline-flex items-center gap-2"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirm &amp; Submit
              </button>
            </>
          )}
          {step === 'complete' && (
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

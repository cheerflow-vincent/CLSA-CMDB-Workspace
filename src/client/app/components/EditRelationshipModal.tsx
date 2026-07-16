import { useState, useRef, useEffect } from 'react';
import { X, Search, ChevronDown, Check, AlertTriangle, ArrowUp, ArrowDown, ArrowLeftRight, Clock } from 'lucide-react';

// ── Sample application catalogue ─────────────────────────────────────────────
const APP_CATALOGUE = [
  'AMER - BlackRock Aladdin - US',
  'APAC - Citadel Connect - SG',
  'DS - DataFeed Pro - Global',
  'ES - Viper Trading - JP',
  'RISK - RMS Analytics - Global',
  'CORP - Workday HCM - Global',
  'TR - Reuters Connect - UK',
  'MO - Clearstream - EU',
  'ES - Mamba FX - HK',
  'FX - Calypso Treasury - US',
  'OMS - FlexTrade EMS - US',
  'RISK - AlgoRisk - HK',
  'MKT - Bloomberg Terminal - US',
  'CORP - ServiceNow ITSM - Global',
  'DS - Quant Analytics - SG',
  'PM - Charles River IMS - US',
  'EXEC - TCA Platform - Global',
  'MO - DTCC Settlement - US',
  'CORP - Confluence Wiki - Global',
  'ES - Cobra AU - AU',
];

// ── Types ─────────────────────────────────────────────────────────────────────
type Direction = 'upstream' | 'downstream' | 'bidirectional';
type ModalStep = 'edit' | 'review' | 'complete';

interface RelGroup {
  existing: string[];   // original apps still kept
  removed:  string[];   // original apps marked for removal (needs approval)
  added:    string[];   // newly selected apps (immediate)
}

interface EditRelationshipModalProps {
  onClose: () => void;
}

// ── Initial relationship state ────────────────────────────────────────────────
const INIT: Record<Direction, string[]> = {
  upstream:      ['ES - Aperture - HK', 'ES - Cobra - AU', 'ES - Cobra - IN'],
  downstream:    ['CORP - Resilient Report', 'DS - XBrain - Global', 'EOD - Halo - Global'],
  bidirectional: ['ES - Cobra - PH', 'ES - Cobra - SG'],
};

const DIR_META: Record<Direction, { label: string; color: string; tagCls: string; icon: React.ReactNode }> = {
  upstream:      { label: 'Upstream',      color: '#F97316', tagCls: 'bg-orange-100 text-orange-800 border-orange-200', icon: <ArrowUp    size={12} className="text-orange-500" /> },
  downstream:    { label: 'Downstream',    color: '#3B82F6', tagCls: 'bg-blue-100 text-blue-800 border-blue-200',       icon: <ArrowDown  size={12} className="text-blue-500"   /> },
  bidirectional: { label: 'Bi-directional',color: '#8B5CF6', tagCls: 'bg-violet-100 text-violet-800 border-violet-200', icon: <ArrowLeftRight size={12} className="text-violet-500" /> },
};

// ── Searchable dropdown component ─────────────────────────────────────────────
function AppDropdown({
  direction, group, onAdd,
}: {
  direction: Direction;
  group: RelGroup;
  onAdd: (app: string) => void;
}) {
  const [query,  setQuery]  = useState('');
  const [open,   setOpen]   = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const inUse   = new Set([...group.existing, ...group.added]);
  const options = APP_CATALOGUE
    .filter(a => !inUse.has(a))
    .filter(a => a.toLowerCase().includes(query.toLowerCase()));

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-blue-300 focus-within:border-blue-400">
        <Search size={14} className="text-gray-400 flex-shrink-0" />
        <input
          type="text"
          placeholder="Search application to add…"
          className="flex-1 text-sm outline-none bg-transparent"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {open && options.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {options.map(app => (
              <button
                key={app}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                onMouseDown={e => e.preventDefault()} // prevent input blur
                onClick={() => { onAdd(app); setQuery(''); setOpen(false); }}
              >
                <span className="flex-1 truncate">{app}</span>
                <Check size={12} className="text-blue-400 opacity-0 group-hover:opacity-100" />
              </button>
            ))}
          </div>
          {options.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-400">No applications found</p>
          )}
        </div>
      )}
      {open && options.length === 0 && query && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-xl px-3 py-2">
          <p className="text-sm text-gray-400">No applications found</p>
        </div>
      )}
    </div>
  );
}

// ── Direction section ─────────────────────────────────────────────────────────
function RelSection({
  direction, group, onRemoveExisting, onUndoRemove, onAdd, onRemoveAdded,
}: {
  direction:       Direction;
  group:           RelGroup;
  onRemoveExisting:(app: string) => void;
  onUndoRemove:    (app: string) => void;
  onAdd:           (app: string) => void;
  onRemoveAdded:   (app: string) => void;
}) {
  const meta = DIR_META[direction];
  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 mb-2">
        {meta.icon}
        <label className="text-sm font-semibold text-gray-800">{meta.label} Relationships</label>
        {group.removed.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            <Clock size={9} /> {group.removed.length} pending removal approval
          </span>
        )}
      </div>

      {/* Tag cloud: existing (kept) + added */}
      <div className="border border-gray-200 rounded-lg p-3 mb-2 min-h-[52px] bg-gray-50/50">
        {group.existing.length === 0 && group.added.length === 0 && group.removed.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No relationships</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {/* Existing (kept) */}
            {group.existing.map(app => (
              <span key={app} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${meta.tagCls}`}>
                {app}
                <button
                  className="ml-0.5 hover:bg-black/10 rounded-full p-px transition-colors"
                  onClick={() => onRemoveExisting(app)}
                  title="Mark for removal (requires approval)"
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            {/* Newly added — green */}
            {group.added.map(app => (
              <span key={app} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border bg-green-50 text-green-800 border-green-200">
                <span className="text-green-500 font-bold text-[10px]">+</span>
                {app}
                <button
                  className="ml-0.5 hover:bg-green-200 rounded-full p-px transition-colors"
                  onClick={() => onRemoveAdded(app)}
                  title="Undo add"
                >
                  <X size={10} />
                </button>
              </span>
            ))}

            {/* Pending removal — red strikethrough */}
            {group.removed.map(app => (
              <span key={app} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border bg-red-50 text-red-400 border-red-200 line-through">
                {app}
                <button
                  className="ml-0.5 hover:bg-red-200 rounded-full p-px transition-colors no-underline"
                  onClick={() => onUndoRemove(app)}
                  title="Undo removal"
                  style={{ textDecoration: 'none' }}
                >
                  <span className="not-italic text-red-500" style={{ textDecoration: 'none', lineHeight: 1 }}>↩</span>
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Dropdown to add */}
      <AppDropdown direction={direction} group={group} onAdd={onAdd} />
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function EditRelationshipModal({ onClose }: EditRelationshipModalProps) {
  const [step, setStep] = useState<ModalStep>('edit');

  const [groups, setGroups] = useState<Record<Direction, RelGroup>>({
    upstream:      { existing: [...INIT.upstream],      removed: [], added: [] },
    downstream:    { existing: [...INIT.downstream],    removed: [], added: [] },
    bidirectional: { existing: [...INIT.bidirectional], removed: [], added: [] },
  });

  // ── Mutation helpers ──────────────────────────────────────────────────────────
  const update = (dir: Direction, fn: (g: RelGroup) => RelGroup) =>
    setGroups(prev => ({ ...prev, [dir]: fn(prev[dir]) }));

  const removeExisting = (dir: Direction, app: string) =>
    update(dir, g => ({ ...g, existing: g.existing.filter(a => a !== app), removed: [...g.removed, app] }));

  const undoRemove = (dir: Direction, app: string) =>
    update(dir, g => ({ ...g, removed: g.removed.filter(a => a !== app), existing: [...g.existing, app] }));

  const addApp = (dir: Direction, app: string) =>
    update(dir, g => ({ ...g, added: [...g.added, app] }));

  const removeAdded = (dir: Direction, app: string) =>
    update(dir, g => ({ ...g, added: g.added.filter(a => a !== app) }));

  // ── Derived review data ───────────────────────────────────────────────────────
  const hasChanges = Object.values(groups).some(g => g.removed.length > 0 || g.added.length > 0);
  const totalRemoved = Object.values(groups).reduce((s, g) => s + g.removed.length, 0);
  const totalAdded   = Object.values(groups).reduce((s, g) => s + g.added.length,   0);

  const OWNERS: Record<string, string> = {
    'ES - Aperture - HK':        'Benny Cheng',
    'ES - Cobra - AU':           'James Wu',
    'CORP - Resilient Report':   'Nikhar Saxena',
    'DS - XBrain - Global':      'Nikhar Saxena',
    'EOD - Halo - Global':       'Alice Chen',
    'ES - Cobra - PH':           'Maria Santos',
    'ES - Cobra - SG':           'Benny Cheng',
    'ES - Cobra - IN':           'Ravi Kumar',
  };

  const dirs: Direction[] = ['upstream', 'downstream', 'bidirectional'];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">

        {/* ── Header ── */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Edit Relationship</h2>
            <p className="text-xs text-gray-500 mt-0.5">ES - Cobra HK (HUB)</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-200 rounded-lg transition-colors">
            <X size={16} className="text-gray-500" />
          </button>
        </div>

        {/* ── Step indicator ── */}
        <div className="px-6 py-2.5 border-b border-gray-100 flex items-center gap-3">
          {(['edit','review','complete'] as ModalStep[]).map((s, i) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors
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

        {/* ── Body ── */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── Step 1: Edit ── */}
          {step === 'edit' && (
            <div>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                Add or remove applications from each relationship direction.
                <span className="text-amber-700 font-medium"> Removals require approval from the target app owner.</span>
              </p>
              {dirs.map(dir => (
                <RelSection
                  key={dir}
                  direction={dir}
                  group={groups[dir]}
                  onRemoveExisting={app => removeExisting(dir, app)}
                  onUndoRemove={app => undoRemove(dir, app)}
                  onAdd={app => addApp(dir, app)}
                  onRemoveAdded={app => removeAdded(dir, app)}
                />
              ))}
            </div>
          )}

          {/* ── Step 2: Review ── */}
          {step === 'review' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 mb-4">Please review the changes before confirming.</p>

              {dirs.map(dir => {
                const g    = groups[dir];
                const meta = DIR_META[dir];
                if (g.added.length === 0 && g.removed.length === 0) return null;
                return (
                  <div key={dir} className="rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200">
                      {meta.icon}
                      <span className="text-sm font-semibold text-gray-700">{meta.label} Relationships</span>
                    </div>
                    <div className="divide-y divide-gray-100">
                      {/* Additions */}
                      {g.added.map(app => (
                        <div key={app} className="flex items-start gap-3 px-4 py-3">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-green-600 font-bold text-xs">+</span>
                          </span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{app}</p>
                            <p className="text-xs text-green-600 mt-0.5">Will be added immediately</p>
                          </div>
                        </div>
                      ))}
                      {/* Removals */}
                      {g.removed.map(app => (
                        <div key={app} className="flex items-start gap-3 px-4 py-3 bg-amber-50/60">
                          <span className="mt-0.5 w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                            <AlertTriangle size={10} className="text-amber-600" />
                          </span>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{app}</p>
                            <p className="text-xs text-amber-700 mt-0.5">
                              Requires approval from <strong>{OWNERS[app] ?? 'app owner'}</strong> before removal
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {totalRemoved > 0 && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl p-4 mt-2">
                  <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    <strong>{totalRemoved} removal request{totalRemoved > 1 ? 's' : ''}</strong> will be sent for approval.
                    The relationships will remain active until approved. You can track pending approvals in the application panel.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: Complete ── */}
          {step === 'complete' && (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={24} className="text-green-600" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Changes Submitted</h3>
              <p className="text-sm text-gray-500 mb-6">ES - Cobra HK (HUB)</p>

              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-left space-y-3">
                {dirs.map(dir => {
                  const g    = groups[dir];
                  const meta = DIR_META[dir];
                  if (g.added.length === 0 && g.removed.length === 0) return null;
                  return (
                    <div key={dir} className="flex items-start gap-2">
                      {meta.icon}
                      <div className="flex-1">
                        <p className="text-xs font-semibold text-gray-700">{meta.label}</p>
                        {g.added.length > 0 && (
                          <p className="text-xs text-green-600 mt-0.5">{g.added.length} application{g.added.length > 1 ? 's' : ''} added</p>
                        )}
                        {g.removed.length > 0 && (
                          <p className="text-xs text-amber-600 mt-0.5">{g.removed.length} removal approval{g.removed.length > 1 ? 's' : ''} pending</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {totalRemoved > 0 && (
                <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                  Approval requests have been sent to the respective app owners.
                  Pending requests are visible in the <strong>Pending Approvals</strong> section of the application panel.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-3.5 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-3">
          {step === 'edit' && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => setStep('review')}
                disabled={!hasChanges}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Review Changes
              </button>
            </>
          )}
          {step === 'review' && (
            <>
              <button onClick={() => setStep('edit')} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-100 transition-colors">
                Back
              </button>
              <button onClick={() => setStep('complete')} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                Confirm &amp; Submit
              </button>
            </>
          )}
          {step === 'complete' && (
            <button onClick={onClose} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

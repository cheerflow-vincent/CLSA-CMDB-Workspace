import { useState, useEffect, useMemo, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, Search, ChevronRight, ChevronLeft,
  ChevronUp, ChevronDown, RotateCcw,
} from 'lucide-react';
import {
  fetchListLayoutFields,
  saveListLayout,
  resetListLayout,
  type ListLayoutFieldOption,
} from '../../api/servicenow';
import type { ViewField, ListLayoutKind } from '../utils/viewFields';
import { Z_INDEX } from '../utils/layering';

export interface ListColumnPersonalizerProps {
  table: string;
  viewTitle: string;
  tableLabel: string;
  initialColumns: ViewField[];
  resolvedLayout: ListLayoutKind;
  onClose: () => void;
  onSaved: (result: { fields: ViewField[]; resolvedLayout: ListLayoutKind }) => void;
}

const REQUIRED_COLUMN = 'name';

function rangeKeys(items: { element: string }[], from: number, to: number): Set<string> {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const keys = new Set<string>();
  for (let i = start; i <= end; i++) {
    if (items[i]) keys.add(items[i].element);
  }
  return keys;
}

function handleListSelect(
  index: number,
  items: { element: string }[],
  shiftKey: boolean,
  metaKey: boolean,
  anchorRef: { current: number | null },
  setSelection: Dispatch<SetStateAction<Set<string>>>,
) {
  if (shiftKey && anchorRef.current !== null) {
    setSelection(rangeKeys(items, anchorRef.current, index));
    return;
  }
  if (metaKey) {
    setSelection(prev => {
      const next = new Set(prev);
      const key = items[index]?.element;
      if (!key) return prev;
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    anchorRef.current = index;
    return;
  }
  const key = items[index]?.element;
  if (key) setSelection(new Set([key]));
  anchorRef.current = index;
}

export default function ListColumnPersonalizer({
  table,
  viewTitle,
  tableLabel,
  initialColumns,
  resolvedLayout,
  onClose,
  onSaved,
}: ListColumnPersonalizerProps) {
  const [available, setAvailable] = useState<ListLayoutFieldOption[]>([]);
  const [selected, setSelected] = useState<ViewField[]>(initialColumns);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedAvailableKeys, setSelectedAvailableKeys] = useState<Set<string>>(new Set());
  const [selectedSelectedKeys, setSelectedSelectedKeys] = useState<Set<string>>(new Set());
  const availableAnchorRef = useRef<number | null>(null);
  const selectedAnchorRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchListLayoutFields(table, viewTitle)
      .then(fields => {
        if (cancelled) return;
        setAvailable(fields);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load available fields.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [table, viewTitle]);

  const selectedSet = useMemo(
    () => new Set(selected.map(f => f.element)),
    [selected],
  );

  const filteredAvailable = useMemo(() => {
    const q = search.trim().toLowerCase();
    return available.filter(f => {
      if (selectedSet.has(f.element)) return false;
      if (!q) return true;
      return f.label.toLowerCase().includes(q) || f.element.toLowerCase().includes(q);
    });
  }, [available, selectedSet, search]);

  const addFields = useCallback((fields: ListLayoutFieldOption[]) => {
    if (!fields.length) return;
    setSelected(prev => [
      ...prev,
      ...fields.map(f => ({ element: f.element, label: f.label })),
    ]);
    setSelectedAvailableKeys(new Set());
    availableAnchorRef.current = null;
  }, []);

  const removeFields = useCallback((elements: string[]) => {
    const toRemove = new Set(elements.filter(el => el !== REQUIRED_COLUMN));
    if (!toRemove.size) return;
    setSelected(prev => prev.filter(f => !toRemove.has(f.element)));
    setSelectedSelectedKeys(new Set());
    selectedAnchorRef.current = null;
  }, []);

  const addSelectedAvailable = useCallback(() => {
    const fields = filteredAvailable.filter(f => selectedAvailableKeys.has(f.element));
    addFields(fields);
  }, [filteredAvailable, selectedAvailableKeys, addFields]);

  const removeSelectedSelected = useCallback(() => {
    removeFields([...selectedSelectedKeys]);
  }, [selectedSelectedKeys, removeFields]);

  const moveSelectedBlock = useCallback((direction: -1 | 1) => {
    setSelected(prev => {
      const indices = prev
        .map((f, i) => (selectedSelectedKeys.has(f.element) ? i : -1))
        .filter(i => i >= 0);
      if (!indices.length) return prev;

      const blockStart = Math.min(...indices);
      const blockEnd = Math.max(...indices);
      const targetStart = blockStart + direction;
      const targetEnd = blockEnd + direction;

      if (targetStart < 0 || targetEnd >= prev.length) return prev;
      if (direction === -1 && blockStart === 0) return prev;

      const copy = [...prev];
      const block = indices.map(i => copy[i]);
      for (let i = indices.length - 1; i >= 0; i--) {
        copy.splice(indices[i], 1);
      }
      copy.splice(targetStart, 0, ...block);
      return copy;
    });
  }, [selectedSelectedKeys]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const columns = selected.map(f => f.element);
    const result = await saveListLayout(table, viewTitle, columns);
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved({
      fields: result.result.fields,
      resolvedLayout: result.result.resolved_layout,
    });
    onClose();
  };

  const handleReset = async () => {
    setResetting(true);
    setError(null);
    const result = await resetListLayout(table, viewTitle);
    setResetting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onSaved({
      fields: result.result.fields,
      resolvedLayout: result.result.resolved_layout,
    });
    onClose();
  };

  const busy = saving || resetting;
  const canAddAvailable = selectedAvailableKeys.size > 0;
  const canActOnSelected = selectedSelectedKeys.size > 0;
  const canRemoveSelected = [...selectedSelectedKeys].some(k => k !== REQUIRED_COLUMN);

  const selectedIndices = selected
    .map((f, i) => (selectedSelectedKeys.has(f.element) ? i : -1))
    .filter(i => i >= 0);
  const canMoveUp = canActOnSelected
    && selectedIndices.length > 0
    && Math.min(...selectedIndices) > 0;
  const canMoveDown = canActOnSelected
    && selectedIndices.length > 0
    && Math.max(...selectedIndices) < selected.length - 1;

  return createPortal(
    <div
      className="clsa-portal fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      style={{ zIndex: Z_INDEX.modal }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="typo-section-title text-gray-900">Personalize columns</h2>
            <p className="typo-page-subtitle mt-0.5 truncate">{tableLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 hover:bg-gray-100 rounded-lg shrink-0 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden px-6 py-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2 typo-body">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading fields…
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 h-[min(52vh,480px)]">
              {/* Available fields */}
              <div className="flex flex-col min-h-0 h-full border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
                  <p className="typo-label text-gray-700">Available fields</p>
                  <p className="typo-caption text-gray-500 mt-0.5">Shift+click to select a range.</p>
                  <div className="relative mt-2">
                    <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      placeholder="Search fields…"
                      className="w-full pl-8 pr-3 py-1.5 border border-gray-300 rounded-md typo-body"
                    />
                  </div>
                </div>
                <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100">
                  {filteredAvailable.length === 0 ? (
                    <li className="px-3 py-6 text-center typo-body text-gray-400">No matching fields</li>
                  ) : (
                    filteredAvailable.map((field, index) => (
                      <li key={field.element}>
                        <button
                          type="button"
                          onClick={e => handleListSelect(
                            index,
                            filteredAvailable,
                            e.shiftKey,
                            e.metaKey || e.ctrlKey,
                            availableAnchorRef,
                            setSelectedAvailableKeys,
                          )}
                          onDoubleClick={() => addFields([field])}
                          className={`w-full text-left px-3 py-2 typo-body hover:bg-blue-50 transition-colors ${
                            selectedAvailableKeys.has(field.element)
                              ? 'bg-blue-50 text-blue-900'
                              : 'text-gray-800'
                          }`}
                        >
                          <span className="block font-medium">{field.label}</span>
                          <span className="block typo-caption text-gray-500">{field.element}</span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
                <div className="px-3 py-2 border-t border-gray-200 bg-gray-50 shrink-0">
                  <button
                    type="button"
                    disabled={!canAddAvailable || busy}
                    onClick={addSelectedAvailable}
                    className="w-full px-3 py-1.5 border border-gray-300 rounded-md typo-body text-gray-700 hover:bg-white disabled:opacity-40"
                  >
                    Add selected
                  </button>
                </div>
              </div>

              {/* Transfer buttons */}
              <div className="flex md:flex-col items-center justify-center gap-2 py-2 shrink-0">
                <button
                  type="button"
                  disabled={!canAddAvailable || busy}
                  onClick={addSelectedAvailable}
                  className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                  aria-label="Add selected columns"
                  title="Add selected"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  disabled={!canRemoveSelected || busy}
                  onClick={removeSelectedSelected}
                  className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40"
                  aria-label="Remove selected columns"
                  title="Remove selected"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              </div>

              {/* Selected columns */}
              <div className="flex flex-col min-h-0 h-full border border-gray-200 rounded-lg overflow-hidden">
                <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 shrink-0">
                  <p className="typo-label text-gray-700">Selected columns ({selected.length})</p>
                  <p className="typo-caption text-gray-500 mt-0.5">
                    Name is required. Shift+click to select a range.
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <button
                      type="button"
                      disabled={!canMoveUp || busy}
                      onClick={() => moveSelectedBlock(-1)}
                      className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded-md typo-caption text-gray-700 hover:bg-white disabled:opacity-40"
                    >
                      <ChevronUp className="w-3.5 h-3.5" /> Move up
                    </button>
                    <button
                      type="button"
                      disabled={!canMoveDown || busy}
                      onClick={() => moveSelectedBlock(1)}
                      className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded-md typo-caption text-gray-700 hover:bg-white disabled:opacity-40"
                    >
                      <ChevronDown className="w-3.5 h-3.5" /> Move down
                    </button>
                    <button
                      type="button"
                      disabled={!canRemoveSelected || busy}
                      onClick={removeSelectedSelected}
                      className="inline-flex items-center gap-1 px-2 py-1 border border-gray-300 rounded-md typo-caption text-gray-700 hover:bg-white disabled:opacity-40"
                    >
                      Remove selected
                    </button>
                  </div>
                </div>
                <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-gray-100">
                  {selected.map((field, index) => {
                    const isRequired = field.element === REQUIRED_COLUMN;
                    return (
                      <li key={field.element}>
                        <button
                          type="button"
                          onClick={e => handleListSelect(
                            index,
                            selected,
                            e.shiftKey,
                            e.metaKey || e.ctrlKey,
                            selectedAnchorRef,
                            setSelectedSelectedKeys,
                          )}
                          onDoubleClick={() => !isRequired && removeFields([field.element])}
                          className={`w-full text-left px-3 py-2 typo-body hover:bg-blue-50 transition-colors min-w-0 ${
                            selectedSelectedKeys.has(field.element)
                              ? 'bg-blue-50 text-blue-900'
                              : 'text-gray-800'
                          }`}
                        >
                          <span className="block font-medium truncate">
                            {field.label}
                            {isRequired && <span className="typo-caption text-gray-500 ml-1">(required)</span>}
                          </span>
                          <span className="block typo-caption text-gray-500 truncate">{field.element}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="px-6 pb-2 shrink-0">
            <p className="typo-body text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-200 shrink-0">
          <div>
            {resolvedLayout === 'personal' && (
              <button
                type="button"
                onClick={handleReset}
                disabled={busy || loading}
                className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg typo-body text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {resetting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Reset to default
              </button>
            )}
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 border border-gray-300 rounded-lg typo-body text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading || busy || selected.length === 0}
              className="px-4 py-2 bg-blue-900 text-white rounded-lg typo-body hover:bg-blue-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save columns
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

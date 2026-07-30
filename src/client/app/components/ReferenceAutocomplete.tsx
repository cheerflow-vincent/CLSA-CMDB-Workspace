import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { searchReferenceTable, getTableLabel, resolveReferenceList, type ReferenceOption } from '../../api/servicenow';
import type { EditFieldValue } from '../utils/viewFields';
import { editDisplayValue, editRawValue } from '../utils/editValues';
import { needsReferenceDisplayResolve } from '../utils/editFormLoad';

function inputShellClass(disabled: boolean, focused: boolean): string {
  return `flex items-center border rounded-lg px-3 py-2 gap-2 transition-colors ${
    disabled
      ? 'bg-gray-50 cursor-not-allowed opacity-60 border-gray-200'
      : focused
        ? 'border-blue-400 ring-1 ring-blue-300 bg-white'
        : 'border-gray-300 bg-white'
  }`;
}

export interface ReferenceAutocompleteProps {
  label: string;
  referenceTable: string;
  value: EditFieldValue;
  disabled?: boolean;
  onChange: (value: EditFieldValue) => void;
}

export default function ReferenceAutocomplete({
  label,
  referenceTable,
  value,
  disabled = false,
  onChange,
}: ReferenceAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableLabel, setTableLabel] = useState('');
  const [resolvedLabel, setResolvedLabel] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedId = editRawValue(value);
  const selectedLabel = resolvedLabel || editDisplayValue(value);

  useEffect(() => {
    setResolvedLabel('');
  }, [value, referenceTable]);

  useEffect(() => {
    if (!referenceTable || !needsReferenceDisplayResolve(value)) return;
    let cancelled = false;
    const id = editRawValue(value);
    resolveReferenceList(referenceTable, [id])
      .then(opts => {
        const label = opts[0]?.display;
        if (!cancelled && label && label !== id) {
          setResolvedLabel(label);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [referenceTable, value]);

  useEffect(() => {
    if (!referenceTable) {
      setTableLabel('');
      return;
    }
    let cancelled = false;
    getTableLabel(referenceTable)
      .then(lbl => { if (!cancelled) setTableLabel(lbl); })
      .catch(() => { if (!cancelled) setTableLabel(referenceTable); });
    return () => { cancelled = true; };
  }, [referenceTable]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const runSearch = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!referenceTable || !text.trim()) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      searchReferenceTable(referenceTable, text)
        .then(setOptions)
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 280);
  }, [referenceTable]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const pick = (opt: ReferenceOption) => {
    onChange({ value: opt.sys_id, display_value: opt.display });
    setQuery('');
    setOpen(false);
    setOptions([]);
  };

  const clear = () => {
    onChange({ value: '', display_value: '' });
    setQuery('');
    setOptions([]);
  };

  const placeholder = tableLabel ? `Search ${tableLabel}…` : 'Search…';

  if (disabled) {
    return (
      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
        <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-600 min-h-[38px] break-words">
          {selectedLabel || '—'}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="min-w-0 relative">
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className={inputShellClass(false, open)}>
        {loading
          ? <Loader2 className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />
          : <Search className="w-4 h-4 text-gray-400 shrink-0" />}
        <input
          type="text"
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400 min-w-0"
          placeholder={placeholder}
          value={open ? query : selectedLabel}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            runSearch(e.target.value);
          }}
          onFocus={() => {
            setQuery('');
            setOpen(true);
          }}
        />
        {selectedId && !open && (
          <button type="button" onClick={clear} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[60] bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto py-1">
          {loading && (
            <p className="px-3 py-2 text-xs text-gray-400 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
            </p>
          )}
          {!loading && options.length === 0 && query.trim() && (
            <p className="px-3 py-2 text-xs text-gray-400">No matches</p>
          )}
          {!loading && !query.trim() && (
            <p className="px-3 py-2 text-xs text-gray-400">Type to search by name</p>
          )}
          {options.map(opt => (
            <button
              key={opt.sys_id}
              type="button"
              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 transition-colors ${
                opt.sys_id === selectedId ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-800'
              }`}
              onClick={() => pick(opt)}
            >
              {opt.display}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

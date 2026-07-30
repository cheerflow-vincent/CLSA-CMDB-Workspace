import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Loader2, Plus } from 'lucide-react';
import {
  searchReferenceTable,
  resolveReferenceList,
  getTableLabel,
  type ReferenceOption,
} from '../../api/servicenow';
import type { EditFieldValue } from '../utils/viewFields';
import {
  parseListFieldValue,
  serializeListFieldValue,
  type ListItemValue,
} from '../utils/editValues';

export interface ListCollectorFieldProps {
  label: string;
  referenceTable: string;
  value: EditFieldValue;
  disabled?: boolean;
  onChange: (value: EditFieldValue) => void;
}

export default function ListCollectorField({
  label,
  referenceTable,
  value,
  disabled = false,
  onChange,
}: ListCollectorFieldProps) {
  const [items, setItems] = useState<ListItemValue[]>(() => parseListFieldValue(value));
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableLabel, setTableLabel] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setItems(parseListFieldValue(value));
  }, [value]);

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
    const ids = parseListFieldValue(value).map(i => i.value);
    const parsed = parseListFieldValue(value);
    const needsResolve = parsed.some(i => i.display === i.value && i.value.length === 32);
    if (!referenceTable || !needsResolve || !ids.length) return;

    resolveReferenceList(referenceTable, ids)
      .then(resolved => {
        if (resolved.length) {
          setItems(resolved.map(r => ({ value: r.sys_id, display: r.display })));
        }
      })
      .catch(() => {});
  }, [referenceTable, value]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const commit = (next: ListItemValue[]) => {
    setItems(next);
    onChange(serializeListFieldValue(next));
  };

  const runSearch = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!text.trim()) {
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

  const addItem = (opt: ReferenceOption) => {
    if (items.some(i => i.value === opt.sys_id)) return;
    commit([...items, { value: opt.sys_id, display: opt.display }]);
    setQuery('');
    setOptions([]);
    setOpen(false);
  };

  const removeItem = (sysId: string) => {
    commit(items.filter(i => i.value !== sysId));
  };

  const selectedIds = new Set(items.map(i => i.value));
  const addPlaceholder = tableLabel ? `Add from ${tableLabel}…` : 'Search to add…';

  if (disabled) {
    return (
      <div className="min-w-0">
        <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
        <div className="flex flex-wrap gap-1.5">
          {items.length === 0 && <span className="text-sm text-gray-500">—</span>}
          {items.map(item => (
            <span
              key={item.value}
              className="inline-flex px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 text-xs border border-gray-200"
            >
              {item.display}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="min-w-0 relative">
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>

      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map(item => (
            <span
              key={item.value}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 text-xs border border-blue-200"
            >
              {item.display}
              <button
                type="button"
                onClick={() => removeItem(item.value)}
                className="text-blue-500 hover:text-blue-800"
                aria-label={`Remove ${item.display}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={`flex items-center border rounded-lg px-3 py-2 gap-2 transition-colors ${
        open ? 'border-blue-400 ring-1 ring-blue-300 bg-white' : 'border-gray-300 bg-white'
      }`}>
        <Plus className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          type="text"
          className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400 min-w-0"
          placeholder={addPlaceholder}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            runSearch(e.target.value);
          }}
          onFocus={() => {
            setOpen(true);
            if (query) runSearch(query);
          }}
        />
        {loading && <Loader2 className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />}
      </div>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-[60] bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto py-1">
          {!loading && options.length === 0 && query.trim() && (
            <p className="px-3 py-2 text-xs text-gray-400">No matches</p>
          )}
          {!loading && !query.trim() && (
            <p className="px-3 py-2 text-xs text-gray-400">Type to search and add</p>
          )}
          {options
            .filter(opt => !selectedIds.has(opt.sys_id))
            .map(opt => (
              <button
                key={opt.sys_id}
                type="button"
                className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-blue-50 transition-colors"
                onClick={() => addItem(opt)}
              >
                {opt.display}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

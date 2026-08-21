import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Loader2 } from 'lucide-react';
import { searchReferenceTable, getTableLabel, resolveReferenceList, type ReferenceOption } from '../../api/servicenow';
import type { EditFieldValue } from '../utils/viewFields';
import { editDisplayValue, editRawValue } from '../utils/editValues';
import { needsReferenceDisplayResolve } from '../utils/editFormLoad';
import EditFieldLabel from './EditFieldLabel';

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
  required?: boolean;
  referenceTable: string;
  /** Additional encoded query filters prepended to every search (e.g. u_service_type=instance). */
  referenceQuery?: string;
  value: EditFieldValue;
  disabled?: boolean;
  onChange: (value: EditFieldValue) => void;
  onOpenChange?: (open: boolean) => void;
}

export default function ReferenceAutocomplete({
  label,
  required = false,
  referenceTable,
  referenceQuery = '',
  value,
  disabled = false,
  onChange,
  onOpenChange,
}: ReferenceAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ReferenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [tableLabel, setTableLabel] = useState('');
  const [resolvedLabel, setResolvedLabel] = useState('');
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedId = editRawValue(value);
  const selectedLabel = resolvedLabel || editDisplayValue(value);

  const setDropdownOpen = useCallback((next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);

  const updateMenuPosition = useCallback(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      zIndex: 10050,
    });
  }, []);

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
    if (!open) return;
    updateMenuPosition();
    const onReposition = () => updateMenuPosition();
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, updateMenuPosition]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setDropdownOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [setDropdownOpen]);

  const runSearch = useCallback((text: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!referenceTable || !text.trim()) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      searchReferenceTable(referenceTable, text, 15, referenceQuery)
        .then(setOptions)
        .catch(() => setOptions([]))
        .finally(() => setLoading(false));
    }, 280);
  }, [referenceTable, referenceQuery]);

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const pick = (opt: ReferenceOption) => {
    onChange({ value: opt.sys_id, display_value: opt.display });
    setQuery('');
    setDropdownOpen(false);
    setOptions([]);
  };

  const clear = () => {
    onChange({ value: '', display_value: '' });
    setQuery('');
    setOptions([]);
  };

  const placeholder = tableLabel ? `Search ${tableLabel}…` : 'Search…';

  const dropdownMenu = open ? (
    <div
      ref={menuRef}
      style={menuStyle}
      className="clsa-portal bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto py-1"
    >
      {loading && (
        <p className="px-3 py-2 typo-caption flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Searching…
        </p>
      )}
      {!loading && options.length === 0 && query.trim() && (
        <p className="px-3 py-2 typo-caption">No matches</p>
      )}
      {!loading && !query.trim() && (
        <p className="px-3 py-2 typo-caption">Type to search by name</p>
      )}
      {options.map(opt => (
        <button
          key={opt.sys_id}
          type="button"
          className={`w-full text-left px-3 py-2 typo-body hover:bg-blue-50 transition-colors ${
            opt.sys_id === selectedId ? 'bg-blue-50 text-blue-800 font-medium' : 'text-gray-800'
          }`}
          onClick={() => pick(opt)}
        >
          {opt.display}
        </button>
      ))}
    </div>
  ) : null;

  if (disabled) {
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <div className="w-full border border-gray-200 rounded-lg px-3 py-2 typo-body bg-gray-50 text-gray-600 min-h-[38px] break-words">
          {selectedLabel || '—'}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="min-w-0 relative">
      <EditFieldLabel label={label} required={required} />
      <div className={inputShellClass(false, open)}>
        {loading
          ? <Loader2 className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />
          : <Search className="w-4 h-4 text-gray-400 shrink-0" />}
        <input
          type="text"
          className="flex-1 typo-body bg-transparent outline-none placeholder-gray-400 min-w-0"
          placeholder={placeholder}
          value={open ? query : selectedLabel}
          onChange={e => {
            setQuery(e.target.value);
            setDropdownOpen(true);
            runSearch(e.target.value);
          }}
          onFocus={() => {
            setQuery('');
            setDropdownOpen(true);
          }}
        />
        {selectedId && !open && (
          <button type="button" onClick={clear} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {dropdownMenu && createPortal(dropdownMenu, document.body)}
    </div>
  );
}

import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { hasSearchableTokens } from '../utils/searchQuery';
import {
  searchAppFamilyInstanceOptions,
  familyKindLabel,
  type AppFilterSelection,
  type AppFamilyInstanceOption,
} from '../utils/ciSearchAppFilter';

interface AppFamilyInstanceAutocompleteProps {
  readonly value: AppFilterSelection | null;
  readonly onChange: (value: AppFilterSelection | null) => void;
  readonly hierarchyMode: boolean;
  readonly disabled?: boolean;
  /** Match toolbar height in CISearchView search row. */
  readonly compact?: boolean;
  readonly className?: string;
  /** id applied to the text input so an external <label htmlFor> can associate with it. */
  readonly inputId?: string;
}

function optionToSelection(opt: AppFamilyInstanceOption): AppFilterSelection {
  return { sysId: opt.sysId, name: opt.name, kind: opt.kind };
}

export default function AppFamilyInstanceAutocomplete({
  value,
  onChange,
  hierarchyMode,
  disabled = false,
  compact = false,
  className = '',
  inputId,
}: AppFamilyInstanceAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [options, setOptions] = useState<AppFamilyInstanceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const search = useCallback(async (term: string) => {
    if (!hasSearchableTokens(term)) {
      setOptions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const results = await searchAppFamilyInstanceOptions(term.trim(), hierarchyMode);
      setOptions(results);
    } catch {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  }, [hierarchyMode]);

  useEffect(() => {
    search(debounced);
  }, [debounced, search]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleSelect = (opt: AppFamilyInstanceOption) => {
    onChange(optionToSelection(opt));
    setQuery('');
    setDebounced('');
    setOptions([]);
    setOpen(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
    setDebounced('');
    setOptions([]);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      if (!value) setQuery('');
    }
    if (e.key === 'Enter' && options.length > 0) {
      handleSelect(options[0]);
    }
  };

  const familyLabel = familyKindLabel(hierarchyMode);
  const displayValue = open ? query : (value?.name ?? '');
  const showDropdown = open && hasSearchableTokens(query) && !disabled;

  const inputPad = compact ? 'py-2.5' : 'py-2';

  return (
    <div ref={containerRef} className={`relative min-w-0 ${className}`}>
      <div
        className={`flex items-center border rounded-lg bg-white px-3 ${inputPad} gap-2 transition-colors h-full
          ${disabled ? 'bg-gray-50 cursor-not-allowed opacity-60' : ''}
          ${open && !disabled ? 'border-blue-400 ring-1 ring-blue-300' : 'border-gray-300'}`}
      >
        {loading
          ? <Loader2 className="w-4 h-4 text-gray-400 shrink-0 animate-spin" />
          : <Search className="w-4 h-4 text-gray-400 shrink-0" />
        }
        <input
          id={inputId}
          type="text"
          className="flex-1 typo-body bg-transparent outline-none placeholder-gray-400 min-w-0 disabled:cursor-not-allowed"
          placeholder={compact ? 'App or Instance…' : `Search ${familyLabel} or Instance…`}
          value={displayValue}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (!disabled) { setQuery(''); setOpen(true); } }}
          onKeyDown={handleKeyDown}
        />
        {value && !open && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="text-gray-400 hover:text-gray-600 shrink-0"
            aria-label="Clear app filter"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {showDropdown && options.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl max-h-52 overflow-y-auto py-1">
          {options.map(opt => (
            <button
              key={`${opt.kind}-${opt.sysId}`}
              type="button"
              onClick={() => handleSelect(opt)}
              className={`w-full text-left px-4 py-2.5 typo-body hover:bg-blue-50 transition-colors flex items-center justify-between gap-2
                ${value?.sysId === opt.sysId && value?.kind === opt.kind ? 'text-blue-700 bg-blue-50' : 'text-gray-800'}`}
            >
              <span className="truncate">{opt.name}</span>
              <span className="shrink-0 typo-badge px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {opt.kind === 'family' ? familyLabel : 'Instance'}
              </span>
            </button>
          ))}
        </div>
      )}

      {showDropdown && !loading && options.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl px-4 py-3 typo-page-subtitle">
          No applications match &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  );
}

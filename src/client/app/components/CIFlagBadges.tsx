import { AlertCircle, Calendar } from 'lucide-react';
import type { FlagType } from './FlagDetailPanel';

export default function CIFlagBadges({
  incidents,
  changes,
  onFlagClick,
  size = 'sm',
}: {
  readonly incidents: number;
  readonly changes: number;
  readonly onFlagClick?: (type: FlagType) => void;
  /** sm = related list sidebar; md = CI search results */
  readonly size?: 'sm' | 'md';
}) {
  if (!incidents && !changes) return null;

  const iconCls = size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3';
  const textCls = 'typo-badge';
  const padCls = size === 'md' ? 'px-1.5 py-0.5' : 'px-1 py-0.5';

  return (
    <span className="inline-flex items-center gap-1 flex-shrink-0">
      {incidents > 0 && (
        <button
          type="button"
          title={`${incidents} active incident${incidents !== 1 ? 's' : ''}`}
          onClick={e => { e.stopPropagation(); onFlagClick?.('incident'); }}
          className={`inline-flex items-center gap-0.5 ${padCls} bg-red-50 text-red-700 rounded ${textCls} font-medium border border-red-200 hover:bg-red-100 transition-colors`}
        >
          <AlertCircle className={iconCls} />
          {incidents}
        </button>
      )}
      {changes > 0 && (
        <button
          type="button"
          title={`${changes} upcoming change${changes !== 1 ? 's' : ''}`}
          onClick={e => { e.stopPropagation(); onFlagClick?.('change'); }}
          className={`inline-flex items-center gap-0.5 ${padCls} bg-yellow-50 text-yellow-700 rounded ${textCls} font-medium border border-yellow-200 hover:bg-yellow-100 transition-colors`}
        >
          <Calendar className={iconCls} />
          {changes}
        </button>
      )}
    </span>
  );
}

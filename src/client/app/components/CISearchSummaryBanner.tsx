import { AlertCircle, Calendar, Loader2, Shield } from 'lucide-react';
import type { TableAccess } from '../../api/servicenow';
import { isAccessDenied } from '../utils/acl';
import type { SummaryFlagType } from '../utils/ciSearchSummary';

export interface CiSearchSummaryBannerProps {
  incidents: number;
  changes: number;
  health: number;
  access: {
    incidents: TableAccess;
    changes: TableAccess;
    health: TableAccess;
  };
  loading: boolean;
  matchingCiCount: number;
  onChipClick: (flagType: SummaryFlagType) => void;
}

export default function CISearchSummaryBanner({
  incidents,
  changes,
  health,
  access,
  loading,
  matchingCiCount,
  onChipClick,
}: CiSearchSummaryBannerProps) {
  const showIncidents = !isAccessDenied(access.incidents) && incidents > 0;
  const showChanges = !isAccessDenied(access.changes) && changes > 0;
  const showHealth = !isAccessDenied(access.health) && health > 0;

  if (loading) {
    return (
      <div className="mx-6 my-4 flex items-center gap-2 typo-body text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
        Loading summary…
      </div>
    );
  }

  if (!showIncidents && !showChanges && !showHealth) {
    return null;
  }

  return (
    <div className="mx-6 my-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
      <div className="flex flex-wrap items-center gap-3">
        {showIncidents && (
          <button
            type="button"
            onClick={() => onChipClick('incident')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 transition-colors typo-body font-medium"
          >
            <AlertCircle className="w-4 h-4" />
            {incidents.toLocaleString()} Active Incident{incidents !== 1 ? 's' : ''}
          </button>
        )}
        {showChanges && (
          <button
            type="button"
            onClick={() => onChipClick('change')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-700 hover:bg-yellow-100 transition-colors typo-body font-medium"
          >
            <Calendar className="w-4 h-4" />
            {changes.toLocaleString()} Upcoming Change{changes !== 1 ? 's' : ''}
          </button>
        )}
        {showHealth && (
          <button
            type="button"
            onClick={() => onChipClick('health')}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors typo-body font-medium"
          >
            <Shield className="w-4 h-4" />
            {health.toLocaleString()} Active Health Metric{health !== 1 ? 's' : ''}
          </button>
        )}
      </div>
      <p className="typo-caption text-gray-500 mt-2">
        Across {matchingCiCount.toLocaleString()} matching CI{matchingCiCount !== 1 ? 's' : ''}
      </p>
    </div>
  );
}

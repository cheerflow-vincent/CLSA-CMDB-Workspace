import { useState, useEffect, type ElementType } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';
import type { CIItem } from './CIDetailView';
import FlagDetailPanel, { type FlagType } from './FlagDetailPanel';
import CIFlagBadges from './CIFlagBadges';
import { type ViewField } from '../utils/viewFields';
import { useNarrowContainer, useResponsiveListVariant } from '../utils/useNarrowLayout';
import {
  fetchRelatedCICount,
  fetchRelatedCICountForCi,
  fetchRelatedCIPage,
  fetchRelatedCIPageForCi,
  RELATED_CI_PAGE_SIZE,
  type RelatedCIConfig,
  type RelatedCIRow,
} from '../utils/relatedCIs';
import {
  fetchRelatedTaskCount,
  fetchRelatedTaskCountForRecord,
  fetchRelatedTaskPage,
  fetchRelatedTaskPageForRecord,
  type RelatedTaskConfig,
  type RelatedTaskRecordContext,
  type RelatedTaskRow,
} from '../utils/relatedTasks';
import { type TableAccess, formatCmdbTableLabel } from '../../api/servicenow';
import { isAccessDenied } from '../utils/acl';
import { TASK_SCOPE_INCLUDE_INFRA_TOOLTIP } from '../utils/relatedTaskScope';
import {
  PriorityBadge,
  StateBadge,
  ChangeTypeBadge,
  TaskCard,
  taskHref,
  val,
} from './taskListCards';

export type RelatedListVariant = 'table' | 'compact' | 'cards';

function envBadgeClass(env: string): string {
  if (env === 'Production') return 'bg-green-100 text-green-700';
  if (env === 'DR') return 'bg-orange-100 text-orange-700';
  return 'bg-yellow-100 text-yellow-700';
}

function EnvBadge({ env }: { readonly env: string }) {
  const cls = envBadgeClass(env);
  const short = env === 'Non-production' ? 'Non-prod' : env;
  return (
    <span className={`inline-flex typo-badge px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>
      {short}
    </span>
  );
}

function priorityRailClass(priority: string): string {
  if (priority.startsWith('P1') || priority.includes('Critical')) return 'bg-red-500';
  if (priority.startsWith('P2') || priority.includes('High')) return 'bg-orange-500';
  if (priority.startsWith('P3') || priority.includes('Medium')) return 'bg-yellow-500';
  return 'bg-gray-300';
}

function changeRailClass(type: string): string {
  if (type === 'Emergency') return 'bg-red-500';
  if (type === 'Normal') return 'bg-blue-500';
  return 'bg-gray-400';
}

function renderTaskCell(element: string, valStr: string) {
  if (valStr === '—') {
    return <span className="typo-caption">—</span>;
  }
  if (element === 'number') {
    return (
      <span className="font-mono typo-body text-gray-700 truncate block max-w-full" title={valStr}>
        {valStr}
      </span>
    );
  }
  if (element === 'priority') return <PriorityBadge priority={valStr} />;
  if (element === 'state') return <StateBadge state={valStr} />;
  if (element === 'type') return <ChangeTypeBadge type={valStr} />;
  if (element === 'short_description') {
    return (
      <span className="typo-body line-clamp-2 whitespace-pre-line" title={valStr}>
        {valStr}
      </span>
    );
  }
  return (
    <span className="typo-body text-gray-600 truncate block max-w-[120px]" title={valStr}>
      {valStr}
    </span>
  );
}

function TaskCompactRow({
  row,
  config,
  isIncident,
}: {
  readonly row: RelatedTaskRow;
  readonly config: RelatedTaskConfig;
  readonly isIncident: boolean;
}) {
  const number = val(row, 'number') || row.sysId;
  const priority = val(row, 'priority');
  const type = val(row, 'type');
  const state = val(row, 'state');
  const short = val(row, 'short_description');
  const meta = isIncident ? val(row, 'opened_at') : val(row, 'start_date');
  const railCls = isIncident ? priorityRailClass(priority) : changeRailClass(type);

  return (
    <a
      href={taskHref(config, row.sysId)}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-stretch gap-2 px-3 py-2.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0 group"
    >
      <div className={`w-1 rounded-full shrink-0 self-stretch min-h-[2.5rem] ${railCls}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
          <span className="font-mono typo-body font-semibold text-blue-700 group-hover:underline break-words">
            {number}
          </span>
          {isIncident && priority && <PriorityBadge priority={priority} />}
          {!isIncident && type && <ChangeTypeBadge type={type} />}
          {state && <StateBadge state={state} />}
        </div>
        {short && (
          <p className="typo-body text-gray-600 break-words whitespace-pre-line">{short}</p>
        )}
        {meta && (
          <p className="typo-caption mt-1 break-words">{meta}</p>
        )}
      </div>
    </a>
  );
}

function buildCIItem(row: RelatedCIRow): CIItem {
  return {
    id: row.sysId,
    name: row.values.name || row.sysId,
    type: formatCmdbTableLabel(row.sysClass),
    class: row.sysClass,
    table: row.sysClass,
    environment: row.values.environment ?? '',
    location: row.values.location ?? '',
    owner: '',
    supportGroup: '',
    lastModified: '',
    hasIncident: row.incidents > 0,
    hasChange: row.changes > 0,
  };
}


function RelatedCICard({
  row,
  columns,
  onViewCI,
  hoverRow,
  showCIFlags,
  onFlagClick,
}: {
  readonly row: RelatedCIRow;
  readonly columns: ViewField[];
  readonly onViewCI?: (ci: CIItem) => void;
  readonly hoverRow?: string;
  readonly showCIFlags?: boolean;
  readonly onFlagClick?: (type: FlagType) => void;
}) {
  if (!columns.length) return null;

  const headerCol = columns[0];
  const bodyCols = columns.slice(1);
  const title = row.values[headerCol.element] || row.sysId;
  const ciItem = buildCIItem(row);

  return (
    <div className="card-stack border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow bg-white">
      <div className="mb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {onViewCI ? (
            <button
              type="button"
              onClick={() => onViewCI(ciItem)}
              className={`typo-panel-title text-blue-700 hover:underline text-left break-words ${hoverRow ?? ''}`}
            >
              {title}
            </button>
          ) : (
            <span className="typo-panel-title break-words">{title}</span>
          )}
          {showCIFlags && (
            <CIFlagBadges
              incidents={row.incidents}
              changes={row.changes}
              onFlagClick={onFlagClick}
            />
          )}
        </div>
      </div>
      {bodyCols.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-1">
          {bodyCols.map(col => {
            if (!(col.element in row.values)) return null;
            const value = row.values[col.element];
            if (!value || value === '—') return null;
            if (col.element === 'environment') {
              return (
                <div key={col.element} className="rf-field-row rf-field-row--badge">
                  <span className="rf-field-row__label">{col.label}</span>
                  <EnvBadge env={value} />
                </div>
              );
            }
            return (
              <div key={col.element} className="rf-field-grid">
                <span className="rf-field-row__label">{col.label}</span>
                <span className="rf-field-row__value">{value}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function isTaskConfig(
  config: RelatedCIConfig | RelatedTaskConfig,
): config is RelatedTaskConfig {
  return 'extraQuery' in config;
}

function PaginationBar({
  start,
  end,
  totalCount,
  page,
  pageSize,
  onPrev,
  onNext,
}: {
  readonly start: number;
  readonly end: number;
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}) {
  return (
    <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
      <span className="typo-caption">
        Showing {start}–{end} of {totalCount}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          onClick={onPrev}
          disabled={page === 0}
          className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-4 h-4 text-gray-600" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={(page + 1) * pageSize >= totalCount}
          className="p-1 hover:bg-gray-200 rounded disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Next page"
        >
          <ChevronRight className="w-4 h-4 text-gray-600" />
        </button>
      </div>
    </div>
  );
}

export default function RelatedListSection({
  config,
  recordSysId,
  ciSysId,
  isOpen,
  onToggle,
  onViewCI,
  title,
  Icon,
  iconBg,
  iconColor,
  badgeBg,
  badgeText,
  badgeBorder,
  hoverRow,
  emptyMessage,
  recordContext,
  refreshKey = 0,
  variant = 'table',
  embedded = false,
  responsiveLayout = true,
  showCIFlags = false,
  nodeSearch = '',
}: {
  readonly config: RelatedCIConfig | RelatedTaskConfig;
  readonly recordSysId?: string;
  /** When set, load direct infra relationships from cmdb_rel_ci for this CI. */
  readonly ciSysId?: string;
  readonly isOpen: boolean;
  readonly onToggle: () => void;
  readonly onViewCI?: (ci: CIItem) => void;
  readonly title: string;
  readonly Icon: ElementType;
  readonly iconBg: string;
  readonly iconColor: string;
  readonly badgeBg: string;
  readonly badgeText: string;
  readonly badgeBorder: string;
  readonly hoverRow?: string;
  readonly emptyMessage?: string;
  /** Resolves emptyMessage from task config when prop is omitted. */
  readonly recordContext?: RelatedTaskRecordContext;
  /** Bump to refetch count and list data. */
  readonly refreshKey?: number;
  readonly variant?: RelatedListVariant;
  readonly embedded?: boolean;
  /** When false, keep table/compact layout even in narrow containers (e.g. app detail sidebar). */
  readonly responsiveLayout?: boolean;
  /** Show incident/change flag badges next to related CI names. */
  readonly showCIFlags?: boolean;
  /** Client-side filter for related CI name (infrastructure table search). */
  readonly nodeSearch?: string;
}) {
  const [flagPanel, setFlagPanel] = useState<{
    recordSysId: string;
    ciName: string;
    flagType: FlagType;
  } | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [columns, setColumns] = useState<ViewField[]>([]);
  const [rows, setRows] = useState<Array<RelatedCIRow | RelatedTaskRow>>([]);
  const [loading, setLoading] = useState(false);
  const [access, setAccess] = useState<TableAccess>('ok');
  const taskMode = isTaskConfig(config);
  const taskConfig = taskMode ? config : null;
  const includeInfraTasks = taskMode && recordContext === 'application';
  const resolvedEmptyMessage =
    emptyMessage ??
    (recordContext && taskConfig?.emptyMessages?.[recordContext]) ??
    'No related records found.';
  const isIncident = taskConfig?.taskClass === 'incident';
  const displayVariant = taskMode ? variant : 'table';
  const { ref: narrowRef, narrow } = useNarrowContainer();
  const responsiveVariant = useResponsiveListVariant(displayVariant, narrow, 'cards');
  const resolvedVariant = responsiveLayout ? responsiveVariant : displayVariant;
  const contentOpen = embedded || isOpen;
  const ciMode = !taskMode && !!ciSysId;
  const anchorId = ciMode ? ciSysId : recordSysId;

  useEffect(() => {
    setPage(0);
    setRows([]);
    setColumns([]);
    if (!anchorId) {
      setTotalCount(0);
      setAccess('ok');
      return;
    }
    const buildLoadCount = () => {
      if (taskMode) {
        return fetchRelatedTaskCountForRecord(anchorId, config, { includeInfra: includeInfraTasks });
      }
      if (ciMode) return fetchRelatedCICountForCi(ciSysId!, config as RelatedCIConfig);
      return fetchRelatedCICount(anchorId, config as RelatedCIConfig);
    };
    const loadCount = buildLoadCount();
    loadCount
      .then(({ totalCount: count, access: acc }) => {
        setTotalCount(count);
        setAccess(acc);
      })
      .catch(() => {
        setTotalCount(0);
        setAccess('error');
      });
  }, [anchorId, ciSysId, ciMode, recordSysId, config, taskMode, includeInfraTasks, refreshKey]);

  useEffect(() => {
    if (!contentOpen || !anchorId) return;
    setLoading(true);
    const buildLoadPage = () => {
      if (taskMode) {
        return fetchRelatedTaskPageForRecord(anchorId, config, page, undefined, { includeInfra: includeInfraTasks });
      }
      if (ciMode) return fetchRelatedCIPageForCi(ciSysId!, config as RelatedCIConfig, page);
      return fetchRelatedCIPage(anchorId, config as RelatedCIConfig, page);
    };
    const loadPage = buildLoadPage();
    loadPage
      .then(({ rows: pageRows, columns: pageCols, totalCount: count, access: acc }) => {
        setRows(pageRows);
        setColumns(pageCols);
        setTotalCount(count);
        setAccess(acc);
      })
      .catch(() => {
        setRows([]);
        setColumns('defaultColumns' in config ? config.defaultColumns : []);
        setAccess('error');
      })
      .finally(() => setLoading(false));
  }, [contentOpen, anchorId, ciSysId, ciMode, recordSysId, page, config, taskMode, includeInfraTasks, refreshKey]);

  const searchQ = nodeSearch.trim().toLowerCase();
  const displayRows = !taskMode && searchQ
    ? (rows as RelatedCIRow[]).filter(row => {
        const name = (row.values.name || '').toLowerCase();
        const rel = (row.relType || '').toLowerCase();
        return name.includes(searchQ) || rel.includes(searchQ);
      })
    : rows;

  const displayColumns = ciMode
    ? [{ element: '__rel_type__', label: 'Relationship' }, ...columns]
    : columns;

  const pageSize = RELATED_CI_PAGE_SIZE;
  const start = totalCount === 0 ? 0 : page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, totalCount);
  const showPagination = totalCount > pageSize;

  function renderCell(
    row: RelatedCIRow | RelatedTaskRow,
    col: ViewField,
    colIdx: number,
  ) {
    if (col.element === '__rel_type__') {
      const ciRow = row as RelatedCIRow;
      const relVal = ciRow.relType || '—';
      return (
        <td key={col.element} className="px-2 py-1.5 typo-body text-gray-600 max-w-[180px]">
          <span className="truncate block" title={relVal}>{relVal}</span>
        </td>
      );
    }

    if (!(col.element in row.values)) return null;
    const cellVal = row.values[col.element] || '—';

    if (taskMode && taskConfig) {
      if (colIdx === 0 && cellVal !== '—') {
        return (
          <td key={col.element} className="px-3 py-1.5 max-w-[150px]">
            <a
              href={taskHref(taskConfig, row.sysId)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono typo-body text-blue-700 truncate block max-w-full hover:underline"
              title={cellVal}
            >
              {cellVal}
            </a>
          </td>
        );
      }
      return (
        <td key={col.element} className="px-2 py-1.5 first:pl-3 max-w-[180px]">
          {renderTaskCell(col.element, cellVal)}
        </td>
      );
    }

    if (col.element === 'name') {
      const ciRow = row as RelatedCIRow;
      const openFlag = (type: FlagType) => {
        setFlagPanel({
          recordSysId: ciRow.sysId,
          ciName: cellVal !== '—' ? cellVal : ciRow.values.name || ciRow.sysId,
          flagType: type,
        });
      };
      return (
        <td key={col.element} className="px-3 py-1.5 max-w-[180px]">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            {onViewCI ? (
              <button
                type="button"
                onClick={() => onViewCI(buildCIItem(ciRow))}
                className={`font-mono typo-body text-blue-700 truncate text-left hover:underline min-w-0 ${hoverRow ?? ''}`}
                title={cellVal}
              >
                {cellVal}
              </button>
            ) : (
              <span className="font-mono typo-body text-gray-700 truncate min-w-0" title={cellVal}>
                {cellVal}
              </span>
            )}
            {showCIFlags && (
              <CIFlagBadges
                incidents={ciRow.incidents}
                changes={ciRow.changes}
                onFlagClick={openFlag}
              />
            )}
          </div>
        </td>
      );
    }
    if (col.element === 'environment' && cellVal !== '—') {
      return (
        <td key={col.element} className="px-2 py-1.5">
          <EnvBadge env={cellVal} />
        </td>
      );
    }
    return (
      <td key={col.element} className="px-2 py-1.5 typo-body text-gray-600 truncate max-w-[120px]" title={cellVal}>
        {cellVal}
      </td>
    );
  }

  function renderTaskList() {
    if (!taskConfig) return null;
    const taskRows = rows as RelatedTaskRow[];

    if (resolvedVariant === 'compact') {
      return (
        <div className="divide-y divide-gray-50">
          {taskRows.map(row => (
            <TaskCompactRow
              key={row.sysId}
              row={row}
              config={taskConfig}
              isIncident={!!isIncident}
            />
          ))}
        </div>
      );
    }

    if (resolvedVariant === 'cards') {
      return (
        <div className="p-4 cards-grid-responsive">
          {taskRows.map(row => (
            <TaskCard
              key={row.sysId}
              row={row}
              config={taskConfig}
              columns={columns}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {columns.map(col => (
                <th key={col.element}
                  className="px-2 py-1.5 text-left typo-label first:pl-3">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 typo-body">
            {taskRows.map((row, i) => (
              <tr key={row.sysId} className={`transition-colors ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                {columns.map((col, colIdx) => renderCell(row, col, colIdx))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  function renderCIList() {
    const ciRows = displayRows as RelatedCIRow[];

    if (resolvedVariant === 'cards') {
      return (
        <div className="p-4 cards-grid-responsive">
          {ciRows.map(row => (
            <RelatedCICard
              key={row.sysId}
              row={row}
              columns={columns}
              onViewCI={onViewCI}
              hoverRow={hoverRow}
              showCIFlags={showCIFlags}
              onFlagClick={type => setFlagPanel({
                recordSysId: row.sysId,
                ciName: row.values[columns[0]?.element] || row.values.name || row.sysId,
                flagType: type,
              })}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {displayColumns.map(col => (
                <th key={col.element}
                  className="px-2 py-1.5 text-left typo-label first:pl-3">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 typo-body">
            {ciRows.map((row, i) => (
              <tr
                key={row.relSysId ?? row.sysId}
                className={`transition-colors ${i % 2 === 1 ? 'bg-gray-50/50' : ''}`}
              >
                {displayColumns.map((col, colIdx) => renderCell(row, col, colIdx))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const renderListInner = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-8 text-gray-400 gap-2 typo-caption">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading…
        </div>
      );
    }
    if (totalCount === 0) {
      return <p className={`typo-caption italic text-center ${embedded ? 'py-10' : 'px-3 py-6'}`}>{resolvedEmptyMessage}</p>;
    }
    return (
      <>
        {taskMode ? renderTaskList() : renderCIList()}

          {showPagination && (
            <PaginationBar
              start={start}
              end={end}
              totalCount={totalCount}
              page={page}
              pageSize={pageSize}
              onPrev={() => setPage(p => p - 1)}
              onNext={() => setPage(p => p + 1)}
            />
          )}
      </>
    );
  };

  const listBody = renderListInner();

  if (isAccessDenied(access)) {
    return null;
  }

  if (embedded) {
    return (
      <div ref={narrowRef} className="detail-pane">
        {listBody}
        {flagPanel && (
          <FlagDetailPanel
            title={flagPanel.ciName}
            flagType={flagPanel.flagType}
            recordSysId={flagPanel.recordSysId}
            onClose={() => setFlagPanel(null)}
          />
        )}
      </div>
    );
  }

  return (
    <>
    <div ref={narrowRef} className="detail-pane bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left">
        <div className={`p-1.5 ${iconBg} rounded flex-shrink-0`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <span className="flex-1 typo-panel-title text-gray-600">{title}</span>
        <span
          title={includeInfraTasks ? TASK_SCOPE_INCLUDE_INFRA_TOOLTIP : undefined}
          className={`typo-badge font-semibold ${badgeBg} ${badgeText} border ${badgeBorder} px-2.5 py-0.5 rounded-full`}
        >
          {totalCount}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {contentOpen && (
        <div className="border-t border-gray-100">
          {listBody}
        </div>
      )}
    </div>

    {flagPanel && (
      <FlagDetailPanel
        title={flagPanel.ciName}
        flagType={flagPanel.flagType}
        recordSysId={flagPanel.recordSysId}
        onClose={() => setFlagPanel(null)}
      />
    )}
    </>
  );
}

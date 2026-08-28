import { ExternalLink } from 'lucide-react';
import type { ViewField } from '../utils/viewFields';
import type { RelatedTaskConfig, RelatedTaskRow } from '../utils/relatedTasks';

export function PriorityBadge({ priority }: { priority: string }) {
  const cls =
    priority.startsWith('P1') || priority.includes('Critical') ? 'bg-red-100 text-red-700' :
    priority.startsWith('P2') || priority.includes('High')     ? 'bg-orange-100 text-orange-700' :
    priority.startsWith('P3') || priority.includes('Medium')   ? 'bg-yellow-100 text-yellow-700' :
                                                                 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex typo-badge font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {priority}
    </span>
  );
}

export function StateBadge({ state }: { state: string }) {
  const cls =
    state === 'In Progress' ? 'bg-blue-100 text-blue-700' :
    state === 'Resolved'    ? 'bg-green-100 text-green-700' :
    state === 'New'         ? 'bg-violet-100 text-violet-700' :
    state === 'Approved'    ? 'bg-green-100 text-green-700' :
    state === 'Scheduled'   ? 'bg-blue-100 text-blue-700' :
    state === 'Pending'     ? 'bg-yellow-100 text-yellow-700' :
                              'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex typo-badge px-1.5 py-0.5 rounded ${cls}`}>
      {state}
    </span>
  );
}

export function ChangeTypeBadge({ type }: { type: string }) {
  const cls =
    type === 'Emergency' ? 'bg-red-100 text-red-700' :
    type === 'Normal'    ? 'bg-blue-100 text-blue-700' :
                           'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex typo-badge px-1.5 py-0.5 rounded ${cls}`}>
      {type}
    </span>
  );
}

export function taskHref(config: RelatedTaskConfig, sysId: string): string {
  return `/${config.taskTable}.do?sys_id=${sysId}`;
}

export function val(row: RelatedTaskRow, key: string): string {
  const v = row.values[key];
  return v && v !== '—' ? v : '';
}

function TaskCardBodyField({
  col,
  row,
}: {
  col: ViewField;
  row: RelatedTaskRow;
}) {
  if (!(col.element in row.values)) return null;
  const value = val(row, col.element);
  if (!value) return null;

  if (col.element === 'priority') {
    return (
      <div key={col.element} className="rf-field-row rf-field-row--badge">
        <span className="rf-field-row__label">{col.label}</span>
        <PriorityBadge priority={value} />
      </div>
    );
  }
  if (col.element === 'state') {
    return (
      <div key={col.element} className="rf-field-row rf-field-row--badge">
        <span className="rf-field-row__label">{col.label}</span>
        <StateBadge state={value} />
      </div>
    );
  }
  if (col.element === 'type') {
    return (
      <div key={col.element} className="rf-field-row rf-field-row--badge">
        <span className="rf-field-row__label">{col.label}</span>
        <ChangeTypeBadge type={value} />
      </div>
    );
  }
  if (col.element === 'short_description') {
    return (
      <div key={col.element} className="mb-3">
        <p className="typo-field-label mb-1">{col.label}</p>
        <p className="typo-body whitespace-pre-line break-words">{value}</p>
      </div>
    );
  }

  return (
    <div key={col.element} className="rf-field-grid">
      <span className="rf-field-row__label">{col.label}</span>
      <span className="rf-field-row__value">{value}</span>
    </div>
  );
}

export function TaskCard({
  row,
  config,
  columns,
}: {
  row: RelatedTaskRow;
  config: RelatedTaskConfig;
  columns: ViewField[];
}) {
  if (!columns.length) return null;

  const headerCol = columns[0];
  const bodyCols = columns.slice(1);
  const title = val(row, headerCol.element) || row.sysId;

  return (
    <div className="card-stack border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow bg-white">
      <div className="mb-3">
        <a
          href={taskHref(config, row.sysId)}
          target="_blank"
          rel="noopener noreferrer"
          className="typo-panel-title text-blue-700 hover:underline font-mono"
        >
          {title}
        </a>
      </div>
      {bodyCols.length > 0 && (
        <div className="border-t border-gray-100 pt-3 space-y-1">
          {bodyCols.map(col => (
            <TaskCardBodyField key={col.element} col={col} row={row} />
          ))}
        </div>
      )}
      <div className="mt-3 pt-2 border-t border-gray-50">
        <a
          href={taskHref(config, row.sysId)}
          target="_blank"
          rel="noopener noreferrer"
          className="typo-link"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open in ServiceNow
        </a>
      </div>
    </div>
  );
}

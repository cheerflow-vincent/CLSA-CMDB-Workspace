import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowLeftRight, ExternalLink, Loader2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { queryTable } from '../../api/servicenow';
import { loadAppRelationshipPeers } from '../utils/appRelationships';
import { type ViewField, str, loadViewFields as loadViewFieldsUtil, raw } from '../utils/viewFields';
import type { AppItem } from '../data/appData';
import type { DiagramFilters } from './RelationshipDiagram';
import { useNarrowContainer } from '../utils/useNarrowLayout';
import { serviceTypeFromDepartment, type ServiceType } from '../utils/serviceTypeFromDepartment';

// ─── Types ────────────────────────────────────────────────────────────────────
type Direction   = 'upstream' | 'downstream' | 'bidirectional';

interface RelRow {
  sysId:     string;
  name:      string;
  sysClass:  string;
  departmentDescription: string;
  direction: Direction;
}

interface CIDetail {
  operational_status: string;
  fieldValues:        Record<string, string>;
  viewFields:         ViewField[];
}

interface Props {
  selectedApp?:  AppItem | null;
  nodeSearch?:   string;
  filters?:      DiagramFilters;
  onSelectApp?:  (app: AppItem) => void;
  refreshKey?:   number;
}

// ─── CMDB fetch — L1 relationships ───────────────────────────────────────────
async function fetchRelationships(sysId: string): Promise<RelRow[]> {
  const peers = await loadAppRelationshipPeers(sysId);
  const rows: RelRow[] = peers.map(peer => ({
    sysId: peer.sysId,
    name: peer.name,
    sysClass: peer.sysClass,
    departmentDescription: peer.departmentDescription,
    direction: peer.direction,
  }));
  const ORDER: Record<Direction, number> = { upstream: 0, downstream: 1, bidirectional: 2 };
  rows.sort((a, b) => ORDER[a.direction] - ORDER[b.direction] || a.name.localeCompare(b.name));
  return rows;
}
const VIEW_TITLE   = 'CLSA CMDB Workspace';
const DEFAULT_VIEW_FIELDS: ViewField[] = [
  { element: 'department',         label: 'Department'        },
  { element: 'environment',        label: 'Environment'       },
  { element: 'operational_status', label: 'Operational Status'},
  { element: 'owned_by',           label: 'Owner'             },
  { element: 'support_group',      label: 'Support Group'     },
];

// ─── Lookup tables ────────────────────────────────────────────────────────────
const DIR_META: Record<Direction, {
  label: string; icon: React.ReactNode; rowCls: string; badgeCls: string;
}> = {
  upstream:      { label: 'Upstream',       icon: <ArrowUp       size={13} />, rowCls: '', badgeCls: 'bg-orange-50 text-orange-700 ring-1 ring-orange-300' },
  downstream:    { label: 'Downstream',     icon: <ArrowDown     size={13} />, rowCls: '', badgeCls: 'bg-blue-50   text-blue-700   ring-1 ring-blue-300'   },
  bidirectional: { label: 'Bi-directional', icon: <ArrowLeftRight size={13} />, rowCls: '', badgeCls: 'bg-violet-50 text-violet-700 ring-1 ring-violet-300' },
};

/** Broader CI-class → human label map; falls back to humanising the raw name. */
const TABLE_LABEL: Record<string, string> = {
  cmdb_ci_service:        'Business Service',
  cmdb_ci_service_auto:   'Application Service',
  cmdb_ci_appl:           'Application',
  cmdb_ci_server:         'Server',
  cmdb_ci_db_instance:    'Database Instance',
  cmdb_ci_db_catalog:     'Database Catalog',
  cmdb_ci_storage_device: 'Storage Device',
  cmdb_ci_net_gear:       'Network Gear',
  cmdb_ci_ip_router:      'IP Router',
  cmdb_ci_ip_switch:      'IP Switch',
  cmdb_ci_middleware:     'Middleware',
  cmdb_ci_app_server:     'Application Server',
  cmdb_ci_web_server:     'Web Server',
  cmdb_ci:                'Configuration Item',
};
function tableLabel(cls: string) {
  return TABLE_LABEL[cls] ?? cls.replace(/^cmdb_ci_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function rowServiceType(row: Pick<RelRow, 'departmentDescription'>): ServiceType {
  return serviceTypeFromDepartment(row.departmentDescription);
}

const SVC_LABEL: Record<ServiceType, string> = {
  business:       'Business',
  platform:       'Platform',
  infrastructure: 'Infrastructure',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sn = (v: unknown): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'value' in v)
    return String((v as Record<string, unknown>).value ?? '');
  return String(v);
};

function opStatusBadge(status: string) {
  const s = status.toLowerCase();
  if ((s.includes('operational') && !s.includes('non')) || s === 'in use')
    return { cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="w-3 h-3" /> };
  if (s.includes('repair') || s.includes('degraded') || s.includes('maintenance'))
    return { cls: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3 h-3" /> };
  return { cls: 'bg-red-100 text-red-700', icon: <AlertCircle className="w-3 h-3" /> };
}

// ─── CMDB fetch — CI details (view fields) per table ─────────────────────────
async function fetchCIDetails(rows: RelRow[]): Promise<Map<string, CIDetail>> {
  if (!rows.length) return new Map();

  // Group by sys_class_name so we can query each table separately
  const byClass = new Map<string, string[]>();
  for (const r of rows) {
    if (!byClass.has(r.sysClass)) byClass.set(r.sysClass, []);
    byClass.get(r.sysClass)!.push(r.sysId);
  }

  // Load view fields per unique table (in parallel)
  const viewFieldsByTable = await Promise.all(
    [...byClass.keys()].map(t =>
      loadViewFieldsUtil(t, VIEW_TITLE, 5, DEFAULT_VIEW_FIELDS).then(vf => ({ table: t, vf }))
    )
  );
  const viewFieldMap = new Map(viewFieldsByTable.map(({ table, vf }) => [table, vf]));

  // Fetch CI records per table (in parallel)
  const detailMap = new Map<string, CIDetail>();
  await Promise.all(
    [...byClass.entries()].map(async ([tableName, ids]) => {
      const vf = viewFieldMap.get(tableName) ?? DEFAULT_VIEW_FIELDS;
      const fields = [...new Set(['sys_id', 'operational_status', ...vf.map(f => f.element)])];
      const { result = [] } = await queryTable<Record<string, unknown>>({
        table:         tableName,
        query:         `sys_idIN${ids.join(',')}`,
        fields,
        limit:         ids.length + 5,
        displayValue:  true,
      });
      for (const r of result) {
        const id = sn(r.sys_id);
        const fieldValues: Record<string, string> = {};
        for (const f of vf) fieldValues[f.element] = str(r[f.element]);
        detailMap.set(id, { operational_status: str(r.operational_status), fieldValues, viewFields: vf });
      }
    })
  );
  return detailMap;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function InstanceInfoCell({ detail }: { detail: CIDetail | undefined }) {
  if (!detail) return <span className="text-xs text-gray-300 italic">—</span>;

  const badge = opStatusBadge(detail.operational_status);
  const fields = detail.viewFields.filter(f => f.element !== 'operational_status');

  return (
    <div className="space-y-1 min-w-[160px]">
      {/* Operational status badge */}
      {detail.operational_status && (
        <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
          {badge.icon}{detail.operational_status}
        </span>
      )}
      {/* View-configured fields */}
      {fields.map(f => {
        const val = detail.fieldValues[f.element];
        if (!val) return null;
        return (
          <div key={f.element} className="rf-field-row rf-field-row--inline">
            <span className="rf-field-row__label">{f.label}</span>
            <span className="rf-field-row__value font-medium">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

function RelRowCard({
  row,
  detail,
  onViewDetails,
}: {
  row: RelRow;
  detail?: CIDetail;
  onViewDetails: (row: RelRow) => void;
}) {
  const meta = DIR_META[row.direction];
  const svcType = rowServiceType(row);

  return (
    <div className="card-stack border border-gray-200 rounded-lg p-4 bg-white hover:shadow-sm transition-shadow">
      <div className="mb-3">
        <button
          type="button"
          onClick={() => onViewDetails(row)}
          title="View application details"
          className="text-sm font-semibold text-gray-800 hover:text-blue-700 hover:underline text-left break-words"
        >
          {row.name}
        </button>
        <a
          href={`/${row.sysClass || 'cmdb_ci_service'}.do?sys_id=${row.sysId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium mt-1"
          title="Open in ServiceNow"
        >
          <ExternalLink className="w-3 h-3" />
          Open in ServiceNow
        </a>
      </div>
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="rf-field-row rf-field-row--badge">
          <span className="rf-field-row__label">Direction</span>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${meta.badgeCls}`}>
            {meta.icon}{meta.label}
          </span>
        </div>
        <div className="rf-field-grid">
          <span className="rf-field-row__label">Service Type</span>
          <span className="rf-field-row__value">{SVC_LABEL[svcType]}</span>
        </div>
        <div className="rf-field-grid">
          <span className="rf-field-row__label">CI Class</span>
          <span className="rf-field-row__value">{tableLabel(row.sysClass)}</span>
        </div>
        {detail && (
          <div className="pt-2 border-t border-gray-50">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Instance Info</p>
            <InstanceInfoCell detail={detail} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function RelationshipTable({ selectedApp, nodeSearch = '', filters, onSelectApp, refreshKey = 0 }: Props) {
  const [rows,       setRows]       = useState<RelRow[]>([]);
  const [detailMap,  setDetailMap]  = useState<Map<string, CIDetail>>(new Map());
  const [loading,    setLoading]    = useState(false);
  const [detLoading, setDetLoading] = useState(false);
  const { ref: narrowRef, narrow } = useNarrowContainer(720);

  // Phase 1 — fetch relationship rows
  useEffect(() => {
    const sysId = selectedApp?.sysId;
    if (!sysId) { setRows([]); setDetailMap(new Map()); return; }
    setLoading(true);
    setDetailMap(new Map());
    fetchRelationships(sysId)
      .then(r => { setRows(r); return r; })
      .catch(() => { setRows([]); return []; })
      .finally(() => setLoading(false));
  }, [selectedApp?.sysId, refreshKey]);

  // Phase 2 — fetch CI details (after rows are ready)
  useEffect(() => {
    if (!rows.length) { setDetailMap(new Map()); return; }
    setDetLoading(true);
    fetchCIDetails(rows)
      .then(setDetailMap)
      .catch(() => setDetailMap(new Map()))
      .finally(() => setDetLoading(false));
  }, [rows]);

  // Apply filters + search
  const activeFilters = filters ?? { upstream: true, downstream: true, bidirectional: true, platform: true, infrastructure: true, business: true };
  const q = nodeSearch.trim().toLowerCase();

  const filtered = rows.filter(r => {
    if (!activeFilters[r.direction])                     return false;
    if (!activeFilters[rowServiceType(r)]) return false;
    if (q && !r.name.toLowerCase().includes(q))          return false;
    return true;
  });

  const handleViewDetails = (row: RelRow) => {
    onSelectApp?.({
      id: row.sysId, name: row.name, sysId: row.sysId,
      table: row.sysClass || 'cmdb_ci_service',
      app: row.name, dept: '', env: '', status: '',
      incidents: 0, changes: 0, criticality: '', servers: 0, lastUpdated: '',
    });
  };

  // ─── Render ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-gray-400">
      <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      <span className="text-sm">Loading relationships…</span>
    </div>
  );

  if (!selectedApp?.sysId) return (
    <div className="py-20 text-center text-sm text-gray-400">No application selected.</div>
  );

  if (filtered.length === 0) return (
    <div className="py-20 text-center text-sm text-gray-400">
      {q ? `No nodes matching "${nodeSearch}".` : 'No relationships match the current filters.'}
    </div>
  );

  return (
    <div ref={narrowRef} className="detail-pane rounded-xl border border-gray-200 overflow-hidden bg-white">
      {narrow ? (
        <div className="p-4 cards-grid-responsive">
          {filtered.map(row => (
            <RelRowCard
              key={row.sysId}
              row={row}
              detail={detailMap.get(row.sysId)}
              onViewDetails={handleViewDetails}
            />
          ))}
        </div>
      ) : (
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Related Application</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Direction</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Service Type</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">CI Class</th>
            <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Instance Info
              {detLoading && <Loader2 className="inline-block ml-1.5 w-3 h-3 animate-spin text-blue-400" />}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filtered.map(row => {
            const meta    = DIR_META[row.direction];
            const svcType = rowServiceType(row);
            const detail  = detailMap.get(row.sysId);
            return (
              <tr key={row.sysId} className={`hover:bg-gray-50 transition-colors ${meta.rowCls}`}>
                {/* App name + actions */}
                <td className="px-5 py-4 max-w-[220px]">
                  <div className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      onClick={() => handleViewDetails(row)}
                      title="View application details"
                      className="text-sm font-medium text-gray-800 hover:text-blue-700 hover:underline cursor-pointer text-left break-words bg-transparent border-0 p-0"
                    >
                      {row.name}
                    </button>
                    <a
                      href={`/${row.sysClass || 'cmdb_ci_service'}.do?sys_id=${row.sysId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                      title="Open in ServiceNow"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open in ServiceNow
                    </a>
                  </div>
                </td>

                {/* Direction badge */}
                <td className="px-5 py-4">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${meta.badgeCls}`}>
                    {meta.icon}{meta.label}
                  </span>
                </td>

                {/* Service type */}
                <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                  {SVC_LABEL[svcType]}
                </td>

                {/* CI Class — human label */}
                <td className="px-5 py-4 text-xs text-gray-500 whitespace-nowrap">
                  {tableLabel(row.sysClass)}
                </td>

                {/* Instance info */}
                <td className="px-5 py-4">
                  <InstanceInfoCell detail={detail} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
    </div>
  );
}

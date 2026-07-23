import { useState, useEffect } from 'react';
import { ArrowUp, ArrowDown, ArrowLeftRight, ExternalLink, Loader2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import { queryTable } from '../../api/servicenow';
import { type ViewField, str, loadViewFields as loadViewFieldsUtil } from '../utils/viewFields';
import type { AppItem } from '../data/appData';
import type { DiagramFilters } from './RelationshipDiagram';

// ─── Types ────────────────────────────────────────────────────────────────────
type Direction   = 'upstream' | 'downstream' | 'bidirectional';
type ServiceType = 'platform' | 'infrastructure' | 'business';

interface RelRow {
  sysId:     string;
  name:      string;
  sysClass:  string;
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
}

// ─── Constants ────────────────────────────────────────────────────────────────
const IMP_TYPE     = 'impacts::impacted by';
const RDF_TYPE     = 'Receives data from::Sends data to';
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

function classToServiceType(cls: string): ServiceType {
  if (cls === 'cmdb_ci_service')      return 'business';
  if (cls === 'cmdb_ci_service_auto') return 'platform';
  return 'infrastructure';
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

// ─── CMDB fetch — L1 relationships ───────────────────────────────────────────
async function fetchRelationships(sysId: string): Promise<RelRow[]> {
  const TYPE_Q = `type.nameIN${IMP_TYPE},${RDF_TYPE}`;
  const [{ result: asParent = [] }, { result: asChild = [] }] = await Promise.all([
    queryTable<Record<string, unknown>>({ table: 'cmdb_rel_ci', query: `${TYPE_Q}^parent.sys_id=${sysId}`, fields: ['child.sys_id', 'child.name', 'child.sys_class_name'], limit: 300 }),
    queryTable<Record<string, unknown>>({ table: 'cmdb_rel_ci', query: `${TYPE_Q}^child.sys_id=${sysId}`,  fields: ['parent.sys_id', 'parent.name', 'parent.sys_class_name'], limit: 300 }),
  ]);

  const upSet = new Set<string>(), dnSet = new Set<string>();
  const ciMap = new Map<string, { name: string; cls: string }>();

  for (const r of asParent) {
    const id = sn(r['child.sys_id']);
    if (!id || id === sysId) continue;
    ciMap.set(id, { name: sn(r['child.name']), cls: sn(r['child.sys_class_name']) });
    dnSet.add(id);
  }
  for (const r of asChild) {
    const id = sn(r['parent.sys_id']);
    if (!id || id === sysId) continue;
    ciMap.set(id, { name: sn(r['parent.name']), cls: sn(r['parent.sys_class_name']) });
    upSet.add(id);
  }

  const rows: RelRow[] = [...ciMap.entries()].map(([id, { name, cls }]) => ({
    sysId: id, name, sysClass: cls,
    direction: upSet.has(id) && dnSet.has(id) ? 'bidirectional' : upSet.has(id) ? 'upstream' : 'downstream',
  }));
  const ORDER: Record<Direction, number> = { upstream: 0, downstream: 1, bidirectional: 2 };
  rows.sort((a, b) => ORDER[a.direction] - ORDER[b.direction] || a.name.localeCompare(b.name));
  return rows;
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
          <div key={f.element} className="flex items-start gap-1 text-xs leading-snug">
            <span className="text-gray-400 shrink-0 w-24 truncate">{f.label}</span>
            <span className="text-gray-700 font-medium break-words min-w-0">{val}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function RelationshipTable({ selectedApp, nodeSearch = '', filters, onSelectApp }: Props) {
  const [rows,       setRows]       = useState<RelRow[]>([]);
  const [detailMap,  setDetailMap]  = useState<Map<string, CIDetail>>(new Map());
  const [loading,    setLoading]    = useState(false);
  const [detLoading, setDetLoading] = useState(false);

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
  }, [selectedApp?.sysId]);

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
    if (!activeFilters[classToServiceType(r.sysClass)]) return false;
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
    <div className="rounded-xl border border-gray-200 overflow-hidden bg-white">
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
            <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {filtered.map(row => {
            const meta    = DIR_META[row.direction];
            const svcType = classToServiceType(row.sysClass);
            const detail  = detailMap.get(row.sysId);
            return (
              <tr key={row.sysId} className={`hover:bg-gray-50 transition-colors ${meta.rowCls}`}>
                {/* App name */}
                <td className="px-5 py-4 font-medium text-gray-800 max-w-[200px]">
                  <span className="break-words">{row.name}</span>
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

                {/* Actions */}
                <td className="px-5 py-4 text-right">
                  <div className="inline-flex items-center gap-2">
                    <button
                      onClick={() => handleViewDetails(row)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 transition-colors whitespace-nowrap"
                    >
                      View Details
                    </button>
                    <a
                      href={`/${row.sysClass || 'cmdb_ci_service'}.do?sys_id=${row.sysId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 text-xs font-medium text-indigo-600 hover:bg-indigo-50 hover:border-indigo-400 transition-colors whitespace-nowrap"
                      title="Open in ServiceNow"
                    >
                      <ExternalLink size={12} />
                      ServiceNow
                    </a>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

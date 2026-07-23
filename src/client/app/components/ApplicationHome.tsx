import { useState, useEffect } from 'react';
import {
  Search, AlertCircle, Calendar, CheckCircle2, Clock,
  ChevronDown, ChevronUp, ChevronRight, X, LayoutGrid, List,
  Layers, TrendingUp, ArrowRight, Building2, SlidersHorizontal,
  Box, Package, Database, Loader2, ExternalLink,
} from 'lucide-react';
import FlagDetailPanel, { type FlagType, type IncidentRecord, type ChangeRecord } from './FlagDetailPanel';
import AppSearchHeader from './AppSearchHeader';
import { queryTable } from '../../api/servicenow';
import { type ViewField, str, raw, loadViewFields as loadViewFieldsUtil } from '../utils/viewFields';
import {
  mockApplications, appIncidents, appChanges, appFamilies,
  type AppItem, type AppFamily,
} from '../data/appData';

interface ApplicationHomeProps {
  onSelectApp: (app: AppItem) => void;
}

interface FilterOption { label: string; value: string }

// ─── Style helpers ────────────────────────────────────────────────────────────
const envAccent: Record<string, string> = {
  'Production':     'border-t-green-500',
  'Non-Prod (UAT)': 'border-t-amber-400',
  'Staging':        'border-t-blue-400',
  'DR':             'border-t-purple-400',
};
const envBadge: Record<string, string> = {
  'Production':     'bg-green-100 text-green-700',
  'Non-Prod (UAT)': 'bg-amber-100 text-amber-700',
  'Staging':        'bg-blue-100 text-blue-700',
  'DR':             'bg-purple-100 text-purple-700',
};
const statusBadge: Record<string, { cls: string; icon: React.ReactNode }> = {
  'Operational': { cls: 'bg-green-100 text-green-700',   icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  'Degraded':    { cls: 'bg-red-100 text-red-700',       icon: <AlertCircle  className="w-3.5 h-3.5" /> },
  'Testing':     { cls: 'bg-yellow-100 text-yellow-700', icon: <Clock        className="w-3.5 h-3.5" /> },
};
const criticalityBadge: Record<string, string> = {
  'Tier 1': 'bg-red-50 text-red-600 border border-red-200',
  'Tier 2': 'bg-orange-50 text-orange-600 border border-orange-200',
  'Tier 3': 'bg-gray-50 text-gray-500 border border-gray-200',
};

// ─── Live data types ──────────────────────────────────────────────────────────

/** Fallback fields used when the form view is absent or returns nothing */
const DEFAULT_VIEW_FIELDS: ViewField[] = [
  { element: 'department',         label: 'Department' },
  { element: 'environment',        label: 'Environment' },
  { element: 'operational_status', label: 'Operational Status' },
  { element: 'owned_by',           label: 'Owner' },
  { element: 'support_group',      label: 'Support Group' },
];

interface LiveInstance {
  sys_id: string;
  name: string;
  sys_class_name: string;
  operational_status: string;  // always needed for badge / border colour
  environment: string;
  /** Dynamic field values keyed by API field name */
  fieldValues: Record<string, string>;
  /** Table-specific view configuration (resolved per sys_class_name) */
  viewFields: ViewField[];
  incidentRecords: IncidentRecord[];
  changeRecords: ChangeRecord[];
  incidents: number;
  changes: number;
}
interface LiveService {
  sys_id: string;
  name: string;
  short_description: string;
  instances: LiveInstance[];
  totalIncidents: number;
  totalChanges: number;
}
interface LiveCoreApp {
  sys_id: string;
  name: string;
  short_description: string;
  services: LiveService[];
  totalIncidents: number;
  totalChanges: number;
  totalInstances: number;
  /** True while Phase 2 instance details are still loading */
  instancesLoading?: boolean;
}

/**
 * 2-level hierarchy: an "app family" service (cmdb_ci_service, u_service_type=service)
 * connects via u_application_environments CIs to "instance" services (cmdb_ci_service, u_service_type=instance).
 */
interface LiveAppSvc {
  sys_id: string;
  name: string;
  short_description: string;
  /** Instance-type services that are children of this application service */
  instances: LiveInstance[];
  totalIncidents: number;
  totalChanges: number;
  /** True while Phase 2 instance details are still loading */
  instancesLoading?: boolean;
}

// Extract sys_id from a reference field ({value, link} object or plain string)
const refId = (f: unknown): string => {
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object' && 'value' in f) return String((f as Record<string, unknown>).value ?? '');
  return '';
};

// ─── Form-view field loader ───────────────────────────────────────────────────
const VIEW_TITLE = 'CLSA CMDB Workspace';
/** Wrapper: load view fields using shared utility with the CLSA CMDB Workspace view title. */
async function loadViewFields(tableName: string): Promise<ViewField[]> {
  return loadViewFieldsUtil(tableName, VIEW_TITLE, 5, DEFAULT_VIEW_FIELDS);
}

// ─── 3-level hierarchy loader ─────────────────────────────────────────────────

interface ThreeLevelMapping {
  bApps: { sys_id: string; name: string; short_description: string }[];
  svcMap: Map<string, { name: string; short_description: string }>;
  bAppToSvcs: Map<string, string[]>;
  svcToInstIds: Map<string, string[]>;
  instanceIds: string[];
}

/** Assemble LiveCoreApp[] from mapping + instMap. Pass an empty instMap for skeleton rendering. */
function assembleThreeLevelHierarchy(
  mapping: ThreeLevelMapping,
  instMap: Map<string, LiveInstance>,
  instancesLoading: boolean,
): LiveCoreApp[] {
  const { bApps, svcMap, bAppToSvcs, svcToInstIds } = mapping;
  return bApps.map(app => {
    const svcIds = [...new Set(bAppToSvcs.get(app.sys_id) ?? [])];
    const services: LiveService[] = svcIds.map(sId => {
      const svc  = svcMap.get(sId);
      const iIds = [...new Set(svcToInstIds.get(sId) ?? [])];
      const instances = iIds.map(id => instMap.get(id)).filter((x): x is LiveInstance => !!x);
      return {
        sys_id:            sId,
        name:              svc?.name ?? sId,
        short_description: svc?.short_description ?? '',
        instances,
        totalIncidents:    instances.reduce((s, i) => s + i.incidents, 0),
        totalChanges:      instances.reduce((s, i) => s + i.changes, 0),
      };
    });
    return {
      sys_id:            app.sys_id,
      name:              app.name,
      short_description: app.short_description ?? '',
      services,
      instancesLoading,
      totalIncidents:    services.reduce((s, sv) => s + sv.totalIncidents, 0),
      totalChanges:      services.reduce((s, sv) => s + sv.totalChanges, 0),
      totalInstances:    services.reduce((s, sv) => s + sv.instances.length, 0),
    };
  }).filter(app => app.services.length > 0);
}

/**
 * Phase 1 (fast): fetch business apps, relationship maps, and service names.
 * No instance detail data fetched.
 */
async function buildThreeLevelMapping(): Promise<ThreeLevelMapping | null> {
  const { result: bApps = [] } = await queryTable<{ sys_id: string; name: string; short_description: string }>({
    table:   'cmdb_ci_business_app',
    fields:  ['sys_id', 'name', 'short_description'],
    limit:   500,
    orderBy: 'name',
  });
  if (!bApps.length) return null;

  // business_app → service (Consumes::Consumed by) — chunked to avoid 414
  const bAppIds = bApps.map(a => a.sys_id);
  const consumesRows = await chunkedIN<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'parent.sys_id', bAppIds,
    'type.name=Consumes::Consumed by', ['parent', 'child'], 5000,
  );

  const serviceIds = [...new Set(consumesRows.map(r => refId(r.child)).filter(Boolean))];
  if (!serviceIds.length) return null;

  // Service name/description — chunked
  const svcRows = await chunkedIN<{ sys_id: string; name: string; short_description: string }>(
    'cmdb_ci_service', 'sys_id', serviceIds, '',
    ['sys_id', 'name', 'short_description'], 500,
  );
  const svcMap = new Map<string, { name: string; short_description: string }>();
  for (const s of svcRows) svcMap.set(s.sys_id, s);

  // service → instance (Contains::Contained by) — chunked
  const containsRows = await chunkedIN<{ parent: unknown; child: unknown }>(
    'cmdb_rel_ci', 'parent.sys_id', serviceIds,
    'type.name=Contains::Contained by', ['parent', 'child'], 5000,
  );

  const bAppToSvcs = new Map<string, string[]>();
  for (const r of consumesRows) {
    const b = refId(r.parent), s = refId(r.child);
    if (!b || !s) continue;
    if (!bAppToSvcs.has(b)) bAppToSvcs.set(b, []);
    bAppToSvcs.get(b)!.push(s);
  }

  const svcToInstIds = new Map<string, string[]>();
  for (const r of containsRows) {
    const s = refId(r.parent), i = refId(r.child);
    if (!s || !i) continue;
    if (!svcToInstIds.has(s)) svcToInstIds.set(s, []);
    svcToInstIds.get(s)!.push(i);
  }

  const instanceIds = [...new Set(containsRows.map(r => refId(r.child)).filter(Boolean))];
  return { bApps, svcMap, bAppToSvcs, svcToInstIds, instanceIds };
}

/**
 * Phase 2 (slow): fetch full instance details (fields, view config, incidents,
 * changes) and return an instMap ready for assembleThreeLevelHierarchy.
 */
async function loadThreeLevelInstanceDetails(mapping: ThreeLevelMapping): Promise<Map<string, LiveInstance>> {
  const { instanceIds } = mapping;
  const instMap = new Map<string, LiveInstance>();
  if (!instanceIds.length) return instMap;

  const CORE         = ['sys_id', 'name', 'sys_class_name', 'operational_status', 'environment'];
  const FILTER_EXTRA = ['department', 'u_tier'];

  const coreInsts = await chunkedIN<Record<string, unknown>>(
    'cmdb_ci_service_auto', 'sys_id', instanceIds, '', CORE, 500, { displayValue: 'all' },
  );
  const tableNames = [...new Set(coreInsts.map(i => raw(i.sys_class_name)).filter(Boolean))];

  const [viewFieldsByTable, incRows, chgRows] = await Promise.all([
    Promise.all(tableNames.map(t => loadViewFields(t).then(vf => ({ table: t, vf })))),
    // Query task_ci (affected CI) for incidents; use ci_item.sys_id (dot-walk)
    // so the raw UUID is returned even when displayValue=true
    chunkedIN<{
      'ci_item.sys_id': unknown;
      'task.number': unknown; 'task.short_description': unknown;
      'task.priority': unknown; 'task.state': unknown;
      'task.opened_at': unknown; 'task.assigned_to': unknown;
    }>(
      'task_ci', 'ci_item', instanceIds,
      'task.sys_class_name=incident^task.active=true',
      ['ci_item.sys_id', 'task.number', 'task.short_description', 'task.priority', 'task.state', 'task.opened_at', 'task.assigned_to'],
      500, { displayValue: true },
    ),
    // Query task_ci for scheduled change requests linked to these instances
    chunkedIN<{
      'ci_item.sys_id': unknown;
      'task.number': unknown; 'task.short_description': unknown;
      'task.type': unknown; 'task.state': unknown;
      'task.start_date': unknown; 'task.assigned_to': unknown;
    }>(
      'task_ci', 'ci_item', instanceIds,
      'task.sys_class_name=change_request^task.state=-2',
      ['ci_item.sys_id', 'task.number', 'task.short_description', 'task.type', 'task.state', 'task.start_date', 'task.assigned_to'],
      500, { displayValue: true },
    ),
  ]);

  const viewFieldMap = new Map(viewFieldsByTable.map(({ table, vf }) => [table, vf]));
  const allViewElems = [...new Set(viewFieldsByTable.flatMap(({ vf }) => vf.map(f => f.element)))];
  const fetchFields  = [...new Set([...CORE, ...allViewElems, ...FILTER_EXTRA])];

  const fullInsts = await chunkedIN<Record<string, unknown>>(
    'cmdb_ci_service_auto', 'sys_id', instanceIds, '', fetchFields, 500, { displayValue: 'all' },
  );

  for (const i of fullInsts) {
    const tableName = raw(i.sys_class_name);
    const fieldValues: Record<string, string> = {};
    for (const field of fetchFields) fieldValues[field] = str(i[field]);
    instMap.set(raw(i.sys_id) || str(i.sys_id), {
      sys_id:             raw(i.sys_id) || str(i.sys_id),
      name:               str(i.name),
      sys_class_name:     tableName,
      operational_status: str(i.operational_status),
      environment:        str(i.environment),
      fieldValues,
      viewFields:         viewFieldMap.get(tableName) ?? DEFAULT_VIEW_FIELDS,
      incidentRecords: [], changeRecords: [],
      incidents: 0, changes: 0,
    });
  }

  for (const r of incRows) {
    const inst = instMap.get(str(r['ci_item.sys_id']));
    if (!inst) continue;
    inst.incidentRecords.push({
      number:   str(r['task.number']),    short:    str(r['task.short_description']),
      priority: str(r['task.priority']),  state:    str(r['task.state']),
      opened:   str(r['task.opened_at']), assignee: str(r['task.assigned_to']),
    });
  }

  for (const r of chgRows) {
    const inst = instMap.get(str(r['ci_item.sys_id']));
    if (!inst) continue;
    inst.changeRecords.push({
      number:      str(r['task.number']),     short:       str(r['task.short_description']),
      type:        str(r['task.type']),       state:       str(r['task.state']),
      scheduled:   str(r['task.start_date']), implementer: str(r['task.assigned_to']),
    });
  }

  for (const inst of instMap.values()) {
    inst.incidents = inst.incidentRecords.length;
    inst.changes   = inst.changeRecords.length;
  }

  return instMap;
}

// ─── System property reader ───────────────────────────────────────────────────
const HIERARCHY_PROP = 'x_citi4_clsa_cmd_0.enable.new.app.hierarchy';

/** Returns true → 3-level hierarchy; false → 2-level hierarchy */
async function readHierarchyMode(): Promise<boolean> {
  try {
    const { result = [] } = await queryTable<{ value: string }>({
      table:  'sys_properties',
      query:  `name=${HIERARCHY_PROP}`,
      fields: ['value'],
      limit:  1,
    });
    return result[0]?.value?.toLowerCase() === 'true';
  } catch {
    return true; // default to 3-level if the property is unreadable
  }
}

// ─── 2-level hierarchy loader ─────────────────────────────────────────────────
/** Parent table for view-field fallback in 2-level mode (both levels are cmdb_ci_service) */
const SVC_TABLE = 'cmdb_ci_service';

// Helper: run the same query in safe-sized ID chunks to avoid HTTP 414 URI Too Long.
// Each sys_id is 32 chars; 150 IDs ≈ 5 KB, well within any server limit.
const CHUNK = 150;
async function chunkedIN<T>(
  table: string,
  inField: string,
  ids: string[],
  extraQuery: string,
  fields: string[],
  limitPerChunk: number,
  options?: { displayValue?: boolean | 'all' },
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK).join(',');
    const q = extraQuery ? `${inField}IN${slice}^${extraQuery}` : `${inField}IN${slice}`;
    const { result = [] } = await queryTable<T>({
      table, query: q, fields, limit: limitPerChunk,
      ...(options?.displayValue ? { displayValue: options.displayValue } : {}),
    });
    all.push(...result);
  }
  return all;
}

interface TwoLevelMapping {
  appFamilyMeta: Map<string, { name: string; short_description: string }>;
  appToInstances: Map<string, Set<string>>;
  instanceSvcIds: string[];
}

/**
 * Phase 1 (fast): run the two dot-walk relationship queries and build the
 * app-family → instance-id mapping. No instance detail data is fetched.
 */
async function buildTwoLevelMapping(): Promise<TwoLevelMapping | null> {
  const { result: hop1Rels = [] } = await queryTable<{
    parent: unknown; 'parent.name': unknown; 'parent.short_description': unknown; child: unknown;
  }>({
    table:  'cmdb_rel_ci',
    query:  'parent.u_service_type=service^type.name=Connects to::Connected by',
    fields: ['parent', 'parent.name', 'parent.short_description', 'child'],
    limit:  50000,
  });
  if (!hop1Rels.length) return null;

  const { result: hop2Rels = [] } = await queryTable<{ parent: unknown; child: unknown }>({
    table:  'cmdb_rel_ci',
    query:  'child.u_service_type=instance^type.name=Connects to::Connected by',
    fields: ['parent', 'child'],
    limit:  50000,
  });
  if (!hop2Rels.length) return null;

  const hop1Map       = new Map<string, string[]>();
  const appFamilyMeta = new Map<string, { name: string; short_description: string }>();
  for (const r of hop1Rels) {
    const p = refId(r.parent), c = refId(r.child);
    if (!p || !c) continue;
    if (!hop1Map.has(p)) hop1Map.set(p, []);
    hop1Map.get(p)!.push(c);
    if (!appFamilyMeta.has(p)) {
      appFamilyMeta.set(p, {
        name:              str(r['parent.name']),
        short_description: str(r['parent.short_description']),
      });
    }
  }

  const hop2Map = new Map<string, string[]>();
  for (const r of hop2Rels) {
    const p = refId(r.parent), c = refId(r.child);
    if (!p || !c) continue;
    if (!hop2Map.has(p)) hop2Map.set(p, []);
    hop2Map.get(p)!.push(c);
  }

  const appToInstances = new Map<string, Set<string>>();
  for (const [appId] of hop1Map) {
    const instSet = new Set<string>();
    for (const intId of hop1Map.get(appId) ?? []) {
      for (const instId of hop2Map.get(intId) ?? []) instSet.add(instId);
    }
    if (instSet.size > 0) appToInstances.set(appId, instSet);
  }
  if (!appToInstances.size) return null;

  const instanceSvcIds = [...new Set([...appToInstances.values()].flatMap(s => [...s]))];
  return { appFamilyMeta, appToInstances, instanceSvcIds };
}

/**
 * Phase 2 (slow): fetch full instance details (fields, view config, incidents,
 * changes) and return populated LiveAppSvc objects.
 */
async function loadTwoLevelInstanceDetails(mapping: TwoLevelMapping): Promise<LiveAppSvc[]> {
  const CORE         = ['sys_id', 'name', 'sys_class_name', 'operational_status', 'environment'];
  const FILTER_EXTRA = ['department', 'u_tier'];
  const { appFamilyMeta, appToInstances, instanceSvcIds } = mapping;

  const coreInsts = await chunkedIN<Record<string, unknown>>(
    SVC_TABLE, 'sys_id', instanceSvcIds, '', CORE, 500, { displayValue: 'all' },
  );
  const tableNames = [...new Set(coreInsts.map(i => raw(i.sys_class_name)).filter(Boolean))];

  const [viewFieldsByTable, incRows, chgRows] = await Promise.all([
    Promise.all(tableNames.map(t => loadViewFields(t).then(vf => ({ table: t, vf })))),
    // Query task_ci (affected CI) for incidents; use ci_item.sys_id (dot-walk)
    // so the raw UUID is returned even when displayValue=true
    chunkedIN<{
      'ci_item.sys_id': unknown;
      'task.number': unknown; 'task.short_description': unknown;
      'task.priority': unknown; 'task.state': unknown;
      'task.opened_at': unknown; 'task.assigned_to': unknown;
    }>(
      'task_ci', 'ci_item', instanceSvcIds,
      'task.sys_class_name=incident^task.active=true',
      ['ci_item.sys_id', 'task.number', 'task.short_description', 'task.priority', 'task.state', 'task.opened_at', 'task.assigned_to'],
      500, { displayValue: true },
    ),
    // Query task_ci for scheduled change requests linked to these instances
    chunkedIN<{
      'ci_item.sys_id': unknown;
      'task.number': unknown; 'task.short_description': unknown;
      'task.type': unknown; 'task.state': unknown;
      'task.start_date': unknown; 'task.assigned_to': unknown;
    }>(
      'task_ci', 'ci_item', instanceSvcIds,
      'task.sys_class_name=change_request^task.state=-2',
      ['ci_item.sys_id', 'task.number', 'task.short_description', 'task.type', 'task.state', 'task.start_date', 'task.assigned_to'],
      500, { displayValue: true },
    ),
  ]);

  const viewFieldMap = new Map(viewFieldsByTable.map(({ table, vf }) => [table, vf]));
  const allViewElems = [...new Set(viewFieldsByTable.flatMap(({ vf }) => vf.map(f => f.element)))];
  const fetchFields  = [...new Set([...CORE, ...allViewElems, ...FILTER_EXTRA])];

  const fullInsts = await chunkedIN<Record<string, unknown>>(
    SVC_TABLE, 'sys_id', instanceSvcIds, '', fetchFields, 500, { displayValue: 'all' },
  );

  const instMap = new Map<string, LiveInstance>();
  for (const i of fullInsts) {
    const tableName = raw(i.sys_class_name);
    const fieldValues: Record<string, string> = {};
    for (const field of fetchFields) fieldValues[field] = str(i[field]);
    instMap.set(raw(i.sys_id) || str(i.sys_id), {
      sys_id:             raw(i.sys_id) || str(i.sys_id),
      name:               str(i.name),
      sys_class_name:     tableName,
      operational_status: str(i.operational_status),
      environment:        str(i.environment),
      fieldValues,
      viewFields:         viewFieldMap.get(tableName) ?? DEFAULT_VIEW_FIELDS,
      incidentRecords: [], changeRecords: [],
      incidents: 0, changes: 0,
    });
  }

  for (const r of incRows) {
    const inst = instMap.get(str(r['ci_item.sys_id']));
    if (!inst) continue;
    inst.incidentRecords.push({
      number:   str(r['task.number']),    short:    str(r['task.short_description']),
      priority: str(r['task.priority']),  state:    str(r['task.state']),
      opened:   str(r['task.opened_at']), assignee: str(r['task.assigned_to']),
    });
  }

  for (const r of chgRows) {
    const inst = instMap.get(str(r['ci_item.sys_id']));
    if (!inst) continue;
    inst.changeRecords.push({
      number:      str(r['task.number']),     short:       str(r['task.short_description']),
      type:        str(r['task.type']),       state:       str(r['task.state']),
      scheduled:   str(r['task.start_date']), implementer: str(r['task.assigned_to']),
    });
  }

  for (const inst of instMap.values()) {
    inst.incidents = inst.incidentRecords.length;
    inst.changes   = inst.changeRecords.length;
  }

  return [...appToInstances.keys()]
    .map(appId => {
      const meta      = appFamilyMeta.get(appId) ?? { name: appId, short_description: '' };
      const childIds  = [...(appToInstances.get(appId) ?? [])];
      const instances = childIds.map(id => instMap.get(id)).filter((x): x is LiveInstance => !!x);
      return {
        sys_id:            appId,
        name:              meta.name,
        short_description: meta.short_description,
        instances,
        instancesLoading:  false,
        totalIncidents:    instances.reduce((a, i) => a + i.incidents, 0),
        totalChanges:      instances.reduce((a, i) => a + i.changes, 0),
      };
    })
    .filter(s => s.instances.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ─── Operational status → badge ───────────────────────────────────────────────
// safe() mirrors str() but is used in render-time helpers
const safe = str;

function opStatusBadge(status: unknown) {
  const s = safe(status).toLowerCase();
  // "Operational" (3-level label) and "In Use" (2-level label) both map to operational_status=1
  if ((s.includes('operational') && !s.includes('non')) || s === 'in use') {
    return { cls: 'bg-green-100 text-green-700', icon: <CheckCircle2 className="w-3.5 h-3.5" /> };
  }
  if (s.includes('repair') || s.includes('degraded') || s.includes('maintenance')) {
    return { cls: 'bg-yellow-100 text-yellow-700', icon: <Clock className="w-3.5 h-3.5" /> };
  }
  return { cls: 'bg-red-100 text-red-700', icon: <AlertCircle className="w-3.5 h-3.5" /> };
}

// ─── Instance field row helper ────────────────────────────────────────────────
function FieldRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-1 text-xs">
      <span className="text-gray-400 shrink-0 w-28">{label}</span>
      <span className="text-gray-700 font-medium break-words min-w-0">{value}</span>
    </div>
  );
}

// ─── Live Instance Card ───────────────────────────────────────────────────────
function LiveInstanceCard({ inst, svcName, onViewDetails, onFlagClick }: {
  inst: LiveInstance;
  svcName: string;
  onViewDetails: () => void;
  onFlagClick: (ft: FlagType) => void;
}) {
  const badge = opStatusBadge(inst.operational_status);
  const topCls = envAccent[inst.environment] ?? 'border-t-gray-300';
  return (
    <div className={`bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all group border-t-4 ${topCls} flex flex-col`}>
      <div className="p-5 flex-1">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug mb-0.5">{inst.name}</h3>
          <p className="text-xs text-gray-400 truncate">{svcName}</p>
        </div>

        {/* Dynamic form-view fields (table-specific) */}
        <div className="space-y-1.5 mb-4 border border-gray-100 rounded-lg p-3 bg-gray-50">
          {inst.viewFields.map(f => (
            <FieldRow key={f.element} label={f.label} value={inst.fieldValues[f.element]} />
          ))}
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${badge.cls}`}>
            {badge.icon}{inst.operational_status || 'Unknown'}
          </span>
        </div>

        {(inst.incidents > 0 || inst.changes > 0) && (
          <div className="flex gap-2 flex-wrap">
            {inst.incidents > 0 && (
              <button onClick={() => onFlagClick('incident')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
                <AlertCircle className="w-3.5 h-3.5" />{inst.incidents} Incident{inst.incidents > 1 ? 's' : ''}
              </button>
            )}
            {inst.changes > 0 && (
              <button onClick={() => onFlagClick('change')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
                <Calendar className="w-3.5 h-3.5" />Upcoming Change
              </button>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-xl gap-2">
        <a
          href={`/${inst.sys_class_name || 'cmdb_ci_service'}.do?sys_id=${inst.sys_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" /> ServiceNow
        </a>
        <button onClick={onViewDetails}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors group-hover:underline">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Live Instance Row ────────────────────────────────────────────────────────
function LiveInstanceRow({ inst, onViewDetails, onFlagClick }: {
  inst: LiveInstance;
  onViewDetails: () => void;
  onFlagClick: (ft: FlagType) => void;
}) {
  const badge = opStatusBadge(inst.operational_status);
  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-sm transition-all px-5 py-3 flex items-center gap-5">
      <div className={`w-1 h-12 rounded-full shrink-0 ${
        inst.environment === 'Production' ? 'bg-green-500' :
        inst.environment?.includes('UAT') ? 'bg-amber-400' : 'bg-blue-400'
      }`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate mb-1">{inst.name}</p>
        <div className={`grid gap-x-4 gap-y-0.5`} style={{ gridTemplateColumns: `repeat(${inst.viewFields.length}, minmax(0, 1fr))` }}>
          {inst.viewFields.map(f => {
            const val = inst.fieldValues[f.element];
            return val ? (
              <div key={f.element} className="flex flex-col min-w-0">
                <span className="text-[10px] text-gray-400 truncate">{f.label}</span>
                <span className="text-xs text-gray-700 truncate">{val}</span>
              </div>
            ) : null;
          })}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${badge.cls}`}>
          {badge.icon}{inst.operational_status || 'Unknown'}
        </span>
        {inst.incidents > 0 && (
          <button onClick={() => onFlagClick('incident')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
            <AlertCircle className="w-3 h-3" />{inst.incidents}
          </button>
        )}
        {inst.changes > 0 && (
          <button onClick={() => onFlagClick('change')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
            <Calendar className="w-3 h-3" />CHG
          </button>
        )}
        <a
          href={`/${inst.sys_class_name || 'cmdb_ci_service'}.do?sys_id=${inst.sys_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium transition-colors"
          title="Open in ServiceNow"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
        <button onClick={onViewDetails}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium ml-1">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Live Service Group (2nd level) ──────────────────────────────────────────
function LiveServiceGroup({ svc, viewMode, onSelectApp, onFlagClick, instancesLoading }: {
  svc: LiveService;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, records: IncidentRecord[] | ChangeRecord[]) => void;
  instancesLoading?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-left"
      >
        <Package className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="text-sm font-semibold text-gray-800 flex-1">{svc.name}</span>
        {svc.short_description && (
          <span className="text-xs text-gray-400 hidden sm:block truncate max-w-xs">{svc.short_description}</span>
        )}
        <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200 shrink-0">
          {svc.instances.length} instance{svc.instances.length !== 1 ? 's' : ''}
        </span>
        {svc.totalIncidents > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full shrink-0">
            <AlertCircle className="w-3 h-3" />{svc.totalIncidents}
          </span>
        )}
        {svc.totalChanges > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full shrink-0">
            <Calendar className="w-3 h-3" />{svc.totalChanges}
          </span>
        )}
        {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {open && instancesLoading && (
        <div className="mt-3 pl-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      )}

      {open && !instancesLoading && svc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {svc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={svc.name}
                  onViewDetails={() => onSelectApp({
                    id: inst.sys_id, name: safe(inst.name) || inst.sys_id, app: svc.name, family: 'live',
                    dept: '', env: safe(inst.environment),
                    status: safe(inst.operational_status).toLowerCase().includes('operational') && !safe(inst.operational_status).toLowerCase().includes('non')
                      ? 'Operational' : 'Degraded',
                    incidents: inst.incidents, changes: inst.changes,
                    criticality: 'Tier 1', servers: 0, lastUpdated: '',
                    sysId: inst.sys_id, table: inst.sys_class_name || SVC_TABLE,
                  })}
                  onFlagClick={ft => onFlagClick(
                    safe(inst.name) || inst.sys_id, ft,
                    ft === 'incident' ? inst.incidentRecords : inst.changeRecords,
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {svc.instances.map(inst => (
                <LiveInstanceRow
                  key={inst.sys_id}
                  inst={inst}
                  onViewDetails={() => onSelectApp({
                    id: inst.sys_id, name: safe(inst.name) || inst.sys_id, app: svc.name, family: 'live',
                    dept: '', env: safe(inst.environment),
                    status: safe(inst.operational_status).toLowerCase().includes('operational') && !safe(inst.operational_status).toLowerCase().includes('non')
                      ? 'Operational' : 'Degraded',
                    incidents: inst.incidents, changes: inst.changes,
                    criticality: 'Tier 1', servers: 0, lastUpdated: '',
                    sysId: inst.sys_id, table: inst.sys_class_name || SVC_TABLE,
                  })}
                  onFlagClick={ft => onFlagClick(
                    inst.name, ft,
                    ft === 'incident' ? inst.incidentRecords : inst.changeRecords,
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {open && !instancesLoading && svc.instances.length === 0 && (
        <p className="mt-2 pl-6 text-xs text-gray-400 italic">No instances found</p>
      )}
    </div>
  );
}

// ─── 2-level: Application Service Section ────────────────────────────────────
function LiveAppSvcSection({ appSvc, viewMode, onSelectApp, onFlagClick }: {
  appSvc: LiveAppSvc;
  viewMode: 'grid' | 'list';
  onSelectApp: (a: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, records: IncidentRecord[] | ChangeRecord[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
      >
        <div className="p-1.5 rounded-lg bg-indigo-700 shrink-0">
          <Layers className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{appSvc.name}</p>
          {appSvc.short_description && (
            <p className="text-xs text-gray-400 truncate">{appSvc.short_description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {appSvc.instances.length} instance{appSvc.instances.length !== 1 ? 's' : ''}
          </span>
          {appSvc.totalIncidents > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />{appSvc.totalIncidents} inc
            </span>
          )}
          {appSvc.totalChanges > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" />{appSvc.totalChanges} chg
            </span>
          )}
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {open && appSvc.instancesLoading && (
        <div className="mt-3 pl-2 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-36 bg-white rounded-xl border border-gray-200 animate-pulse" />
          ))}
        </div>
      )}

      {open && !appSvc.instancesLoading && appSvc.instances.length > 0 && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {appSvc.instances.map(inst => (
                <LiveInstanceCard
                  key={inst.sys_id}
                  inst={inst}
                  svcName={appSvc.name}
                  onViewDetails={() => onSelectApp({
                    id: inst.sys_id, name: safe(inst.name) || inst.sys_id, app: appSvc.name, family: 'live',
                    dept: '', env: safe(inst.environment),
                    status: safe(inst.operational_status).toLowerCase().includes('operational') && !safe(inst.operational_status).toLowerCase().includes('non')
                      ? 'Operational' : 'Degraded',
                    incidents: inst.incidents, changes: inst.changes,
                    criticality: 'Tier 1', servers: 0, lastUpdated: '',
                    sysId: inst.sys_id, table: inst.sys_class_name || SVC_TABLE,
                  })}
                  onFlagClick={ft => onFlagClick(
                    safe(inst.name) || inst.sys_id, ft,
                    ft === 'incident' ? inst.incidentRecords : inst.changeRecords,
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {appSvc.instances.map(inst => (
                <LiveInstanceRow
                  key={inst.sys_id}
                  inst={inst}
                  onViewDetails={() => onSelectApp({
                    id: inst.sys_id, name: safe(inst.name) || inst.sys_id, app: appSvc.name, family: 'live',
                    dept: '', env: safe(inst.environment),
                    status: safe(inst.operational_status).toLowerCase().includes('operational') && !safe(inst.operational_status).toLowerCase().includes('non')
                      ? 'Operational' : 'Degraded',
                    incidents: inst.incidents, changes: inst.changes,
                    criticality: 'Tier 1', servers: 0, lastUpdated: '',
                    sysId: inst.sys_id, table: inst.sys_class_name || SVC_TABLE,
                  })}
                  onFlagClick={ft => onFlagClick(
                    safe(inst.name) || inst.sys_id, ft,
                    ft === 'incident' ? inst.incidentRecords : inst.changeRecords,
                  )}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Live Core Application Section (1st level) ───────────────────────────────
function LiveCoreAppSection({ app, viewMode, onSelectApp, onFlagClick }: {
  app: LiveCoreApp;
  viewMode: 'grid' | 'list';
  onSelectApp: (a: AppItem) => void;
  onFlagClick: (title: string, ft: FlagType, records: IncidentRecord[] | ChangeRecord[]) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
      >
        <div className="p-1.5 rounded-lg bg-blue-700 shrink-0">
          <Building2 className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{app.name}</p>
          {app.short_description && (
            <p className="text-xs text-gray-400 truncate">{app.short_description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {app.services.length} service{app.services.length !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {app.totalInstances} instance{app.totalInstances !== 1 ? 's' : ''}
          </span>
          {app.totalIncidents > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />{app.totalIncidents} inc
            </span>
          )}
          {app.totalChanges > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" />{app.totalChanges} chg
            </span>
          )}
          {open
            ? <ChevronUp   className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="mt-3 pl-4 border-l-2 border-blue-200 ml-3">
          {app.services.length === 0
            ? <p className="text-xs text-gray-400 italic py-2">No services linked</p>
            : app.services.map(svc => (
                <LiveServiceGroup
                  key={svc.sys_id}
                  svc={svc}
                  viewMode={viewMode}
                  onSelectApp={onSelectApp}
                  onFlagClick={onFlagClick}
                  instancesLoading={app.instancesLoading}
                />
              ))
          }
        </div>
      )}
    </div>
  );
}

// ─── FilterSection accordion ──────────────────────────────────────────────────
function FilterSection({ title, children, defaultOpen = true }: {
  title: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-gray-100 pb-4 mb-4 last:border-0 last:mb-0 last:pb-0">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between py-1 mb-2">
        <span className="text-sm font-semibold text-gray-800">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

// ─── Application group — demo data (middle tier) ──────────────────────────────
function AppGroup({ appName, instances, viewMode, onSelectApp, onFlagClick }: {
  appName: string;
  instances: AppItem[];
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (app: AppItem, flagType: FlagType) => void;
}) {
  const [open, setOpen] = useState(true);
  const totalIncidents = instances.reduce((s, a) => s + a.incidents, 0);
  const totalChanges   = instances.reduce((s, a) => s + a.changes, 0);

  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors text-left"
      >
        <Package className="w-4 h-4 text-gray-500 shrink-0" />
        <span className="text-sm font-semibold text-gray-800 flex-1">{appName}</span>
        <span className="text-xs text-gray-500 bg-white px-2 py-0.5 rounded-full border border-gray-200">
          {instances.length} instance{instances.length !== 1 ? 's' : ''}
        </span>
        {totalIncidents > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
            <AlertCircle className="w-3 h-3" />{totalIncidents} Incident{totalIncidents > 1 ? 's' : ''}
          </span>
        )}
        {totalChanges > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
            <Calendar className="w-3 h-3" />{totalChanges} Change{totalChanges > 1 ? 's' : ''}
          </span>
        )}
        {open
          ? <ChevronUp   className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>

      {open && (
        <div className="mt-3 pl-2">
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {instances.map(app => (
                <AppCard key={app.id} app={app}
                  onViewDetails={() => onSelectApp(app)}
                  onFlagClick={(ft) => onFlagClick(app, ft)} />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {instances.map(app => (
                <AppRow key={app.id} app={app}
                  onViewDetails={() => onSelectApp(app)}
                  onFlagClick={(ft) => onFlagClick(app, ft)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Application family section — demo data (outermost tier) ─────────────────
function FamilySection({ family, appGroups, viewMode, onSelectApp, onFlagClick }: {
  family: AppFamily;
  appGroups: Map<string, AppItem[]>;
  viewMode: 'grid' | 'list';
  onSelectApp: (app: AppItem) => void;
  onFlagClick: (app: AppItem, flagType: FlagType) => void;
}) {
  const [open, setOpen] = useState(true);
  const allInstances  = [...appGroups.values()].flat();
  const totalInst     = allInstances.length;
  const totalInc      = allInstances.reduce((s, a) => s + a.incidents, 0);
  const totalCh       = allInstances.reduce((s, a) => s + a.changes, 0);
  const appCount      = appGroups.size;

  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-left transition-colors bg-white border border-gray-200 hover:bg-gray-50 shadow-sm"
      >
        <div className={`p-1.5 rounded-lg ${family.accentColor}`}>
          <Box className="w-4 h-4 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{family.name}</p>
          <p className="text-xs text-gray-400 truncate">{family.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {appCount} app{appCount !== 1 ? 's' : ''}
          </span>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {totalInst} instance{totalInst !== 1 ? 's' : ''}
          </span>
          {totalInc > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
              <AlertCircle className="w-3 h-3" />{totalInc}
            </span>
          )}
          {totalCh > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <Calendar className="w-3 h-3" />{totalCh}
            </span>
          )}
          {open
            ? <ChevronUp   className="w-4 h-4 text-gray-400" />
            : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {open && (
        <div className="mt-3 pl-4 border-l-2 border-gray-200 ml-3">
          {[...appGroups.entries()].map(([appName, instances]) => (
            <AppGroup
              key={appName}
              appName={appName}
              instances={instances}
              viewMode={viewMode}
              onSelectApp={onSelectApp}
              onFlagClick={onFlagClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ApplicationHome({ onSelectApp }: ApplicationHomeProps) {
  const [cardSearch, setCardSearch]         = useState('');
  const [viewMode, setViewMode]             = useState<'grid' | 'list'>('grid');
  const [checkedEnv, setCheckedEnv]         = useState<string[]>([]);
  const [checkedStatus, setCheckedStatus]   = useState<string[]>([]);
  const [checkedBizUnit, setCheckedBizUnit] = useState<string[]>([]);
  const [checkedDept, setCheckedDept]       = useState<string[]>([]);
  const [checkedTier, setCheckedTier]       = useState<string[]>([]);

  // Mock data panel
  const [panel, setPanel] = useState<{ app: AppItem; flagType: FlagType } | null>(null);

  // Live data panel
  const [livePanel, setLivePanel] = useState<{
    title: string;
    flagType: FlagType;
    records: IncidentRecord[] | ChangeRecord[];
  } | null>(null);

  // ── Live filter options ────────────────────────────────────────────────────
  const [envOptions,     setEnvOptions]     = useState<FilterOption[]>([]);
  const [statusOptions,  setStatusOptions]  = useState<FilterOption[]>([]);
  const [bizUnitOptions, setBizUnitOptions] = useState<FilterOption[]>([]);
  const [deptOptions,    setDeptOptions]    = useState<FilterOption[]>([]);
  const [tierOptions,    setTierOptions]    = useState<FilterOption[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(true);

  useEffect(() => {
    const fetchChoice = (element: string) =>
      queryTable<{ value: string; label: string }>({
        table:   'sys_choice',
        query:   `nameINcmdb_ci_service_auto,cmdb_ci_service,cmdb_ci^element=${element}^language=en^inactive=false`,
        fields:  ['value', 'label'],
        limit:   50,
        orderBy: 'sequence',
      }).then(({ result }) => {
        const seen = new Set<string>();
        return (result ?? [])
          .filter(r => r.label && !seen.has(r.value) && seen.add(r.value))
          .map(r => ({ label: r.label, value: r.label }));
      });

    const TIER_FALLBACK: FilterOption[] = [
      { label: 'Tier 0', value: '0' }, { label: 'Tier 1', value: '1' },
      { label: 'Tier 2', value: '2' }, { label: 'Tier 3', value: '3' },
    ];

    Promise.all([
      fetchChoice('environment'),
      fetchChoice('operational_status'),
      queryTable<{ sys_id: string; name: string }>({
        table: 'business_unit', fields: ['sys_id', 'name'], limit: 100, orderBy: 'name',
      }).then(({ result }) =>
        (result ?? [])
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
          .map(r => ({ label: r.name, value: r.name }))
      ),
      queryTable<{ sys_id: string; name: string }>({
        table: 'cmn_department', query: 'u_it_department=true',
        fields: ['sys_id', 'name'], limit: 100, orderBy: 'name',
      }).then(({ result }) =>
        (result ?? [])
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
          .map(r => ({ label: r.name, value: r.name }))
      ),
      fetchChoice('u_tier').then(opts => opts.length ? opts : TIER_FALLBACK),
    ])
      .then(([envs, statuses, bizUnits, depts, tiers]) => {
        setEnvOptions(envs); setStatusOptions(statuses);
        setBizUnitOptions(bizUnits); setDeptOptions(depts); setTierOptions(tiers);
      })
      .catch(() => {})
      .finally(() => setFiltersLoading(false));
  }, []);

  // ── Live hierarchy ─────────────────────────────────────────────────────────
  // hierarchyMode: true = 3-level (business app → service → instance)
  //                false = 2-level (application service → instance service)
  const [hierarchyMode,       setHierarchyMode]       = useState<boolean | null>(null);
  const [liveData,             setLiveData]             = useState<LiveCoreApp[]>([]);
  const [liveTwoLevel,         setLiveTwoLevel]         = useState<LiveAppSvc[]>([]);
  const [liveLoading,          setLiveLoading]          = useState(true);
  const [liveInstancesLoading, setLiveInstancesLoading] = useState(false);
  const [liveError,            setLiveError]            = useState<string | null>(null);

  // ── Live stats — runs after hierarchyMode is known ─────────────────────────
  const [statsLoading, setStatsLoading] = useState(true);
  const [liveStats, setLiveStats] = useState({ total: 0, operational: 0, incidents: 0, changes: 0 });

  useEffect(() => {
    if (hierarchyMode === null) return; // wait until mode is resolved

    const count = (table: string, query?: string) =>
      queryTable({ table, query, fields: ['sys_id'], limit: 1 })
        .then(({ totalCount }) => totalCount)
        .catch(() => 0);

    if (hierarchyMode) {
      // 3-level: instances live in cmdb_ci_service_auto (and child tables)
      // Use task_ci (affected CI) for accurate incident/change counts via dot-walking
      Promise.all([
        count('cmdb_ci_service_auto'),
        count('cmdb_ci_service_auto', 'operational_status=1'),
        count('task_ci', 'ci_item.sys_class_nameINSTANCEOFcmdb_ci_service_auto^task.sys_class_name=incident^task.active=true'),
        count('task_ci', 'ci_item.sys_class_nameINSTANCEOFcmdb_ci_service_auto^task.sys_class_name=change_request^task.state=-2'),
      ])
        .then(([total, operational, incidents, changes]) =>
          setLiveStats({ total, operational, incidents, changes })
        )
        .finally(() => setStatsLoading(false));
    } else {
      // 2-level: instances are cmdb_ci_service where u_service_type=instance
      // "Operational" = operational_status=1; use task_ci for incident/change counts
      Promise.all([
        count('cmdb_ci_service', 'u_service_type=instance'),
        count('cmdb_ci_service', 'u_service_type=instance^operational_status=1'),
        count('task_ci', 'ci_item.sys_class_name=cmdb_ci_service^ci_item.u_service_type=instance^task.sys_class_name=incident^task.active=true'),
        count('task_ci', 'ci_item.sys_class_name=cmdb_ci_service^ci_item.u_service_type=instance^task.sys_class_name=change_request^task.state=-2'),
      ])
        .then(([total, operational, incidents, changes]) =>
          setLiveStats({ total, operational, incidents, changes })
        )
        .finally(() => setStatsLoading(false));
    }
  }, [hierarchyMode]);

  useEffect(() => {
    readHierarchyMode().then(is3Level => {
      setHierarchyMode(is3Level);
      if (is3Level) {
        // 3-level: two-phase loading (same pattern as 2-level)
        buildThreeLevelMapping()
          .then(mapping => {
            setLiveLoading(false);
            if (!mapping) return;

            // Phase 1 complete — show skeleton core app headers
            setLiveData(assembleThreeLevelHierarchy(mapping, new Map(), true));
            setLiveInstancesLoading(true);

            // Phase 2 — load full instance details in background
            loadThreeLevelInstanceDetails(mapping)
              .then(instMap => setLiveData(assembleThreeLevelHierarchy(mapping, instMap, false)))
              .catch(e => setLiveError(String(e?.message ?? e)))
              .finally(() => setLiveInstancesLoading(false));
          })
          .catch(e => {
            setLiveError(String(e?.message ?? e));
            setLiveLoading(false);
          });
      } else {
        // 2-level: two-phase loading
        // Phase 1 – fast relationship queries; show family headers immediately
        buildTwoLevelMapping()
          .then(mapping => {
            setLiveLoading(false);
            if (!mapping) return;

            // Show skeleton families while Phase 2 loads instance details
            const skeletonFamilies: LiveAppSvc[] = [...mapping.appToInstances.keys()]
              .map(appId => {
                const meta = mapping.appFamilyMeta.get(appId) ?? { name: appId, short_description: '' };
                return {
                  sys_id:            appId,
                  name:              meta.name,
                  short_description: meta.short_description,
                  instances:         [],
                  instancesLoading:  true,
                  totalIncidents:    0,
                  totalChanges:      0,
                };
              })
              .sort((a, b) => a.name.localeCompare(b.name));
            setLiveTwoLevel(skeletonFamilies);
            setLiveInstancesLoading(true);

            // Phase 2 – slow: fetch full instance details in background
            loadTwoLevelInstanceDetails(mapping)
              .then(setLiveTwoLevel)
              .catch(e => setLiveError(String(e?.message ?? e)))
              .finally(() => setLiveInstancesLoading(false));
          })
          .catch(e => {
            setLiveError(String(e?.message ?? e));
            setLiveLoading(false);
          });
      }
    }).catch(e => {
      setLiveError(String(e?.message ?? e));
      setLiveLoading(false);
    });
  }, []);

  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, val: string) =>
    setArr(arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]);

  // ── Demo data filtering ────────────────────────────────────────────────────
  const filtered = mockApplications.filter(a => {
    const q = cardSearch.toLowerCase();
    const matchesSearch  = !q || a.name.toLowerCase().includes(q) || a.app.toLowerCase().includes(q) || a.dept.toLowerCase().includes(q);
    const matchesEnv     = checkedEnv.length     === 0 || checkedEnv.includes(a.env);
    const matchesStatus  = checkedStatus.length  === 0 || checkedStatus.includes(a.status);
    const matchesBizUnit = checkedBizUnit.length === 0 || checkedBizUnit.includes(a.dept);
    const matchesDept    = checkedDept.length    === 0 || checkedDept.includes(a.dept);
    const matchesTier    = checkedTier.length    === 0 || (a.tier !== undefined && checkedTier.includes(a.tier));
    return matchesSearch && matchesEnv && matchesStatus && matchesBizUnit && matchesDept && matchesTier;
  });

  const byFamily = new Map<string, Map<string, AppItem[]>>();
  for (const fam of appFamilies) byFamily.set(fam.id, new Map());
  for (const item of filtered) {
    const famMap = byFamily.get(item.family ?? '');
    if (!famMap) continue;
    if (!famMap.has(item.app)) famMap.set(item.app, []);
    famMap.get(item.app)!.push(item);
  }

  // Filter live instances by search text + all active sidebar filters
  const liveQ = cardSearch.toLowerCase();
  const anyLiveFilter = liveQ || checkedEnv.length || checkedStatus.length ||
                        checkedDept.length || checkedBizUnit.length || checkedTier.length;

  const matchesLiveInst = (inst: LiveInstance): boolean => {
    if (liveQ && !safe(inst.name).toLowerCase().includes(liveQ)) return false;
    if (checkedEnv.length    && !checkedEnv.includes(inst.environment))            return false;
    if (checkedStatus.length && !checkedStatus.includes(inst.operational_status))  return false;
    // Department: match display value of the department reference field
    if (checkedDept.length   && !checkedDept.includes(inst.fieldValues['department'] ?? '')) return false;
    // Business Unit filter: also matched against department (same as mock-data behaviour)
    if (checkedBizUnit.length && !checkedBizUnit.includes(inst.fieldValues['department'] ?? '')) return false;
    // Tier: match display value of u_tier choice field
    if (checkedTier.length   && !checkedTier.includes(inst.fieldValues['u_tier'] ?? ''))      return false;
    return true;
  };

  const filteredLive = anyLiveFilter
    ? liveData
        .map(app => ({
          ...app,
          services: app.services
            .map(svc => ({ ...svc, instances: svc.instances.filter(matchesLiveInst) }))
            .filter(svc => svc.instances.length > 0),
        }))
        .filter(app => app.services.length > 0)
    : liveData;

  // 2-level filtered live data
  const filteredLiveTwoLevel = anyLiveFilter
    ? liveTwoLevel
        .map(appSvc => ({ ...appSvc, instances: appSvc.instances.filter(matchesLiveInst) }))
        .filter(appSvc => appSvc.instances.length > 0)
    : liveTwoLevel;

  const anyFilter = checkedEnv.length + checkedStatus.length + checkedBizUnit.length + checkedDept.length + checkedTier.length > 0;

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <AppSearchHeader mode="home" onSelectApp={onSelectApp} />

      <div className="flex flex-1 overflow-hidden">

        {/* ── Filter sidebar ── */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto flex-shrink-0">
          <div className="p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-semibold text-gray-800">Filters</span>
              </div>
              {anyFilter && (
                <button
                  onClick={() => { setCheckedEnv([]); setCheckedStatus([]); setCheckedBizUnit([]); setCheckedDept([]); setCheckedTier([]); }}
                  className="text-xs text-red-500 hover:text-red-700 underline"
                >Clear all</button>
              )}
            </div>

            <FilterSection title="Environment">
              {filtersLoading ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : envOptions.length === 0 ? <p className="text-xs text-gray-400 italic">No options</p>
                : envOptions.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                      <input type="checkbox" checked={checkedEnv.includes(opt.value)}
                        onChange={() => toggleFilter(checkedEnv, setCheckedEnv, opt.value)}
                        className="rounded border-gray-300 text-blue-600" />
                      <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                    </label>
                  ))
              }
            </FilterSection>

            <FilterSection title="Status">
              {filtersLoading ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : statusOptions.length === 0 ? <p className="text-xs text-gray-400 italic">No options</p>
                : statusOptions.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                      <input type="checkbox" checked={checkedStatus.includes(opt.value)}
                        onChange={() => toggleFilter(checkedStatus, setCheckedStatus, opt.value)}
                        className="rounded border-gray-300 text-blue-600" />
                      <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                    </label>
                  ))
              }
            </FilterSection>

            <FilterSection title="Business Unit">
              {filtersLoading ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : bizUnitOptions.length === 0 ? <p className="text-xs text-gray-400 italic">No options</p>
                : bizUnitOptions.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                      <input type="checkbox" checked={checkedBizUnit.includes(opt.value)}
                        onChange={() => toggleFilter(checkedBizUnit, setCheckedBizUnit, opt.value)}
                        className="rounded border-gray-300 text-blue-600" />
                      <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                    </label>
                  ))
              }
            </FilterSection>

            <FilterSection title="Department">
              {filtersLoading ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : deptOptions.length === 0 ? <p className="text-xs text-gray-400 italic">No options</p>
                : deptOptions.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                      <input type="checkbox" checked={checkedDept.includes(opt.value)}
                        onChange={() => toggleFilter(checkedDept, setCheckedDept, opt.value)}
                        className="rounded border-gray-300 text-blue-600" />
                      <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                    </label>
                  ))
              }
            </FilterSection>

            <FilterSection title="Tier">
              {filtersLoading ? <p className="text-xs text-gray-400 animate-pulse">Loading…</p>
                : tierOptions.map(opt => (
                    <label key={opt.value} className="flex items-center gap-2.5 cursor-pointer group">
                      <input type="checkbox" checked={checkedTier.includes(opt.value)}
                        onChange={() => toggleFilter(checkedTier, setCheckedTier, opt.value)}
                        className="rounded border-gray-300 text-blue-600" />
                      <span className="text-sm text-gray-700 group-hover:text-gray-900">{opt.label}</span>
                    </label>
                  ))
              }
            </FilterSection>
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 overflow-y-auto">

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-0 border-b border-gray-200 bg-white">
            {[
              { label: 'Total Instances',  value: liveStats.total,       icon: <Layers       className="w-5 h-5 text-blue-500"  /> },
              { label: 'Operational',      value: liveStats.operational,  icon: <CheckCircle2 className="w-5 h-5 text-green-500" /> },
              { label: 'Active Incidents', value: liveStats.incidents,    icon: <AlertCircle  className="w-5 h-5 text-red-500"   /> },
              { label: 'Upcoming Changes', value: liveStats.changes,      icon: <Calendar     className="w-5 h-5 text-yellow-500"/> },
            ].map((s, i) => (
              <div key={i} className={`px-5 py-4 flex items-center gap-4 ${i < 3 ? 'border-r border-gray-200' : ''}`}>
                <div className="p-2 bg-gray-50 rounded-lg">{s.icon}</div>
                <div>
                  {statsLoading
                    ? <div className="h-7 w-12 bg-gray-200 rounded animate-pulse mb-1" />
                    : <p className="text-2xl font-semibold text-gray-900">{s.value.toLocaleString()}</p>
                  }
                  <p className="text-xs text-gray-500">{s.label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Toolbar */}
          <div className="px-6 py-3 flex items-center justify-between border-b border-gray-200 bg-white/80 gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter cards…"
                value={cardSearch}
                onChange={e => setCardSearch(e.target.value)}
                className="w-full pl-9 pr-8 py-1.5 rounded-lg text-sm border border-gray-200 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 placeholder-gray-400"
              />
              {cardSearch && (
                <button onClick={() => setCardSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button onClick={() => setViewMode('list')}
                className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-blue-100 text-blue-700' : 'text-gray-400 hover:bg-gray-100'}`}>
                <List className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-6">

            {/* ── Live Data Section ── */}
            <div className="mb-2">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-xs font-semibold text-blue-700 uppercase tracking-wider">Live Data</span>
              </div>

              {liveLoading && (
                <div className="space-y-4">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="h-14 bg-white rounded-xl border border-gray-200 animate-pulse" />
                  ))}
                </div>
              )}

              {/* Phase 2 progress bar — shown after families are visible but instances still loading */}
              {!liveLoading && liveInstancesLoading && (
                <div className="flex items-center gap-3 px-4 py-2.5 mb-4 rounded-lg bg-blue-50 border border-blue-100 text-blue-600 text-xs">
                  <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" />
                  <span>Loading instance details in the background…</span>
                </div>
              )}

              {!liveLoading && liveError && (
                <div className="flex items-center gap-3 px-5 py-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm mb-4">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <span>Could not load live data: {liveError}</span>
                </div>
              )}

              {/* ── 3-level hierarchy (business app → service → instance) ── */}
              {!liveLoading && !liveError && hierarchyMode === true && filteredLive.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 mb-4">
                  <Database className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">No core applications found in ServiceNow.</p>
                </div>
              )}
              {!liveLoading && !liveError && hierarchyMode === true && filteredLive.map(app => (
                <LiveCoreAppSection
                  key={app.sys_id}
                  app={app}
                  viewMode={viewMode}
                  onSelectApp={onSelectApp}
                  onFlagClick={(title, ft, records) => setLivePanel({ title, flagType: ft, records })}
                />
              ))}

              {/* ── 2-level hierarchy (application service → instance service) ── */}
              {!liveLoading && !liveError && hierarchyMode === false && filteredLiveTwoLevel.length === 0 && (
                <div className="flex flex-col items-center justify-center py-10 text-gray-400 mb-4">
                  <Database className="w-10 h-10 mb-2 opacity-30" />
                  <p className="text-sm">No application services found in ServiceNow.</p>
                </div>
              )}
              {!liveLoading && !liveError && hierarchyMode === false && filteredLiveTwoLevel.map(appSvc => (
                <LiveAppSvcSection
                  key={appSvc.sys_id}
                  appSvc={appSvc}
                  viewMode={viewMode}
                  onSelectApp={onSelectApp}
                  onFlagClick={(title, ft, records) => setLivePanel({ title, flagType: ft, records })}
                />
              ))}
            </div>

            {/* ── Demo Data Section ── */}
            <div className="flex items-center gap-3 my-6">
              <div className="flex-1 border-t border-dashed border-gray-300" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-2">Demo Data</span>
              <div className="flex-1 border-t border-dashed border-gray-300" />
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Search className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm">No demo applications match your filters.</p>
              </div>
            ) : (
              appFamilies.map(family => {
                const appGroups = byFamily.get(family.id)!;
                if (appGroups.size === 0) return null;
                return (
                  <FamilySection
                    key={family.id}
                    family={family}
                    appGroups={appGroups}
                    viewMode={viewMode}
                    onSelectApp={onSelectApp}
                    onFlagClick={(app, flagType) => setPanel({ app, flagType })}
                  />
                );
              })
            )}
          </div>
        </main>
      </div>

      {/* Mock data flag panel */}
      {panel && (
        <FlagDetailPanel
          title={panel.app.name}
          subtitle="Application"
          flagType={panel.flagType}
          records={(panel.flagType === 'incident' ? appIncidents[panel.app.id] : appChanges[panel.app.id]) as (IncidentRecord[] | ChangeRecord[]) ?? []}
          onClose={() => setPanel(null)}
        />
      )}

      {/* Live data flag panel */}
      {livePanel && (
        <FlagDetailPanel
          title={livePanel.title}
          subtitle="Application Instance"
          flagType={livePanel.flagType}
          records={livePanel.records}
          onClose={() => setLivePanel(null)}
        />
      )}
    </div>
  );
}

// ─── App Card (grid view) — demo data ────────────────────────────────────────
function AppCard({ app, onViewDetails, onFlagClick }: {
  app: AppItem;
  onViewDetails: () => void;
  onFlagClick: (flagType: FlagType) => void;
}) {
  const st = statusBadge[app.status] ?? statusBadge['Operational'];
  return (
    <div className={`bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all group border-t-4 ${envAccent[app.env] ?? 'border-t-gray-300'} flex flex-col`}>
      <div className="p-5 flex-1">
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-gray-900 leading-snug">{app.name}</h3>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${envBadge[app.env] ?? 'bg-gray-100 text-gray-600'}`}>{app.env}</span>
        </div>
        <div className="space-y-1.5 mb-4">
          <div className="flex items-center gap-2 text-sm">
            <Building2  className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">App:</span><span className="text-gray-800 truncate">{app.app}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Layers     className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">Dept:</span><span className="text-gray-800">{app.dept}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <TrendingUp className="w-3.5 h-3.5 text-gray-400 shrink-0" /><span className="text-gray-500">Servers:</span><span className="text-gray-800">{app.servers}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${st.cls}`}>
            {st.icon}{app.status}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded ${criticalityBadge[app.criticality]}`}>{app.criticality}</span>
        </div>
        {(app.incidents > 0 || app.changes > 0) && (
          <div className="flex gap-2 flex-wrap">
            {app.incidents > 0 && (
              <button onClick={() => onFlagClick('incident')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
                <AlertCircle className="w-3.5 h-3.5" />{app.incidents} Active Incident{app.incidents > 1 ? 's' : ''}
              </button>
            )}
            {app.changes > 0 && (
              <button onClick={() => onFlagClick('change')}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
                <Calendar className="w-3.5 h-3.5" />Upcoming Change
              </button>
            )}
          </div>
        )}
      </div>
      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-xl">
        <span className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> {app.lastUpdated}</span>
        <button onClick={onViewDetails}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium transition-colors group-hover:underline">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── App Row (list view) — demo data ─────────────────────────────────────────
function AppRow({ app, onViewDetails, onFlagClick }: {
  app: AppItem;
  onViewDetails: () => void;
  onFlagClick: (flagType: FlagType) => void;
}) {
  const st = statusBadge[app.status] ?? statusBadge['Operational'];
  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-sm transition-all px-5 py-4 flex items-center gap-5">
      <div className={`w-1 h-12 rounded-full shrink-0 ${app.env === 'Production' ? 'bg-green-500' : app.env === 'Non-Prod (UAT)' ? 'bg-amber-400' : 'bg-blue-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <p className="text-sm font-semibold text-gray-900 truncate">{app.name}</p>
          <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${envBadge[app.env] ?? 'bg-gray-100 text-gray-600'}`}>{app.env}</span>
        </div>
        <p className="text-xs text-gray-500">{app.app} · {app.dept} · {app.servers} servers</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${st.cls}`}>
          {st.icon}{app.status}
        </span>
        {app.incidents > 0 && (
          <button onClick={() => onFlagClick('incident')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs border border-red-200 hover:bg-red-100 transition-colors">
            <AlertCircle className="w-3 h-3" />{app.incidents}
          </button>
        )}
        {app.changes > 0 && (
          <button onClick={() => onFlagClick('change')}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 text-yellow-700 rounded text-xs border border-yellow-200 hover:bg-yellow-100 transition-colors">
            <Calendar className="w-3 h-3" />CHG
          </button>
        )}
        <span className="text-xs text-gray-400">{app.lastUpdated}</span>
        <button onClick={onViewDetails} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium ml-2">
          View Details <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

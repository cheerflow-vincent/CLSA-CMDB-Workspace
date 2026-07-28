import { queryTable } from '../../api/servicenow';
import { loadViewFields, str, raw, type ViewField } from './viewFields';
import type { IncidentRecord, ChangeRecord } from '../components/FlagDetailPanel';

const VIEW_TITLE = 'CLSA CMDB Workspace';
const SVC_TABLE = 'cmdb_ci_service';
const CHUNK = 150;

const DEFAULT_VIEW_FIELDS: ViewField[] = [
  { element: 'department',         label: 'Department' },
  { element: 'environment',        label: 'Environment' },
  { element: 'operational_status', label: 'Operational Status' },
  { element: 'owned_by',           label: 'Owner' },
  { element: 'support_group',      label: 'Support Group' },
];

const APP_REL_TYPES = ['Runs on::Runs', 'Depends on::Used by'] as const;

export interface LiveInstance {
  sys_id: string;
  name: string;
  sys_class_name: string;
  operational_status: string;
  environment: string;
  fieldValues: Record<string, string>;
  viewFields: ViewField[];
  incidentRecords: IncidentRecord[];
  changeRecords: ChangeRecord[];
  incidents: number;
  changes: number;
}

export interface LiveService {
  sys_id: string;
  name: string;
  short_description: string;
  instances: LiveInstance[];
  totalIncidents: number;
  totalChanges: number;
}

export interface LiveCoreApp {
  sys_id: string;
  name: string;
  short_description: string;
  services: LiveService[];
  totalIncidents: number;
  totalChanges: number;
  totalInstances: number;
}

export interface LiveAppSvc {
  sys_id: string;
  name: string;
  short_description: string;
  instances: LiveInstance[];
  totalIncidents: number;
  totalChanges: number;
}

export interface RelatedApplicationsResult {
  threeLevel: LiveCoreApp[];
  twoLevel: LiveAppSvc[];
}

function refId(f: unknown): string {
  if (f == null) return '';
  if (typeof f === 'string') return f;
  if (typeof f === 'object' && 'value' in f) return String((f as Record<string, unknown>).value ?? '');
  return '';
}

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
      table,
      query: q,
      fields,
      limit: limitPerChunk,
      ...(options?.displayValue ? { displayValue: options.displayValue } : {}),
    });
    all.push(...result);
  }
  return all;
}

/** Parent app instances linked to a CI (reverse of app-detail related lists). */
export async function fetchRelatedAppInstanceIds(ciSysId: string): Promise<string[]> {
  if (!ciSysId) return [];

  const seen = new Set<string>();
  for (const relType of APP_REL_TYPES) {
    const { result = [] } = await queryTable<{ parent: unknown }>({
      table: 'cmdb_rel_ci',
      query: `type.name=${relType}^child.sys_id=${ciSysId}^parent.sys_class_nameINSTANCEOF${SVC_TABLE}`,
      fields: ['parent'],
      limit: 500,
      displayValue: false,
    });
    for (const r of result) {
      const id = refId(r.parent);
      if (id) seen.add(id);
    }
  }

  return [...seen];
}

async function loadLiveInstances(instanceIds: string[]): Promise<Map<string, LiveInstance>> {
  const instMap = new Map<string, LiveInstance>();
  if (!instanceIds.length) return instMap;

  const CORE = ['sys_id', 'name', 'sys_class_name', 'operational_status', 'environment'];
  const FILTER_EXTRA = ['department', 'u_tier'];

  const coreInsts = await chunkedIN<Record<string, unknown>>(
    'cmdb_ci', 'sys_id', instanceIds, '', CORE, 500, { displayValue: 'all' },
  );
  const tableNames = [...new Set(coreInsts.map(i => raw(i.sys_class_name)).filter(Boolean))];

  const [viewFieldsByTable, incRows, chgRows] = await Promise.all([
    Promise.all(tableNames.map(t => loadViewFields(t, VIEW_TITLE, 5, DEFAULT_VIEW_FIELDS).then(vf => ({ table: t, vf })))),
    chunkedIN<Record<string, unknown>>(
      'task_ci', 'ci_item', instanceIds,
      'task.sys_class_name=incident^task.active=true',
      ['ci_item.sys_id', 'task.number', 'task.short_description', 'task.priority', 'task.state', 'task.opened_at', 'task.assigned_to'],
      500, { displayValue: true },
    ),
    chunkedIN<Record<string, unknown>>(
      'task_ci', 'ci_item', instanceIds,
      'task.sys_class_name=change_request^task.state=-2',
      ['ci_item.sys_id', 'task.number', 'task.short_description', 'task.type', 'task.state', 'task.start_date', 'task.assigned_to'],
      500, { displayValue: true },
    ),
  ]);

  const viewFieldMap = new Map(viewFieldsByTable.map(({ table, vf }) => [table, vf]));
  const allViewElems = [...new Set(viewFieldsByTable.flatMap(({ vf }) => vf.map(f => f.element)))];
  const fetchFields = [...new Set([...CORE, ...allViewElems, ...FILTER_EXTRA])];

  const fullInsts = await chunkedIN<Record<string, unknown>>(
    'cmdb_ci', 'sys_id', instanceIds, '', fetchFields, 500, { displayValue: 'all' },
  );

  for (const i of fullInsts) {
    const tableName = raw(i.sys_class_name);
    const fieldValues: Record<string, string> = {};
    for (const field of fetchFields) fieldValues[field] = str(i[field]);
    instMap.set(raw(i.sys_id) || str(i.sys_id), {
      sys_id: raw(i.sys_id) || str(i.sys_id),
      name: str(i.name),
      sys_class_name: tableName,
      operational_status: str(i.operational_status),
      environment: str(i.environment),
      fieldValues,
      viewFields: viewFieldMap.get(tableName) ?? DEFAULT_VIEW_FIELDS,
      incidentRecords: [],
      changeRecords: [],
      incidents: 0,
      changes: 0,
    });
  }

  for (const r of incRows) {
    const inst = instMap.get(str(r['ci_item.sys_id']));
    if (!inst) continue;
    inst.incidentRecords.push({
      number: str(r['task.number']),
      short: str(r['task.short_description']),
      priority: str(r['task.priority']),
      state: str(r['task.state']),
      opened: str(r['task.opened_at']),
      assignee: str(r['task.assigned_to']),
    });
  }

  for (const r of chgRows) {
    const inst = instMap.get(str(r['ci_item.sys_id']));
    if (!inst) continue;
    inst.changeRecords.push({
      number: str(r['task.number']),
      short: str(r['task.short_description']),
      type: str(r['task.type']),
      state: str(r['task.state']),
      scheduled: str(r['task.start_date']),
      implementer: str(r['task.assigned_to']),
    });
  }

  for (const inst of instMap.values()) {
    inst.incidents = inst.incidentRecords.length;
    inst.changes = inst.changeRecords.length;
  }

  return instMap;
}

async function buildThreeLevelHierarchy(
  instanceIds: string[],
  instMap: Map<string, LiveInstance>,
): Promise<LiveCoreApp[]> {
  if (!instanceIds.length) return [];

  const containsRows = await chunkedIN<Record<string, unknown>>(
    'cmdb_rel_ci', 'child.sys_id', instanceIds,
    'type.name=Contains::Contained by',
    ['parent', 'child', 'parent.name', 'parent.short_description'],
    5000,
  );

  const instToSvc = new Map<string, { id: string; name: string; desc: string }>();
  const svcToInsts = new Map<string, LiveInstance[]>();

  for (const id of instanceIds) {
    const inst = instMap.get(id);
    if (!inst) continue;
    const row = containsRows.find(r => refId(r.child) === id);
    const svcId = row ? refId(row.parent) : 'unknown';
    const svcName = row ? str(row['parent.name']) : 'Unknown Service';
    const svcDesc = row ? str(row['parent.short_description']) : '';
    instToSvc.set(id, { id: svcId, name: svcName, desc: svcDesc });
    if (!svcToInsts.has(svcId)) svcToInsts.set(svcId, []);
    svcToInsts.get(svcId)!.push(inst);
  }

  const svcIds = [...svcToInsts.keys()].filter(id => id !== 'unknown');
  const consumesRows = svcIds.length
    ? await chunkedIN<Record<string, unknown>>(
      'cmdb_rel_ci', 'child.sys_id', svcIds,
      'type.name=Consumes::Consumed by',
      ['parent', 'child', 'parent.name', 'parent.short_description'],
      5000,
    )
    : [];

  const svcToApp = new Map<string, { id: string; name: string; desc: string }>();
  for (const svcId of svcIds) {
    const row = consumesRows.find(r => refId(r.child) === svcId);
    svcToApp.set(svcId, {
      id: row ? refId(row.parent) : `orphan-${svcId}`,
      name: row ? str(row['parent.name']) : 'Related Applications',
      desc: row ? str(row['parent.short_description']) : '',
    });
  }

  const appToSvcs = new Map<string, LiveService[]>();
  for (const [svcId, instances] of svcToInsts) {
    const app = svcToApp.get(svcId) ?? { id: 'orphan', name: 'Related Applications', desc: '' };
    const svcMeta = [...instToSvc.values()].find(s => s.id === svcId);
    const service: LiveService = {
      sys_id: svcId,
      name: svcMeta?.name ?? svcId,
      short_description: svcMeta?.desc ?? '',
      instances,
      totalIncidents: instances.reduce((s, i) => s + i.incidents, 0),
      totalChanges: instances.reduce((s, i) => s + i.changes, 0),
    };
    if (!appToSvcs.has(app.id)) appToSvcs.set(app.id, []);
    appToSvcs.get(app.id)!.push(service);
  }

  const apps: LiveCoreApp[] = [];
  for (const [appId, services] of appToSvcs) {
    const meta = [...svcToApp.entries()].find(([, v]) => v.id === appId)?.[1]
      ?? { id: appId, name: 'Related Applications', desc: '' };
    apps.push({
      sys_id: appId,
      name: meta.name,
      short_description: meta.desc,
      services,
      totalIncidents: services.reduce((s, sv) => s + sv.totalIncidents, 0),
      totalChanges: services.reduce((s, sv) => s + sv.totalChanges, 0),
      totalInstances: services.reduce((s, sv) => s + sv.instances.length, 0),
    });
  }

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

async function buildTwoLevelHierarchy(
  instanceIds: string[],
  instMap: Map<string, LiveInstance>,
): Promise<LiveAppSvc[]> {
  if (!instanceIds.length) return [];

  const hop2Rows = await chunkedIN<Record<string, unknown>>(
    'cmdb_rel_ci', 'child.sys_id', instanceIds,
    'child.u_service_type=instance^type.name=Connects to::Connected by',
    ['parent', 'child'],
    5000,
  );

  const instToMid = new Map<string, string>();
  for (const r of hop2Rows) {
    const instId = refId(r.child);
    const midId = refId(r.parent);
    if (instId && midId) instToMid.set(instId, midId);
  }

  const midIds = [...new Set(instToMid.values())];
  const hop1Rows = midIds.length
    ? await chunkedIN<Record<string, unknown>>(
      'cmdb_rel_ci', 'child.sys_id', midIds,
      'parent.u_service_type=service^type.name=Connects to::Connected by',
      ['parent', 'child', 'parent.name', 'parent.short_description'],
      5000,
    )
    : [];

  const midToApp = new Map<string, { id: string; name: string; desc: string }>();
  for (const r of hop1Rows) {
    midToApp.set(refId(r.child), {
      id: refId(r.parent),
      name: str(r['parent.name']),
      desc: str(r['parent.short_description']),
    });
  }

  const appToInsts = new Map<string, LiveInstance[]>();
  const appMeta = new Map<string, { name: string; desc: string }>();

  for (const id of instanceIds) {
    const inst = instMap.get(id);
    if (!inst) continue;
    const midId = instToMid.get(id);
    const app = midId ? midToApp.get(midId) : null;
    const appId = app?.id ?? 'orphan';
    if (app) appMeta.set(appId, { name: app.name, desc: app.desc });
    else appMeta.set(appId, { name: 'Related Applications', desc: '' });
    if (!appToInsts.has(appId)) appToInsts.set(appId, []);
    appToInsts.get(appId)!.push(inst);
  }

  return [...appToInsts.entries()]
    .map(([appId, instances]) => {
      const meta = appMeta.get(appId) ?? { name: appId, desc: '' };
      return {
        sys_id: appId,
        name: meta.name,
        short_description: meta.desc,
        instances,
        totalIncidents: instances.reduce((s, i) => s + i.incidents, 0),
        totalChanges: instances.reduce((s, i) => s + i.changes, 0),
      };
    })
    .filter(a => a.instances.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadRelatedApplicationsForCi(
  ciSysId: string,
  hierarchyMode: boolean,
): Promise<RelatedApplicationsResult> {
  const instanceIds = await fetchRelatedAppInstanceIds(ciSysId);
  if (!instanceIds.length) {
    return { threeLevel: [], twoLevel: [] };
  }

  const instMap = await loadLiveInstances(instanceIds);

  if (hierarchyMode) {
    const threeLevel = await buildThreeLevelHierarchy(instanceIds, instMap);
    return { threeLevel, twoLevel: [] };
  }

  const twoLevel = await buildTwoLevelHierarchy(instanceIds, instMap);
  return { threeLevel: [], twoLevel };
}

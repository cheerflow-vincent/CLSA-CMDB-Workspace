import { getSysProperties, queryTable } from '../../api/servicenow';

export const REL_TYPES_PROP = 'x_citi4_clsa_cmd_0.app.to.app.relationship.types';

export const DEFAULT_IMPACT_REL_TYPE = 'impacts::impacted by';
export const DEFAULT_DATA_FLOW_REL_TYPE = 'Receives data from::Sends data to';

export const DEFAULT_REL_TYPE_NAMES = [DEFAULT_IMPACT_REL_TYPE, DEFAULT_DATA_FLOW_REL_TYPE] as const;

export interface AppRelationshipTypeConfig {
  typeSysIds: string[];
  typeNames: string[];
  options: { value: string; label: string }[];
  typeQuery: string;
}

let cached: AppRelationshipTypeConfig | null = null;
let loading: Promise<AppRelationshipTypeConfig> | null = null;

function buildTypeQuery(typeSysIds: string[]): string {
  if (!typeSysIds.length) return 'sys_id=-1';
  return `type.sys_idIN${typeSysIds.join(',')}`;
}

function buildConfig(typeSysIds: string[], typeNames: string[]): AppRelationshipTypeConfig {
  const options = typeNames.map(name => ({ value: name, label: name }));
  return {
    typeSysIds,
    typeNames,
    options,
    typeQuery: buildTypeQuery(typeSysIds),
  };
}

async function resolveTypesBySysIds(sysIds: string[]): Promise<AppRelationshipTypeConfig> {
  const { result = [] } = await queryTable<{ sys_id: string; name: string }>({
    table: 'cmdb_rel_type',
    query: `sys_idIN${sysIds.join(',')}`,
    fields: ['sys_id', 'name'],
    limit: sysIds.length + 5,
  });

  const byId = new Map(result.map(r => [r.sys_id, r.name]));
  const orderedSysIds: string[] = [];
  const orderedNames: string[] = [];

  for (const id of sysIds) {
    const name = byId.get(id);
    if (!name) continue;
    orderedSysIds.push(id);
    orderedNames.push(name);
  }

  return buildConfig(orderedSysIds, orderedNames);
}

async function resolveDefaultTypes(): Promise<AppRelationshipTypeConfig> {
  const { result = [] } = await queryTable<{ sys_id: string; name: string }>({
    table: 'cmdb_rel_type',
    query: `nameIN${DEFAULT_REL_TYPE_NAMES.join(',')}`,
    fields: ['sys_id', 'name'],
    limit: DEFAULT_REL_TYPE_NAMES.length + 5,
  });

  const byName = new Map(result.map(r => [r.name, r.sys_id]));
  const typeSysIds: string[] = [];
  const typeNames: string[] = [];

  for (const name of DEFAULT_REL_TYPE_NAMES) {
    const sysId = byName.get(name);
    if (!sysId) continue;
    typeSysIds.push(sysId);
    typeNames.push(name);
  }

  return buildConfig(typeSysIds, typeNames);
}

async function loadAppRelationshipTypesUncached(): Promise<AppRelationshipTypeConfig> {
  const props = await getSysProperties([REL_TYPES_PROP]);
  const raw = (props[REL_TYPES_PROP] ?? '').trim();
  const sysIds = raw
    ? raw.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  if (sysIds.length) {
    const config = await resolveTypesBySysIds(sysIds);
    if (config.typeSysIds.length) return config;
  }

  return resolveDefaultTypes();
}

/** Cached configured app-to-app relationship types from system property. */
export function getAppRelationshipTypes(): Promise<AppRelationshipTypeConfig> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = loadAppRelationshipTypesUncached()
      .then(config => {
        cached = config;
        return config;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

export function relTypeLabel(relType: string, config?: AppRelationshipTypeConfig): string {
  const opt = config?.options.find(o => o.value === relType);
  return opt?.label ?? relType;
}

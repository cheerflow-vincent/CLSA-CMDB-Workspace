import { getSysProperties, queryTable } from '../../api/servicenow';

export const REL_TYPES_PROP = 'x_citi4_clsa_cmd_0.service.to.instance.relationship.types';

export const DEFAULT_REL_TYPE_NAME = 'Contains::Contained by';

export interface ServiceToInstanceRelationshipTypeConfig {
  typeSysIds: string[];
  typeNames: string[];
  typeQuery: string;
}

let cached: ServiceToInstanceRelationshipTypeConfig | null = null;
let loading: Promise<ServiceToInstanceRelationshipTypeConfig> | null = null;

function buildTypeQuery(typeSysIds: string[]): string {
  if (!typeSysIds.length) return 'sys_id=-1';
  return `type.sys_idIN${typeSysIds.join(',')}`;
}

function buildConfig(typeSysIds: string[], typeNames: string[]): ServiceToInstanceRelationshipTypeConfig {
  return {
    typeSysIds,
    typeNames,
    typeQuery: buildTypeQuery(typeSysIds),
  };
}

async function resolveTypesBySysIds(sysIds: string[]): Promise<ServiceToInstanceRelationshipTypeConfig> {
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

async function resolveDefaultTypes(): Promise<ServiceToInstanceRelationshipTypeConfig> {
  const { result = [] } = await queryTable<{ sys_id: string; name: string }>({
    table: 'cmdb_rel_type',
    query: `name=${DEFAULT_REL_TYPE_NAME}`,
    fields: ['sys_id', 'name'],
    limit: 2,
  });

  const row = result[0];
  if (!row?.sys_id) return buildConfig([], []);
  return buildConfig([row.sys_id], [row.name]);
}

async function loadServiceToInstanceRelationshipTypesUncached(): Promise<ServiceToInstanceRelationshipTypeConfig> {
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

/** Cached configured service-to-instance relationship types from system property. */
export function getServiceToInstanceRelationshipTypes(): Promise<ServiceToInstanceRelationshipTypeConfig> {
  if (cached) return Promise.resolve(cached);
  loading ??= loadServiceToInstanceRelationshipTypesUncached()
    .then(config => {
      cached = config;
      return config;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

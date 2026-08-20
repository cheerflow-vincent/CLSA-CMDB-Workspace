import {
  createCmdbRelCi,
  deleteCmdbRelCi,
  queryTableWithAccess,
  type TableAccess,
} from '../../api/servicenow';
import { filterColumnsByRecords } from './acl';
import { loadListFields, raw, str, type ViewField } from './viewFields';
import { fetchCITaskFlagCounts } from './relatedCIFlags';
import type { InfraCIType } from './infraCiStyles';

export const LIST_VIEW_TITLE = 'CLSA CMDB Workspace Overview';
export const RELATED_CI_PAGE_SIZE = 10;
export const INFRA_PEER_LIMIT = 300;

export interface RelatedCIConfig {
  relType: string;
  baseClass: string;
  /** Parent CI table used to fetch record field values (includes subclasses). */
  ciTable: string;
  listTitle: string;
  defaultColumns: ViewField[];
  ciType: InfraCIType;
  /** Which side of cmdb_rel_ci the application record is on. Default 'parent'. */
  appRole?: 'parent' | 'child';
}

export interface RelatedCIRow {
  sysId: string;
  sysClass: string;
  values: Record<string, string>;
  incidents: number;
  changes: number;
  /** Direct CI relationship type (CI detail infra table only). */
  relType?: string;
  relSysId?: string;
}

export interface RelatedCIPage {
  rows: RelatedCIRow[];
  columns: ViewField[];
  totalCount: number;
  access: TableAccess;
}

export interface InfraCIPeer {
  sysId: string;
  name: string;
  sysClass: string;
  ciType: InfraCIType;
  relType: string;
  relSysId: string;
  appRole: 'parent' | 'child';
  /** Current CI's role in cmdb_rel_ci (CI detail direct query only). */
  centerRole?: 'parent' | 'child';
}

export interface InfraRelationshipRow {
  relSysId: string;
  ciSysId: string;
  ciName: string;
  ciClass: string;
  relType: string;
}

export interface InfraRelationshipsByType {
  ciType: InfraCIType;
  config: RelatedCIConfig;
  rows: InfraRelationshipRow[];
  relTypesInUse: string[];
}

export const SERVER_REL_CONFIG: RelatedCIConfig = {
  relType: 'Runs on::Runs',
  baseClass: 'cmdb_ci_server',
  ciTable: 'cmdb_ci_server',
  ciType: 'server',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'name',        label: 'Name'        },
    { element: 'environment', label: 'Environment' },
    { element: 'os',          label: 'OS'          },
    { element: 'location',    label: 'Location'    },
  ],
};

export const DATABASE_REL_CONFIG: RelatedCIConfig = {
  relType: 'Depends on::Used by',
  baseClass: 'cmdb_ci_db_instance',
  ciTable: 'cmdb_ci_db_instance',
  ciType: 'database',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'name',        label: 'Name'        },
    { element: 'version',     label: 'Version'     },
    { element: 'environment', label: 'Environment' },
    { element: 'location',    label: 'Location'    },
  ],
};

export const NETGEAR_REL_CONFIG: RelatedCIConfig = {
  relType: 'Runs on::Runs',
  baseClass: 'cmdb_ci_netgear',
  ciTable: 'cmdb_ci_netgear',
  ciType: 'netgear',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'name',        label: 'Name'        },
    { element: 'environment', label: 'Environment' },
    { element: 'model_id',    label: 'Model'       },
    { element: 'location',    label: 'Location'    },
  ],
};

export const NETWORK_LINK_REL_CONFIG: RelatedCIConfig = {
  relType: 'Runs on::Runs',
  baseClass: 'cmdb_ci_network_link',
  ciTable: 'cmdb_ci_network_link',
  ciType: 'network_link',
  listTitle: LIST_VIEW_TITLE,
  defaultColumns: [
    { element: 'name',        label: 'Name'        },
    { element: 'environment', label: 'Environment' },
    { element: 'location',    label: 'Location'    },
  ],
};

export const INFRA_REL_CONFIGS: RelatedCIConfig[] = [
  SERVER_REL_CONFIG,
  NETGEAR_REL_CONFIG,
  NETWORK_LINK_REL_CONFIG,
  DATABASE_REL_CONFIG,
];

function appRole(config: RelatedCIConfig): 'parent' | 'child' {
  return config.appRole ?? 'parent';
}

/** Dot-walk prefix for the infra CI side of the relationship. */
function infraSidePrefix(config: RelatedCIConfig): 'child' | 'parent' {
  return appRole(config) === 'child' ? 'parent' : 'child';
}

export function buildRelQuery(appSysId: string, config: RelatedCIConfig): string {
  if (appRole(config) === 'child') {
    return `type.name=${config.relType}^child.sys_id=${appSysId}^parent.sys_class_nameINSTANCEOF${config.baseClass}`;
  }
  return `type.name=${config.relType}^parent.sys_id=${appSysId}^child.sys_class_nameINSTANCEOF${config.baseClass}`;
}

function buildRelQueryOrdered(appSysId: string, config: RelatedCIConfig): string {
  const side = infraSidePrefix(config);
  return `${buildRelQuery(appSysId, config)}^ORDERBY${side}.name`;
}

function relFields(config: RelatedCIConfig): string[] {
  const side = infraSidePrefix(config);
  return [
    'sys_id',
    'type.name',
    `${side}.sys_id`,
    `${side}.name`,
    `${side}.sys_class_name`,
  ];
}

function parseInfraPeerFromRelRow(
  row: Record<string, unknown>,
  config: RelatedCIConfig,
): InfraCIPeer | null {
  const side = infraSidePrefix(config);
  const sysId = raw(row[`${side}.sys_id`]);
  if (!sysId) return null;
  return {
    sysId,
    name: str(row[`${side}.name`]) || sysId,
    sysClass: raw(row[`${side}.sys_class_name`]) || config.baseClass,
    ciType: config.ciType,
    relType: str(row['type.name']) || config.relType,
    relSysId: raw(row.sys_id),
    appRole: appRole(config),
  };
}

export function resolveInfraParentChild(
  appSysId: string,
  infraCiSysId: string,
  config: RelatedCIConfig,
): { parentSysId: string; childSysId: string } {
  if (appRole(config) === 'child') {
    return { parentSysId: infraCiSysId, childSysId: appSysId };
  }
  return { parentSysId: appSysId, childSysId: infraCiSysId };
}

export async function fetchRelatedCICount(
  appSysId: string,
  config: RelatedCIConfig,
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!appSysId) return { totalCount: 0, access: 'ok' };
  const { totalCount, access } = await queryTableWithAccess({
    table: 'cmdb_rel_ci',
    query: buildRelQuery(appSysId, config),
    fields: ['sys_id'],
    limit: 1,
  });
  return { totalCount, access };
}

export async function fetchRelatedCIPage(
  appSysId: string,
  config: RelatedCIConfig,
  page: number,
  pageSize = RELATED_CI_PAGE_SIZE,
): Promise<RelatedCIPage> {
  const layoutColumns = await loadListFields(
    config.baseClass,
    config.listTitle,
    config.defaultColumns,
  );

  if (!appSysId) {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'ok' };
  }

  const side = infraSidePrefix(config);
  const { result: relRows = [], totalCount, access: relAccess } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'cmdb_rel_ci',
    query: buildRelQueryOrdered(appSysId, config),
    fields: [`${side}.sys_id`, `${side}.name`, `${side}.sys_class_name`],
    limit: pageSize,
    offset: page * pageSize,
    displayValue: 'all',
  });

  if (relAccess === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: relAccess };
  }

  const seen = new Set<string>();
  const infraIds: string[] = [];
  const classById = new Map<string, string>();

  for (const r of relRows) {
    const id = raw(r[`${side}.sys_id`]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    infraIds.push(id);
    classById.set(id, raw(r[`${side}.sys_class_name`]) || config.baseClass);
  }

  if (!infraIds.length) {
    return { rows: [], columns: layoutColumns, totalCount, access: relAccess };
  }

  const fields = [...new Set(['sys_id', 'name', 'sys_class_name', ...layoutColumns.map(c => c.element)])];
  const { result: ciRows = [], access: ciAccess } = await queryTableWithAccess<Record<string, unknown>>({
    table: config.ciTable,
    query: `sys_idIN${infraIds.join(',')}`,
    fields,
    limit: infraIds.length + 5,
    displayValue: true,
  });

  if (ciAccess === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount, access: 'denied' };
  }

  const access: TableAccess = relAccess === 'error' || ciAccess === 'error' ? 'error' : 'ok';

  const columns = filterColumnsByRecords(layoutColumns, ciRows);

  const ciById = new Map(ciRows.map(r => [raw(r.sys_id), r]));

  const rows: RelatedCIRow[] = infraIds.map(id => {
    const rec = ciById.get(id);
    const sysClass = rec
      ? (raw(rec.sys_class_name) || classById.get(id) || config.baseClass)
      : (classById.get(id) || config.baseClass);
    const values: Record<string, string> = {};
    for (const col of columns) {
      if (rec && col.element in rec) {
        values[col.element] = str(rec[col.element]);
      }
    }
    if (!values.name && rec && 'name' in rec) values.name = str(rec.name);
    return { sysId: id, sysClass, values, incidents: 0, changes: 0 };
  });

  const flagCounts = await fetchCITaskFlagCounts(infraIds);
  for (const row of rows) {
    const flags = flagCounts.get(row.sysId);
    if (flags) {
      row.incidents = flags.incidents;
      row.changes = flags.changes;
    }
  }

  return { rows, columns, totalCount, access };
}

export async function fetchInfraPeersForConfig(
  appSysId: string,
  config: RelatedCIConfig,
): Promise<{ peers: InfraCIPeer[]; access: TableAccess; totalCount: number }> {
  if (!appSysId) return { peers: [], access: 'ok', totalCount: 0 };

  const { result = [], totalCount, access } = await queryTableWithAccess<Record<string, unknown>>({
    table: 'cmdb_rel_ci',
    query: buildRelQueryOrdered(appSysId, config),
    fields: relFields(config),
    limit: INFRA_PEER_LIMIT,
    displayValue: 'all',
  });

  if (access === 'denied') {
    return { peers: [], access, totalCount: 0 };
  }

  const seen = new Set<string>();
  const peers: InfraCIPeer[] = [];
  for (const row of result) {
    const peer = parseInfraPeerFromRelRow(row, config);
    if (!peer || seen.has(peer.sysId)) continue;
    seen.add(peer.sysId);
    peers.push(peer);
  }

  return { peers, access, totalCount };
}

export async function fetchAllInfraPeers(appSysId: string): Promise<{
  peers: InfraCIPeer[];
  access: TableAccess;
}> {
  if (!appSysId) return { peers: [], access: 'ok' };

  const results = await Promise.all(
    INFRA_REL_CONFIGS.map(config => fetchInfraPeersForConfig(appSysId, config)),
  );

  let access: TableAccess = 'ok';
  const peers: InfraCIPeer[] = [];
  for (const r of results) {
    if (r.access === 'denied') access = 'denied';
    else if (r.access === 'error' && access !== 'denied') access = 'error';
    peers.push(...r.peers);
  }

  return { peers, access };
}

/** Map a CMDB table/class name to an infrastructure CI type for diagram styling. */
export function resolveInfraCIType(tableOrClass: string): InfraCIType | null {
  const normalized = tableOrClass.toLowerCase();
  for (const config of INFRA_REL_CONFIGS) {
    if (normalized === config.baseClass || normalized.includes(config.baseClass)) {
      return config.ciType;
    }
  }
  if (normalized.includes('server')) return 'server';
  if (normalized.includes('netgear') || normalized.includes('switch')) return 'netgear';
  if (normalized.includes('network_link')) return 'network_link';
  if (normalized.includes('db_instance') || normalized.includes('database')) return 'database';
  return null;
}

async function fetchInfraPeersForCiByConfig(
  ciSysId: string,
  config: RelatedCIConfig,
): Promise<{ peers: InfraCIPeer[]; access: TableAccess }> {
  if (!ciSysId) return { peers: [], access: 'ok' };

  const peerSideForCenter = (centerRole: 'parent' | 'child'): 'child' | 'parent' =>
    centerRole === 'parent' ? 'child' : 'parent';

  const directRelFields = (centerRole: 'parent' | 'child'): string[] => {
    const peerSide = peerSideForCenter(centerRole);
    return [
      'sys_id',
      'type.name',
      `${peerSide}.sys_id`,
      `${peerSide}.name`,
      `${peerSide}.sys_class_name`,
    ];
  };

  const parseDirectInfraPeer = (
    row: Record<string, unknown>,
    centerRole: 'parent' | 'child',
  ): InfraCIPeer | null => {
    const peerSide = peerSideForCenter(centerRole);
    const sysId = raw(row[`${peerSide}.sys_id`]);
    if (!sysId || sysId === ciSysId) return null;
    const relSysId = raw(row.sys_id);
    if (!relSysId) return null;
    return {
      sysId,
      name: str(row[`${peerSide}.name`]) || sysId,
      sysClass: raw(row[`${peerSide}.sys_class_name`]) || config.baseClass,
      ciType: config.ciType,
      relType: str(row['type.name']) || '',
      relSysId,
      appRole: appRole(config),
      centerRole,
    };
  };

  const buildDirectInfraRelQuery = (
    centerRole: 'parent' | 'child',
  ): string => {
    const peerSide = peerSideForCenter(centerRole);
    return `${centerRole}.sys_id=${ciSysId}^${peerSide}.sys_class_nameINSTANCEOF${config.baseClass}^ORDERBY${peerSide}.name`;
  };

  let access: TableAccess = 'ok';
  const seenRelIds = new Set<string>();
  const peers: InfraCIPeer[] = [];

  for (const centerRole of ['parent', 'child'] as const) {
    const { result = [], access: chunkAccess } = await queryTableWithAccess<Record<string, unknown>>({
      table: 'cmdb_rel_ci',
      query: buildDirectInfraRelQuery(centerRole),
      fields: directRelFields(centerRole),
      limit: INFRA_PEER_LIMIT,
      displayValue: 'all',
    });

    if (chunkAccess === 'denied') return { peers: [], access: 'denied' };
    if (chunkAccess === 'error') access = 'error';

    for (const row of result) {
      const peer = parseDirectInfraPeer(row, centerRole);
      if (!peer || seenRelIds.has(peer.relSysId)) continue;
      seenRelIds.add(peer.relSysId);
      peers.push(peer);
    }
  }

  peers.sort((a, b) => a.name.localeCompare(b.name) || a.relType.localeCompare(b.relType));
  return { peers, access };
}

/** Direct infrastructure peers linked to this CI via cmdb_rel_ci (parent or child). */
export async function fetchInfraPeersForCi(ciSysId: string): Promise<{
  peers: InfraCIPeer[];
  access: TableAccess;
}> {
  if (!ciSysId) return { peers: [], access: 'ok' };

  const results = await Promise.all(
    INFRA_REL_CONFIGS.map(config => fetchInfraPeersForCiByConfig(ciSysId, config)),
  );

  let access: TableAccess = 'ok';
  const seenRelIds = new Set<string>();
  const peers: InfraCIPeer[] = [];
  for (const r of results) {
    if (r.access === 'denied') return { peers: [], access: 'denied' };
    if (r.access === 'error') access = 'error';
    for (const p of r.peers) {
      if (seenRelIds.has(p.relSysId)) continue;
      seenRelIds.add(p.relSysId);
      peers.push(p);
    }
  }

  return { peers, access };
}

export async function fetchRelatedCICountForCi(
  ciSysId: string,
  config: RelatedCIConfig,
): Promise<{ totalCount: number; access: TableAccess }> {
  if (!ciSysId) return { totalCount: 0, access: 'ok' };
  const { peers, access } = await fetchInfraPeersForCiByConfig(ciSysId, config);
  return { totalCount: peers.length, access };
}

export async function fetchRelatedCIPageForCi(
  ciSysId: string,
  config: RelatedCIConfig,
  page: number,
  pageSize = RELATED_CI_PAGE_SIZE,
): Promise<RelatedCIPage> {
  const layoutColumns = await loadListFields(
    config.baseClass,
    config.listTitle,
    config.defaultColumns,
  );

  if (!ciSysId) {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'ok' };
  }

  const { peers, access: peerAccess } = await fetchInfraPeersForCiByConfig(ciSysId, config);
  if (peerAccess === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount: 0, access: 'denied' };
  }

  const totalCount = peers.length;
  const pagePeers = peers.slice(page * pageSize, (page + 1) * pageSize);

  if (!pagePeers.length) {
    return { rows: [], columns: layoutColumns, totalCount, access: peerAccess };
  }

  const uniquePeerIds = [...new Set(pagePeers.map(p => p.sysId))];
  const classById = new Map(pagePeers.map(p => [p.sysId, p.sysClass]));
  const fields = [...new Set(['sys_id', 'name', 'sys_class_name', ...layoutColumns.map(c => c.element)])];
  const { result: ciRows = [], access: ciAccess } = await queryTableWithAccess<Record<string, unknown>>({
    table: config.ciTable,
    query: `sys_idIN${uniquePeerIds.join(',')}`,
    fields,
    limit: uniquePeerIds.length + 5,
    displayValue: true,
  });

  if (ciAccess === 'denied') {
    return { rows: [], columns: layoutColumns, totalCount, access: 'denied' };
  }

  const access: TableAccess = peerAccess === 'error' || ciAccess === 'error' ? 'error' : 'ok';
  const columns = filterColumnsByRecords(layoutColumns, ciRows);
  const ciById = new Map(ciRows.map(r => [raw(r.sys_id), r]));

  const rows: RelatedCIRow[] = pagePeers.map(peer => {
    const id = peer.sysId;
    const rec = ciById.get(id);
    const sysClass = rec
      ? (raw(rec.sys_class_name) || classById.get(id) || config.baseClass)
      : (classById.get(id) || config.baseClass);
    const values: Record<string, string> = {};
    for (const col of columns) {
      if (rec && col.element in rec) {
        values[col.element] = str(rec[col.element]);
      }
    }
    if (!values.name && rec && 'name' in rec) values.name = str(rec.name);
    if (!values.name) values.name = peer.name;
    return {
      sysId: id,
      sysClass,
      values,
      incidents: 0,
      changes: 0,
      relType: peer.relType,
      relSysId: peer.relSysId,
    };
  });

  const flagCounts = await fetchCITaskFlagCounts(uniquePeerIds);
  for (const row of rows) {
    const flags = flagCounts.get(row.sysId);
    if (flags) {
      row.incidents = flags.incidents;
      row.changes = flags.changes;
    }
  }

  return { rows, columns, totalCount, access };
}

export async function fetchInfraRelationshipsForEdit(
  appSysId: string,
): Promise<InfraRelationshipsByType[]> {
  if (!appSysId) {
    return INFRA_REL_CONFIGS.map(config => ({
      ciType: config.ciType,
      config,
      rows: [],
      relTypesInUse: [config.relType],
    }));
  }

  const results = await Promise.all(
    INFRA_REL_CONFIGS.map(async config => {
      const { result = [] } = await queryTableWithAccess<Record<string, unknown>>({
        table: 'cmdb_rel_ci',
        query: buildRelQueryOrdered(appSysId, config),
        fields: relFields(config),
        limit: INFRA_PEER_LIMIT,
        displayValue: 'all',
      });

      const side = infraSidePrefix(config);
      const rows: InfraRelationshipRow[] = [];
      const relTypeSet = new Set<string>([config.relType]);

      for (const row of result) {
        const relType = str(row['type.name']) || config.relType;
        relTypeSet.add(relType);
        const ciSysId = raw(row[`${side}.sys_id`]);
        if (!ciSysId) continue;
        rows.push({
          relSysId: raw(row.sys_id),
          ciSysId,
          ciName: str(row[`${side}.name`]) || ciSysId,
          ciClass: raw(row[`${side}.sys_class_name`]) || config.baseClass,
          relType,
        });
      }

      rows.sort((a, b) => a.ciName.localeCompare(b.ciName));

      return {
        ciType: config.ciType,
        config,
        rows,
        relTypesInUse: [...relTypeSet],
      };
    }),
  );

  return results;
}

export async function addInfraRelationship(
  appSysId: string,
  config: RelatedCIConfig,
  infraCiSysId: string,
  relType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { parentSysId, childSysId } = resolveInfraParentChild(appSysId, infraCiSysId, config);
  return createCmdbRelCi({ parentSysId, childSysId, relTypeName: relType });
}

export async function removeInfraRelationship(
  relSysId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return deleteCmdbRelCi(relSysId);
}

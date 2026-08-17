import type { TableAccess } from '../../api/servicenow';
import { CHUNK_SIZE } from './appHomeLoader';
import {
  buildAppScopedCiQuery,
  EMPTY_CI_QUERY,
  type AppFilterSelection,
  type AppRelatedIdsByTab,
} from './ciSearchAppFilter';
import type { CISearchInventoryTab, CISearchTab } from './ciSearchTabs';
import { CI_INVENTORY_TABS } from './ciSearchTabs';
import { countDistinctHealthFromBranches } from './cmdbHealthResults';
import { prefixEncodedQuery, joinOrEncodedQueries, appendEncodedQuery } from './searchQuery';
import {
  CHANGE_TASK_CONFIG,
  countDistinctRelatedTasksFromBranches,
  INCIDENT_TASK_CONFIG,
  taskCiQuery,
  type RelatedTaskConfig,
} from './relatedTasks';

export type SummaryFlagType = 'incident' | 'change' | 'health';

export const TAB_CI_TABLE: Record<CISearchInventoryTab, string> = {
  servers: 'cmdb_ci_server',
  switches: 'cmdb_ci_netgear',
  databases: 'cmdb_ci_db_instance',
  network_links: 'cmdb_ci_network_link',
};

export interface CiSearchTabScope {
  tab: CISearchInventoryTab;
  table: string;
  snQuery: string;
  relatedIds: string[] | null;
  matchingCiCount: number;
}

export interface CiSearchSummaryContext {
  label: string;
  matchingCiCount: number;
  tabScopes: CiSearchTabScope[];
  appFilterActive: boolean;
  keyword: string;
  ciFilter: string;
  searchFields: string[];
  columnFilterPartByTab: Record<CISearchInventoryTab, string>;
}

export interface CiSearchSummaryCounts {
  incidents: number;
  changes: number;
  health: number;
  access: {
    incidents: TableAccess;
    changes: TableAccess;
    health: TableAccess;
  };
}

const TAB_LABELS: Record<CISearchInventoryTab, string> = {
  servers: 'Servers',
  switches: 'Network Gears',
  databases: 'Databases',
  network_links: 'Network Links',
};

function scopedQueryToCiItemPrefix(scopedQuery: string): string {
  if (!scopedQuery || scopedQuery === EMPTY_CI_QUERY) return '';
  return scopedQuery
    .split('^')
    .map(seg => (seg.startsWith('sys_idIN') ? `ci_item.${seg}` : prefixEncodedQuery(seg, 'ci_item')))
    .join('^');
}

function scopedQueryToCiPrefix(scopedQuery: string): string {
  if (!scopedQuery || scopedQuery === EMPTY_CI_QUERY) return '';
  return scopedQuery
    .split('^')
    .map(seg => (seg.startsWith('sys_idIN') ? `ci.${seg}` : prefixEncodedQuery(seg, 'ci')))
    .join('^');
}

function buildChunkedScopedPrefix(
  relatedIds: string[],
  keyword: string,
  ciFilter: string,
  searchFields: string[],
  columnFilterPart: string,
  toPrefix: (scopedQuery: string) => string,
): string {
  if (!relatedIds.length) return '';

  const parts: string[] = [];
  for (let i = 0; i < relatedIds.length; i += CHUNK_SIZE) {
    const chunk = relatedIds.slice(i, i + CHUNK_SIZE);
    const scoped = appendEncodedQuery(
      buildAppScopedCiQuery(chunk, keyword, ciFilter, searchFields),
      columnFilterPart,
    );
    const prefixed = toPrefix(scoped);
    if (prefixed) parts.push(prefixed);
  }

  if (!parts.length) return '';
  return joinOrEncodedQueries(parts);
}

export function buildTaskCiPrefixForTabScope(
  scope: CiSearchTabScope,
  context: CiSearchSummaryContext,
): string {
  const columnFilterPart = context.columnFilterPartByTab[scope.tab] ?? '';
  if (context.appFilterActive) {
    const ids = scope.relatedIds ?? [];
    return buildChunkedScopedPrefix(
      ids,
      context.keyword,
      context.ciFilter,
      context.searchFields,
      columnFilterPart,
      scopedQueryToCiItemPrefix,
    );
  }

  const classPart = `ci_item.sys_class_nameINSTANCEOF${scope.table}`;
  const filterPart = prefixEncodedQuery(scope.snQuery, 'ci_item');
  return [classPart, filterPart].filter(Boolean).join('^');
}

export function buildHealthPrefixForTabScope(
  scope: CiSearchTabScope,
  context: CiSearchSummaryContext,
): string {
  const columnFilterPart = context.columnFilterPartByTab[scope.tab] ?? '';
  if (context.appFilterActive) {
    const ids = scope.relatedIds ?? [];
    return buildChunkedScopedPrefix(
      ids,
      context.keyword,
      context.ciFilter,
      context.searchFields,
      columnFilterPart,
      scopedQueryToCiPrefix,
    );
  }

  const classPart = `ci.sys_class_nameINSTANCEOF${scope.table}`;
  const filterPart = prefixEncodedQuery(scope.snQuery, 'ci');
  return [classPart, filterPart].filter(Boolean).join('^');
}

function orJoinQueryParts(parts: string[]): string {
  return joinOrEncodedQueries(parts);
}

function buildTaskCiBranchesForScope(
  scope: CiSearchTabScope,
  context: CiSearchSummaryContext,
  config: RelatedTaskConfig,
): string[] {
  const columnFilterPart = context.columnFilterPartByTab[scope.tab] ?? '';
  if (context.appFilterActive) {
    const ids = scope.relatedIds ?? [];
    if (!ids.length) return [];
    const branches: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const scoped = appendEncodedQuery(
        buildAppScopedCiQuery(chunk, context.keyword, context.ciFilter, context.searchFields),
        columnFilterPart,
      );
      const prefixed = scopedQueryToCiItemPrefix(scoped);
      if (prefixed) branches.push(taskCiQuery(prefixed, config));
    }
    return branches;
  }

  const prefix = buildTaskCiPrefixForTabScope(scope, context);
  return prefix ? [taskCiQuery(prefix, config)] : [];
}

function buildHealthBranchesForScope(
  scope: CiSearchTabScope,
  context: CiSearchSummaryContext,
): string[] {
  const columnFilterPart = context.columnFilterPartByTab[scope.tab] ?? '';
  if (context.appFilterActive) {
    const ids = scope.relatedIds ?? [];
    if (!ids.length) return [];
    const branches: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const scoped = appendEncodedQuery(
        buildAppScopedCiQuery(chunk, context.keyword, context.ciFilter, context.searchFields),
        columnFilterPart,
      );
      const prefixed = scopedQueryToCiPrefix(scoped);
      if (prefixed) branches.push(`active=true^${prefixed}`);
    }
    return branches;
  }

  const prefix = buildHealthPrefixForTabScope(scope, context);
  return prefix ? [`active=true^${prefix}`] : [];
}

/** Independent encoded-query groups for sidebar list fetch (one per tab/chunk). */
export function buildSidebarQueryBranches(
  context: CiSearchSummaryContext,
  flagType: SummaryFlagType,
): string[] {
  const branches: string[] = [];

  for (const scope of context.tabScopes) {
    if (flagType === 'health') {
      branches.push(...buildHealthBranchesForScope(scope, context));
    } else {
      const config = flagType === 'incident' ? INCIDENT_TASK_CONFIG : CHANGE_TASK_CONFIG;
      branches.push(...buildTaskCiBranchesForScope(scope, context, config));
    }
  }

  return branches.filter(Boolean);
}

/** Full encoded query for sidebar list fetch (metric filters applied per OR branch). */
export function buildSidebarEncodedQuery(
  context: CiSearchSummaryContext,
  flagType: SummaryFlagType,
): string {
  return orJoinQueryParts(buildSidebarQueryBranches(context, flagType));
}

/** @deprecated Use buildSidebarEncodedQuery — kept for callers expecting CI-only prefix on single tab. */
export function buildSidebarQueryPrefix(
  context: CiSearchSummaryContext,
  flagType: SummaryFlagType,
): string {
  return buildSidebarEncodedQuery(context, flagType);
}

export function buildSummaryContext(
  activeTab: CISearchTab,
  applied: { keyword: string; appFilter: AppFilterSelection | null },
  snQueriesByTab: Record<CISearchInventoryTab, string>,
  columnFilterPartByTab: Record<CISearchInventoryTab, string>,
  appRelatedIdsByTab: AppRelatedIdsByTab | null,
  tabCounts: Record<CISearchInventoryTab, number>,
  allTotalCount: number,
  ciFilter: string,
  searchFields: string[],
): CiSearchSummaryContext {
  const appFilterActive = !!applied.appFilter;
  const tabs: CISearchInventoryTab[] = activeTab === 'all'
    ? CI_INVENTORY_TABS.map(t => t.tab)
    : [activeTab];

  const tabScopes: CiSearchTabScope[] = tabs.map(tab => ({
    tab,
    table: TAB_CI_TABLE[tab],
    snQuery: snQueriesByTab[tab],
    relatedIds: appFilterActive && appRelatedIdsByTab ? appRelatedIdsByTab[tab] : null,
    matchingCiCount: tabCounts[tab] ?? 0,
  }));

  const matchingCiCount = activeTab === 'all'
    ? allTotalCount
    : (tabCounts[activeTab] ?? 0);

  const label = activeTab === 'all'
    ? 'All matching CIs'
    : TAB_LABELS[activeTab];

  return {
    label,
    matchingCiCount,
    tabScopes,
    appFilterActive,
    keyword: applied.keyword,
    ciFilter,
    searchFields,
    columnFilterPartByTab,
  };
}

export async function fetchCiSearchSummaryCounts(
  context: CiSearchSummaryContext,
): Promise<CiSearchSummaryCounts> {
  if (!context.tabScopes.length || context.matchingCiCount === 0) {
    return {
      incidents: 0,
      changes: 0,
      health: 0,
      access: { incidents: 'ok', changes: 'ok', health: 'ok' },
    };
  }

  const incidentBranches = buildSidebarQueryBranches(context, 'incident');
  const changeBranches = buildSidebarQueryBranches(context, 'change');
  const healthBranches = buildSidebarQueryBranches(context, 'health');

  const [incidentRes, changeRes, healthRes] = await Promise.all([
    countDistinctRelatedTasksFromBranches(incidentBranches),
    countDistinctRelatedTasksFromBranches(changeBranches),
    countDistinctHealthFromBranches(healthBranches),
  ]);

  return {
    incidents: incidentRes.totalCount,
    changes: changeRes.totalCount,
    health: healthRes.totalCount,
    access: {
      incidents: incidentRes.access,
      changes: changeRes.access,
      health: healthRes.access,
    },
  };
}

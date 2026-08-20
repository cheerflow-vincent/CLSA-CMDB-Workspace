import type { FilterOptionDto } from '../../api/servicenow';

export type FilterOrderDirection = 'asc' | 'desc';

/** Shared ordering for choice (sys_choice) and reference table option sources. */
export interface FilterOptionsOrderBy {
  /** Choice default: sequence. Reference default: labelField. */
  orderByField?: string;
  /** asc (default) or desc */
  orderByDirection?: FilterOrderDirection;
}

export interface FilterChoiceOptionsSource extends FilterOptionsOrderBy {
  type: 'choice';
  element?: string;
  query?: string;
  allowedValues?: string[];
  fallback?: FilterOptionDto[];
}

export interface FilterReferenceOptionsSource extends FilterOptionsOrderBy {
  type: 'reference';
  table: string;
  labelField?: string;
  labelFallbackField?: string;
  valueField?: string;
  query?: string;
  limit?: number;
}

export interface FilterStaticOptionsSource {
  type: 'static';
  options: FilterOptionDto[];
}

export type FilterOptionsSource =
  | FilterChoiceOptionsSource
  | FilterReferenceOptionsSource
  | FilterStaticOptionsSource;

export interface ResolvedAppHomeFilter {
  field: string;
  label: string;
  order: number;
  defaultOpen: boolean;
  dotWalk: boolean;
  options: FilterOptionDto[];
  defaults: string[];
}

export interface AppHomeFilterConfigResponse {
  two_level: ResolvedAppHomeFilter[];
  three_level: ResolvedAppHomeFilter[];
}

export type SidebarFilterState = Record<string, string[]>;

export function filtersForHierarchy(
  config: AppHomeFilterConfigResponse | undefined,
  hierarchyMode: boolean,
): ResolvedAppHomeFilter[] {
  if (!config) return [];
  return hierarchyMode ? config.three_level : config.two_level;
}

export function emptySidebarFromFilters(filters: ResolvedAppHomeFilter[]): SidebarFilterState {
  const state: SidebarFilterState = {};
  for (const f of filters) state[f.field] = [];
  return state;
}

export function defaultsSidebarFromFilters(filters: ResolvedAppHomeFilter[]): SidebarFilterState {
  const state = emptySidebarFromFilters(filters);
  for (const f of filters) {
    if (f.defaults.length) state[f.field] = [...f.defaults];
  }
  return state;
}

export function sidebarFiltersEqual(a: SidebarFilterState, b: SidebarFilterState): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const norm = (arr: string[]) => [...arr].sort().join('\0');
  for (const key of keys) {
    if (norm(a[key] ?? []) !== norm(b[key] ?? [])) return false;
  }
  return true;
}

export interface LiveFilterCriteria {
  search: string;
  filters: SidebarFilterState;
}

export function mergeFilterCriteria(
  search: string,
  sidebar: SidebarFilterState,
): LiveFilterCriteria {
  return { search, filters: { ...sidebar } };
}

export function hasActiveLiveFilters(criteria: LiveFilterCriteria): boolean {
  if (criteria.search.trim()) return true;
  return Object.values(criteria.filters).some(values => values.length > 0);
}

/** Build cmdb_rel_ci instance-edge encoded query from resolved filter definitions. */
export function buildRelCiInstanceEdgeQuery(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
  twoLevel: boolean,
): string {
  const parts = [
    twoLevel
      ? 'type.name=Connects to::Connected by'
      : 'type.name=Contains::Contained by',
  ];

  const child = 'child.';
  const childRef = twoLevel ? 'child.ref_cmdb_ci_service.' : 'child.ref_cmdb_ci_service_auto.';
  if (twoLevel) parts.push(`${childRef}u_service_type=instance`);

  const q = criteria.search.trim();
  if (q) parts.push(`${child}nameLIKE${q}`);

  for (const def of filterDefs) {
    const values = criteria.filters[def.field] ?? [];
    if (!values.length) continue;
    const prefix = def.dotWalk ? childRef : child;
    parts.push(`${prefix}${def.field}IN${values.join(',')}`);
  }

  return parts.join('^');
}

/** Legacy direct instance table query (fallback path). */
export function buildInstanceFilterQuery(
  criteria: LiveFilterCriteria,
  filterDefs: ResolvedAppHomeFilter[],
  twoLevel: boolean,
): string {
  const parts: string[] = [];
  if (twoLevel) parts.push('u_service_type=instance');

  const q = criteria.search.trim();
  if (q) parts.push(`nameLIKE${q}`);

  for (const def of filterDefs) {
    const values = criteria.filters[def.field] ?? [];
    if (!values.length) continue;
    parts.push(`${def.field}IN${values.join(',')}`);
  }

  return parts.join('^');
}

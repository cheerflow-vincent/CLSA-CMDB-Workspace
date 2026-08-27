import axios from 'axios'

// Suppress the browser Basic Auth popup on any 401 response.
// ServiceNow omits WWW-Authenticate when this header is present.
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest'

declare global {
  interface Window {
    g_ck?: string;
    g_user?: { userID?: string; sys_id?: string; userName?: string; firstName?: string; lastName?: string };
    NOW?: { user?: { userID?: string; userId?: string; sys_id?: string; userName?: string; userToken?: string } };
  }
}

const APP_SCOPE = 'x_citi4_clsa_cmd_0'

function unwrapRestBody<T>(data: unknown): T {
  const d = data as { result?: T } & T
  if (d && typeof d === 'object' && 'result' in d && d.result !== undefined) {
    return d.result as T
  }
  return d as T
}

export interface FilterOptionDto {
  label: string
  value: string
}

export interface ResolvedAppHomeFilterDto {
  field: string
  label: string
  order: number
  defaultOpen: boolean
  dotWalk: boolean
  options: FilterOptionDto[]
  defaults: string[]
}

export interface AppHomeFilterConfigDto {
  two_level: ResolvedAppHomeFilterDto[]
  three_level: ResolvedAppHomeFilterDto[]
}

export interface PortalCurrentUserContext {
  sys_id?: string
  department: string
  company: string
}

export interface PortalMetadataResponse {
  hierarchy_mode: boolean
  properties: Record<string, string>
  filter_options: {
    environment: FilterOptionDto[]
    operational_status: FilterOptionDto[]
    u_tier: FilterOptionDto[]
  }
  business_units: FilterOptionDto[]
  departments: FilterOptionDto[]
  app_home_filter_config?: AppHomeFilterConfigDto
  current_user?: PortalCurrentUserContext
}

let _portalMetadataCache: PortalMetadataResponse | null = null
let _portalMetadataCacheTime = 0
let _portalMetadataInflight: Promise<PortalMetadataResponse> | null = null
const PORTAL_METADATA_TTL_MS = 5 * 60 * 1000

const EMPTY_PORTAL_METADATA: PortalMetadataResponse = {
  hierarchy_mode: true,
  properties: {},
  filter_options: { environment: [], operational_status: [], u_tier: [] },
  business_units: [],
  departments: [],
  app_home_filter_config: { two_level: [], three_level: [] },
  current_user: { sys_id: '', department: '', company: '' },
}

function isUsablePortalMetadata(payload: PortalMetadataResponse | null | undefined): payload is PortalMetadataResponse {
  if (!payload) return false
  if (payload.properties && Object.keys(payload.properties).length > 0) return true
  if (payload.current_user?.sys_id?.trim()) return true
  return Boolean(payload.business_units?.length || payload.departments?.length)
}

/** Server-brokered portal metadata (choices, properties, reference lists). */
export async function fetchPortalMetadata(force = false): Promise<PortalMetadataResponse> {
  const now = Date.now()
  if (!force && _portalMetadataCache && (now - _portalMetadataCacheTime) < PORTAL_METADATA_TTL_MS) {
    return _portalMetadataCache
  }
  if (!force && _portalMetadataInflight) {
    return _portalMetadataInflight
  }

  const load = (async (): Promise<PortalMetadataResponse> => {
    try {
      const r = await axios.get(`/api/${APP_SCOPE}/portal/metadata`)
      const payload = unwrapRestBody(unwrapRestBody(r.data)) as PortalMetadataResponse
      if (isUsablePortalMetadata(payload)) {
        _portalMetadataCache = payload
        _portalMetadataCacheTime = Date.now()
        return payload
      }
    } catch {
      // keep last good cache when a refresh fails
      if (_portalMetadataCache && isUsablePortalMetadata(_portalMetadataCache)) {
        return _portalMetadataCache
      }
    }
    _portalMetadataCache = EMPTY_PORTAL_METADATA
    _portalMetadataCacheTime = Date.now()
    return _portalMetadataCache
  })()

  _portalMetadataInflight = load
  try {
    return await load
  } finally {
    if (_portalMetadataInflight === load) {
      _portalMetadataInflight = null
    }
  }
}

export type ViewLayoutType = 'form' | 'list' | 'form_layout' | 'instance_card_form'

export interface ViewFieldDto {
  element: string
  label: string
}

export type ViewLayoutFormRowDto =
  | { kind: 'full'; field: ViewFieldDto }
  | { kind: 'columns'; left: ViewFieldDto[]; right: ViewFieldDto[] };

export interface ViewLayoutSectionDto {
  caption: string | null
  rows: ViewLayoutFormRowDto[]
}

export interface ViewLayoutResponse {
  fields?: ViewFieldDto[]
  sections?: ViewLayoutSectionDto[]
  resolved_table?: string
  resolved_view?: 'named' | 'default'
  resolved_layout?: 'personal' | 'shared' | 'default'
  list_sys_id?: string
}

/** Server-brokered form/list/form_layout field definitions. */
export async function fetchViewLayout(params: {
  table: string
  view_title?: string
  type: ViewLayoutType
  default_limit?: number
  parent_table?: string
}): Promise<ViewLayoutResponse> {
  try {
    const r = await axios.get(`/api/${APP_SCOPE}/portal/view_layout`, { params })
    return unwrapRestBody(unwrapRestBody(r.data)) as ViewLayoutResponse
  } catch {
    return {}
  }
}

export interface ListLayoutFieldOption {
  element: string
  label: string
  internal_type?: string
}

export interface ListLayoutResult {
  fields: ViewFieldDto[]
  resolved_layout: 'personal' | 'shared' | 'default'
  list_sys_id?: string
}

/** Dictionary fields available for list column personalization. */
export async function fetchListLayoutFields(
  table: string,
  viewTitle: string,
  q?: string,
): Promise<ListLayoutFieldOption[]> {
  try {
    const params: Record<string, string> = { table, view_title: viewTitle }
    if (q?.trim()) params.q = q.trim()
    const r = await axios.get(`/api/${APP_SCOPE}/portal/list_layout/fields`, { params })
    const body = unwrapRestBody(unwrapRestBody(r.data)) as { fields?: ListLayoutFieldOption[] }
    return body.fields ?? []
  } catch {
    return []
  }
}

// ServiceNow injects user details on window.g_user (not as an ES module global).
let cachedCurrentUserSysId: string | null = null

/** Resolve logged-in user sys_id from page globals or portal metadata. */
export async function getCurrentUserSysId(): Promise<string> {
  if (cachedCurrentUserSysId) return cachedCurrentUserSysId

  const fromWindow =
    window.NOW?.user?.userID
    || window.NOW?.user?.userId
    || window.NOW?.user?.sys_id
    || window.g_user?.userID
    || window.g_user?.sys_id
    || ''
  if (fromWindow) {
    cachedCurrentUserSysId = fromWindow
    return fromWindow
  }

  const meta = await fetchPortalMetadata()
  const fromMeta = meta.current_user?.sys_id?.trim()
  if (fromMeta) {
    cachedCurrentUserSysId = fromMeta
    return fromMeta
  }

  const userName = window.g_user?.userName || window.NOW?.user?.userName
  if (userName) {
    try {
      const { result = [] } = await queryTable<{ sys_id: unknown }>({
        table: 'sys_user',
        query: `user_name=${userName}`,
        fields: ['sys_id'],
        limit: 1,
      })
      const id = result[0] ? coerceSysId(result[0].sys_id) : ''
      if (id) {
        cachedCurrentUserSysId = id
        return id
      }
    } catch {
      // fall through
    }
  }

  return ''
}

/** Resolve user sys_id for list-layout writes (main bundle — uses configured axios). */
async function resolveUserSysIdForSave(): Promise<string> {
  const fromWindow =
    window.NOW?.user?.userID
    || window.NOW?.user?.userId
    || window.NOW?.user?.sys_id
    || window.g_user?.userID
    || window.g_user?.sys_id
    || ''
  if (fromWindow) {
    cachedCurrentUserSysId = fromWindow
    return fromWindow
  }

  const meta = await fetchPortalMetadata(true)
  const fromMeta = meta.current_user?.sys_id?.trim()
  if (fromMeta) {
    cachedCurrentUserSysId = fromMeta
    return fromMeta
  }

  return getCurrentUserSysId()
}

/** Save user-specific list layout columns via Table API (logged-in user context). */
export async function saveListLayout(
  table: string,
  viewTitle: string,
  columns: string[],
): Promise<{ ok: true; result: ListLayoutResult } | { ok: false; error: string }> {
  const userId = await resolveUserSysIdForSave()
  if (!userId) {
    return { ok: false, error: 'Unable to resolve current user' }
  }
  try {
    const result = await savePersonalListLayoutInternal(table, viewTitle, columns, userId)
    return {
      ok: true,
      result: {
        fields: result.fields ?? [],
        resolved_layout: result.resolved_layout ?? 'personal',
        list_sys_id: result.list_sys_id,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error && err.message.trim()
      ? err.message
      : 'Failed to save column layout'
    return { ok: false, error: message }
  }
}

/** Delete user personal list layout via Table API and revert to shared default. */
export async function resetListLayout(
  table: string,
  viewTitle: string,
): Promise<{ ok: true; result: ListLayoutResult } | { ok: false; error: string }> {
  const userId = await resolveUserSysIdForSave()
  if (!userId) {
    return { ok: false, error: 'Unable to resolve current user' }
  }
  try {
    const result = await resetPersonalListLayoutInternal(table, viewTitle, userId)
    return {
      ok: true,
      result: {
        fields: result.fields ?? [],
        resolved_layout: result.resolved_layout ?? 'shared',
        list_sys_id: result.list_sys_id,
      },
    }
  } catch (err: unknown) {
    const message = err instanceof Error && err.message.trim()
      ? err.message
      : 'Failed to reset column layout'
    return { ok: false, error: message }
  }
}

/**
 * Fetch the ServiceNow user token via angular.do.
 * This endpoint returns HTTP 401 with `X-UserToken-Response` header — using
 * X-Requested-With ensures `WWW-Authenticate: none` (no browser popup).
 * The token is then attached to every axios request as `X-UserToken`, which
 * is required by some instances for REST API authentication alongside the
 * session cookie.
 */
export async function initUserToken(): Promise<void> {
  // If g_ck is already injected by the page (some SN versions), use it directly
  const injected = window.g_ck ?? window.NOW?.user?.userToken ?? ''
  if (injected) {
    axios.defaults.headers.common['X-UserToken'] = injected
    return
  }
  // angular.do always returns 401 for get_user; the token is in the response
  // headers. Since fetch doesn't expose non-CORS headers on 401, we use
  // XMLHttpRequest which does expose them for same-origin requests.
  await new Promise<void>((resolve) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/angular.do?sysparm_type=get_user')
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
    xhr.withCredentials = true
    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        const token = xhr.getResponseHeader('X-UserToken-Response')
        if (token) {
          axios.defaults.headers.common['X-UserToken'] = token
        }
        resolve()
      }
    }
    xhr.send()
  })
}

export function bootstrapAuth(): { username: string } {
  try {
    const name =
      window.g_user?.userName ||
      window.NOW?.user?.userName ||
      'user'
    return { username: String(name) }
  } catch {
    return { username: 'user' }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Table API helpers
// ──────────────────────────────────────────────────────────────────────────────
interface TableQueryParams {
  table: string
  query?: string
  fields?: string[]
  limit?: number
  offset?: number
  orderBy?: string
  /** false (default) = raw values; true = display values; 'all' = both as {value,display_value} objects */
  displayValue?: boolean | 'all'
}

export type TableAccess = 'ok' | 'denied' | 'error'

export interface TableQueryResult<T> {
  result: T[]
  totalCount: number
  access: TableAccess
}

function isAxiosForbidden(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('response' in err)) return false
  const status = (err as { response?: { status?: number } }).response?.status
  return status === 403
}

async function executeTableQuery<T>(params: TableQueryParams): Promise<TableQueryResult<T>> {
  const {
    table,
    query = '',
    fields = [],
    limit = 50,
    offset = 0,
    orderBy = '',
    displayValue = false,
  } = params

  const reqParams: Record<string, string | number> = {
    sysparm_limit: limit,
    sysparm_offset: offset,
  }
  if (query) reqParams.sysparm_query = query
  if (fields.length) reqParams.sysparm_fields = fields.join(',')
  if (orderBy) reqParams.sysparm_orderby = orderBy
  if (displayValue === 'all') reqParams.sysparm_display_value = 'all'
  else if (displayValue) reqParams.sysparm_display_value = 'true'

  try {
    const r = await axios.get(`/api/now/table/${table}`, { params: reqParams })
    const totalCount = parseInt(r.headers['x-total-count'] ?? '0', 10)
    return { result: r.data.result ?? [], totalCount, access: 'ok' }
  } catch (err) {
    if (isAxiosForbidden(err)) {
      return { result: [], totalCount: 0, access: 'denied' }
    }
    return { result: [], totalCount: 0, access: 'error' }
  }
}

/** Table API query — throws on non-403 errors (legacy callers). */
export async function queryTable<T>(params: TableQueryParams): Promise<{ result: T[]; totalCount: number }> {
  const { result, totalCount, access } = await executeTableQuery<T>(params)
  if (access === 'error') {
    throw new Error(`Table API query failed for ${params.table}`)
  }
  return { result, totalCount }
}

/** Table API query with explicit ACL access state (403 → access: denied). */
export async function queryTableWithAccess<T>(params: TableQueryParams): Promise<TableQueryResult<T>> {
  return executeTableQuery<T>(params)
}

interface StatsQueryParams {
  table: string
  query?: string
}

function parseStatsCount(data: unknown): number {
  const d = data as { result?: { stats?: { count?: string | number } } | unknown[] }
  if (d?.result && typeof d.result === 'object' && !Array.isArray(d.result)) {
    const count = (d.result as { stats?: { count?: string | number } }).stats?.count
    if (count != null) return parseInt(String(count), 10) || 0
  }
  if (Array.isArray(d?.result)) return d.result.length
  return 0
}

/** Row count via Stats API — no record fetch. */
export async function queryStatsCount(
  params: StatsQueryParams,
): Promise<{ totalCount: number; access: TableAccess }> {
  const reqParams: Record<string, string> = { sysparm_count: 'true' }
  if (params.query) reqParams.sysparm_query = params.query

  try {
    const r = await axios.get(`/api/now/stats/${params.table}`, { params: reqParams })
    const headerCount = parseInt(r.headers['x-total-count'] ?? '', 10)
    const totalCount = Number.isFinite(headerCount) && headerCount > 0
      ? headerCount
      : parseStatsCount(r.data)
    return { totalCount, access: 'ok' }
  } catch (err) {
    if (isAxiosForbidden(err)) {
      return { totalCount: 0, access: 'denied' }
    }
    return { totalCount: 0, access: 'error' }
  }
}

function parseStatsGroupPage(data: unknown): number {
  const d = data as { result?: unknown[] }
  if (Array.isArray(d?.result)) return d.result.length
  return 0
}

const STATS_GROUP_PAGE_SIZE = 1000

/** Distinct group count via Stats API (sysparm_group_by). */
export async function queryStatsGroupCount(
  params: StatsQueryParams & { groupBy: string },
): Promise<{ totalCount: number; access: TableAccess }> {
  try {
    let offset = 0
    let totalGroups = 0

    while (true) {
      const reqParams: Record<string, string | number> = {
        sysparm_count: 'true',
        sysparm_group_by: params.groupBy,
        sysparm_limit: STATS_GROUP_PAGE_SIZE,
        sysparm_offset: offset,
      }
      if (params.query) reqParams.sysparm_query = params.query

      const r = await axios.get(`/api/now/stats/${params.table}`, { params: reqParams })
      const pageCount = parseStatsGroupPage(r.data)
      totalGroups += pageCount
      if (pageCount < STATS_GROUP_PAGE_SIZE) break
      offset += STATS_GROUP_PAGE_SIZE
    }

    return { totalCount: totalGroups, access: 'ok' }
  } catch (err) {
    if (isAxiosForbidden(err)) {
      return { totalCount: 0, access: 'denied' }
    }
    return { totalCount: 0, access: 'error' }
  }
}

export interface CiSearchDistinctCountRequest {
  incident_query: string
  change_query: string
}

export interface CiSearchDistinctCountResponse {
  incidents: number
  changes: number
  access: {
    incidents: TableAccess
    changes: TableAccess
  }
}

const EMPTY_CI_SEARCH_DISTINCT_COUNTS: CiSearchDistinctCountResponse = {
  incidents: 0,
  changes: 0,
  access: { incidents: 'denied', changes: 'denied' },
}

/** Distinct task counts via Scripted REST (GlideAggregate COUNT(DISTINCT)). */
export async function fetchCiSearchDistinctCounts(
  body: CiSearchDistinctCountRequest,
): Promise<CiSearchDistinctCountResponse> {
  try {
    const r = await axios.post(`/api/${APP_SCOPE}/portal/ci_search_distinct_count`, body)
    const result = unwrapRestBody(unwrapRestBody(r.data)) as Record<string, unknown>
    if (!result || typeof result !== 'object') return EMPTY_CI_SEARCH_DISTINCT_COUNTS

    const accessRaw = result.access as Record<string, unknown> | undefined
    const toAccess = (v: unknown): TableAccess =>
      v === 'denied' ? 'denied' : v === 'error' ? 'error' : 'ok'

    return {
      incidents: Number(result.incidents) || 0,
      changes: Number(result.changes) || 0,
      access: {
        incidents: toAccess(accessRaw?.incidents),
        changes: toAccess(accessRaw?.changes),
      },
    }
  } catch (err) {
    if (isAxiosForbidden(err)) return EMPTY_CI_SEARCH_DISTINCT_COUNTS
    return {
      incidents: 0,
      changes: 0,
      access: { incidents: 'error', changes: 'error' },
    }
  }
}

export interface CiTaskFlagCountsRequest {
  ci_sys_ids: string[]
}

export interface CiTaskFlagCountsBatchResponse {
  counts: Record<string, { incidents: number; changes: number }>
  access: { incidents: TableAccess; changes: TableAccess }
}

const EMPTY_CI_TASK_FLAG_COUNTS_BATCH: CiTaskFlagCountsBatchResponse = {
  counts: {},
  access: { incidents: 'denied', changes: 'denied' },
}

/** Per-CI distinct task counts via Scripted REST (GlideAggregate COUNT(DISTINCT) by ci_item). */
export async function fetchCiTaskFlagCountsBatch(
  ciSysIds: string[],
): Promise<CiTaskFlagCountsBatchResponse> {
  if (!ciSysIds.length) {
    return { counts: {}, access: { incidents: 'ok', changes: 'ok' } }
  }

  try {
    const r = await axios.post(`/api/${APP_SCOPE}/portal/ci_task_flag_counts`, {
      ci_sys_ids: ciSysIds,
    })
    const result = unwrapRestBody(unwrapRestBody(r.data)) as Record<string, unknown>
    if (!result || typeof result !== 'object') return EMPTY_CI_TASK_FLAG_COUNTS_BATCH

    const accessRaw = result.access as Record<string, unknown> | undefined
    const toAccess = (v: unknown): TableAccess =>
      v === 'denied' ? 'denied' : v === 'error' ? 'error' : 'ok'

    const countsRaw = result.counts as Record<string, unknown> | undefined
    const counts: Record<string, { incidents: number; changes: number }> = {}
    if (countsRaw && typeof countsRaw === 'object') {
      for (const [id, entry] of Object.entries(countsRaw)) {
        const row = entry as Record<string, unknown>
        counts[id] = {
          incidents: Number(row?.incidents) || 0,
          changes: Number(row?.changes) || 0,
        }
      }
    }

    return {
      counts,
      access: {
        incidents: toAccess(accessRaw?.incidents),
        changes: toAccess(accessRaw?.changes),
      },
    }
  } catch (err) {
    if (isAxiosForbidden(err)) return EMPTY_CI_TASK_FLAG_COUNTS_BATCH
    return {
      counts: {},
      access: { incidents: 'error', changes: 'error' },
    }
  }
}

export interface CiSearchDistinctTasksRequest {
  query: string
  task_table: string
  fields: string[]
  page: number
  page_size: number
}

export interface CiSearchSidebarRow {
  sys_id: string
  values: Record<string, string>
}

export interface CiSearchSidebarPageResponse {
  rows: CiSearchSidebarRow[]
  totalCount: number
  access: TableAccess
}

const EMPTY_CI_SEARCH_SIDEBAR_PAGE: CiSearchSidebarPageResponse = {
  rows: [],
  totalCount: 0,
  access: 'denied',
}

function parseSidebarPageResponse(result: Record<string, unknown>): CiSearchSidebarPageResponse {
  const accessRaw = result.access
  const toAccess = (v: unknown): TableAccess =>
    v === 'denied' ? 'denied' : v === 'error' ? 'error' : 'ok'

  const access = typeof accessRaw === 'string' ? toAccess(accessRaw) : 'ok'
  const rowsRaw = Array.isArray(result.rows) ? result.rows : []
  const rows: CiSearchSidebarRow[] = rowsRaw.map(entry => {
    const row = entry as Record<string, unknown>
    const valuesRaw = row.values as Record<string, unknown> | undefined
    const values: Record<string, string> = {}
    if (valuesRaw && typeof valuesRaw === 'object') {
      for (const [key, val] of Object.entries(valuesRaw)) {
        values[key] = val != null ? String(val) : ''
      }
    }
    return {
      sys_id: String(row.sys_id ?? ''),
      values,
    }
  }).filter(r => r.sys_id)

  return {
    rows,
    totalCount: Number(result.totalCount) || 0,
    access,
  }
}

/** Distinct task page for CI Search summary sidebar. */
export async function fetchCiSearchDistinctTasksPage(
  body: CiSearchDistinctTasksRequest,
): Promise<CiSearchSidebarPageResponse> {
  if (!body.query) {
    return { rows: [], totalCount: 0, access: 'ok' }
  }

  try {
    const r = await axios.post(`/api/${APP_SCOPE}/portal/ci_search_distinct_tasks`, body)
    const result = unwrapRestBody(unwrapRestBody(r.data)) as Record<string, unknown>
    if (!result || typeof result !== 'object') return EMPTY_CI_SEARCH_SIDEBAR_PAGE
    return parseSidebarPageResponse(result)
  } catch (err) {
    if (isAxiosForbidden(err)) return EMPTY_CI_SEARCH_SIDEBAR_PAGE
    return { rows: [], totalCount: 0, access: 'error' }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// System property helpers
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Batch-fetch multiple system properties by name in a single API call.
 * Returns a map of { propertyName → value }. Any missing properties are
 * omitted from the returned map (callers should supply defaults).
 */
export async function getSysProperties(names: string[]): Promise<Record<string, string>> {
  if (!names.length) return {}
  const meta = await fetchPortalMetadata()
  const out: Record<string, string> = {}
  for (const name of names) {
    if (meta.properties[name] !== undefined) out[name] = meta.properties[name]
  }
  return out
}

const DEFAULT_CI_FILTER = 'install_status!=7'
let _cachedCIFilter: string | null = null
let _cachedCIFilterTime = 0
const CI_FILTER_TTL_MS = 5 * 60 * 1000

/**
 * Convenience wrapper — returns the `<scope>.ci.filter` property value.
 * Cached for up to 5 minutes.
 */
export async function getCIFilter(): Promise<string> {
  const now = Date.now()
  if (_cachedCIFilter !== null && (now - _cachedCIFilterTime) < CI_FILTER_TTL_MS) {
    return _cachedCIFilter
  }
  try {
    const props = await getSysProperties([`${APP_SCOPE}.ci.filter`])
    _cachedCIFilter = props[`${APP_SCOPE}.ci.filter`] ?? DEFAULT_CI_FILTER
  } catch {
    _cachedCIFilter = DEFAULT_CI_FILTER
  }
  _cachedCIFilterTime = now
  return _cachedCIFilter
}

export { APP_SCOPE }

// ──────────────────────────────────────────────────────────────────────────────
// Scripted REST — field access probe
// ──────────────────────────────────────────────────────────────────────────────

export interface FieldAccessChoice {
  value: string
  label: string
}

export interface FieldAccessEntry {
  read: boolean
  write: boolean
  internal_type: string
  reference?: string
  max_length?: number
  mandatory?: boolean
  choices?: FieldAccessChoice[]
}

export interface FieldAccessResponse {
  canWriteRecord: boolean
  fields: Record<string, FieldAccessEntry>
}

const FIELD_ACCESS_BATCH_SIZE = 35

export async function fetchFieldAccess(
  table: string,
  sysId: string,
  fields: string[],
): Promise<FieldAccessResponse> {
  const fallback: FieldAccessResponse = { canWriteRecord: false, fields: {} }
  if (!table || !sysId || !fields.length) return fallback

  const mergedFields: Record<string, FieldAccessEntry> = {}
  let canWriteRecord = false

  try {
    for (let i = 0; i < fields.length; i += FIELD_ACCESS_BATCH_SIZE) {
      const batch = fields.slice(i, i + FIELD_ACCESS_BATCH_SIZE)
      const r = await axios.get(`/api/${APP_SCOPE}/portal/field_access`, {
        params: { table, sys_id: sysId, fields: batch.join(',') },
      })
      const body = r.data?.result ?? r.data
      if (body?.canWriteRecord === true) canWriteRecord = true
      Object.assign(mergedFields, body?.fields ?? {})
    }
    return { canWriteRecord, fields: mergedFields }
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'response' in err) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 403 || status === 404) return fallback
    }
    return fallback
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Scripted REST — application home filter + paging
// ──────────────────────────────────────────────────────────────────────────────

export type ApplicationHomeHierarchyMode = 'two_level' | 'three_level'

export interface ApplicationHomeRequest {
  search?: string
  /** Field-keyed filter values, e.g. { operational_status: ["1"] } */
  filters?: Record<string, string[]>
  /** @deprecated legacy keys — used when filters is omitted */
  env?: string[]
  status?: string[]
  dept?: string[]
  biz_unit?: string[]
  tier?: string[]
  hierarchy_mode: ApplicationHomeHierarchyMode
  page?: number
  page_size?: number
  filter_token?: string | null
}

export interface ApplicationHomeFamilyMeta {
  sys_id: string
  name: string
  short_description: string
}

export interface TwoLevelMappingDto {
  app_family_meta: Record<string, { name: string; short_description: string }>
  app_to_instances: Record<string, string[]>
  instance_svc_ids: string[]
}

export interface ThreeLevelMappingDto {
  b_apps: ApplicationHomeFamilyMeta[]
  svc_map: Record<string, { name: string; short_description: string }>
  b_app_to_svcs: Record<string, string[]>
  svc_to_inst_ids: Record<string, string[]>
  instance_ids: string[]
}

export interface ApplicationHomeResponse {
  access: TableAccess
  hierarchy_mode: ApplicationHomeHierarchyMode
  page: number
  page_size: number
  total_families: number
  filter_token: string | null
  instance_ids: string[]
  mapping: TwoLevelMappingDto | ThreeLevelMappingDto | null
  truncated?: boolean
}

const EMPTY_APPLICATION_HOME: ApplicationHomeResponse = {
  access: 'denied',
  hierarchy_mode: 'three_level',
  page: 0,
  page_size: 50,
  total_families: 0,
  filter_token: null,
  instance_ids: [],
  mapping: null,
}

export async function fetchApplicationHomePage(
  body: ApplicationHomeRequest,
): Promise<ApplicationHomeResponse> {
  try {
    const r = await axios.post(`/api/${APP_SCOPE}/portal/application_home`, body)
    // Scripted REST wraps { result: handlerBody }; SN API wraps again → result.result.
    const result = unwrapRestBody(unwrapRestBody(r.data)) as Record<string, unknown>
    if (!result || typeof result !== 'object') return EMPTY_APPLICATION_HOME
    return {
      access: result.access === 'denied' ? 'denied' : result.access === 'error' ? 'error' : 'ok',
      hierarchy_mode: result.hierarchy_mode === 'two_level' ? 'two_level' : 'three_level',
      page: Number(result.page) || 0,
      page_size: Number(result.page_size) || 50,
      total_families: Number(result.total_families) || 0,
      filter_token: (result.filter_token as string | null) ?? null,
      instance_ids: Array.isArray(result.instance_ids) ? result.instance_ids as string[] : [],
      mapping: (result.mapping as ApplicationHomeResponse['mapping']) ?? null,
      truncated: Boolean(result.truncated),
    }
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'response' in err) {
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 403 || status === 404) return EMPTY_APPLICATION_HOME
    }
    return { ...EMPTY_APPLICATION_HOME, access: 'error' }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Table API — record update
// ──────────────────────────────────────────────────────────────────────────────

export interface UpdateRecordResult {
  success: boolean
  denied?: boolean
  error?: string
}

function extractAxiosErrorMessage(err: unknown): string {
  if (typeof err !== 'object' || err === null || !('response' in err)) {
    return 'Save failed. Please try again.'
  }
  const data = (err as { response?: { data?: { error?: { message?: string }; result?: unknown } } }).response?.data
  const msg = data?.error?.message
  if (typeof msg === 'string' && msg.trim()) return msg
  return 'Save failed. Please try again.'
}

export async function updateRecord(
  table: string,
  sysId: string,
  payload: Record<string, unknown>,
): Promise<UpdateRecordResult> {
  if (!Object.keys(payload).length) return { success: true }
  try {
    await axios.patch(`/api/now/table/${table}/${sysId}`, payload)
    return { success: true }
  } catch (err) {
    if (isAxiosForbidden(err)) {
      return { success: false, denied: true, error: 'You do not have permission to save these changes.' }
    }
    return { success: false, error: extractAxiosErrorMessage(err) }
  }
}

function extractListLayoutApiError(err: unknown, fallback: string): string {
  if (typeof err !== 'object' || err === null || !('response' in err)) return fallback
  const data = (err as { response?: { data?: { error?: { message?: string; detail?: string } } } }).response?.data
  const msg = data?.error?.message?.trim()
  const detail = data?.error?.detail?.trim()
  if (msg && detail && detail !== msg) return `${msg}: ${detail}`
  if (msg) return msg
  if (detail) return detail
  return fallback
}

async function postTableRecord(table: string, payload: Record<string, unknown>): Promise<string> {
  const r = await axios.post(`/api/now/table/${table}`, payload)
  return coerceSysId((r.data as { result?: { sys_id?: unknown } })?.result?.sys_id)
}

async function deleteTableRecord(table: string, sysId: string): Promise<void> {
  await axios.delete(`/api/now/table/${table}/${sysId}`)
}

const LIST_LAYOUT_MAX_COLUMNS = 30

async function findListLayoutSysId(listQuery: string): Promise<string | null> {
  const { result = [] } = await queryTable<{ sys_id: unknown }>({
    table: 'sys_ui_list',
    query: listQuery,
    fields: ['sys_id'],
    limit: 1,
  })
  const id = result[0] ? coerceSysId(result[0].sys_id) : ''
  return id || null
}

async function findListLayoutViewSysId(viewTitle: string): Promise<string | null> {
  const { result = [] } = await queryTable<{ sys_id: unknown }>({
    table: 'sys_ui_view',
    query: `title=${viewTitle}`,
    fields: ['sys_id'],
    limit: 1,
  })
  const id = result[0] ? coerceSysId(result[0].sys_id) : ''
  return id || null
}

async function findSharedListLayoutViewId(tableName: string, viewTitle: string): Promise<string | null> {
  let listId = await findListLayoutSysId(
    `name=${tableName}^view.title=${viewTitle}^sys_userISEMPTY^active=true`,
  )
  if (!listId) {
    listId = await findListLayoutSysId(`name=${tableName}^view.title=${viewTitle}^sys_userISEMPTY`)
  }
  if (!listId) return null

  const { result = [] } = await queryTable<{ view: unknown }>({
    table: 'sys_ui_list',
    query: `sys_id=${listId}`,
    fields: ['view'],
    limit: 1,
  })
  const viewId = result[0] ? coerceSysId(result[0].view) : ''
  return viewId || null
}

async function readListLayoutElementNames(listId: string): Promise<string[]> {
  const { result = [] } = await queryTable<{ element: unknown }>({
    table: 'sys_ui_list_element',
    query: `list_id=${listId}^ORDERBYposition`,
    fields: ['element', 'position'],
    limit: LIST_LAYOUT_MAX_COLUMNS + 10,
  })
  return result.map(row => coerceSysId(row.element)).filter(Boolean)
}

async function deleteListLayoutElements(listId: string): Promise<void> {
  const { result = [] } = await queryTable<{ sys_id: unknown }>({
    table: 'sys_ui_list_element',
    query: `list_id=${listId}`,
    fields: ['sys_id'],
    limit: LIST_LAYOUT_MAX_COLUMNS + 10,
  })
  await Promise.all(
    result.map(row => deleteTableRecord('sys_ui_list_element', coerceSysId(row.sys_id))),
  )
}

async function insertListLayoutElements(listId: string, columnNames: string[]): Promise<void> {
  for (let i = 0; i < columnNames.length; i++) {
    await postTableRecord('sys_ui_list_element', {
      list_id: listId,
      element: columnNames[i],
      position: (i + 1) * 10,
    })
  }
}

async function createPersonalListLayoutRecord(
  tableName: string,
  viewTitle: string,
  userId: string,
): Promise<string> {
  let viewId = await findSharedListLayoutViewId(tableName, viewTitle)
  if (!viewId) viewId = await findListLayoutViewSysId(viewTitle)
  if (!viewId) throw new Error(`View not found: ${viewTitle}`)

  const listId = await postTableRecord('sys_ui_list', {
    name: tableName,
    view: viewId,
    sys_user: userId,
    sys_name: tableName,
    active: true,
  })
  if (!listId) throw new Error('Failed to create personal list layout')
  return listId
}

async function reloadListLayoutResult(tableName: string, viewTitle: string): Promise<ListLayoutResult> {
  const { loadListFieldsWithMeta } = await import('../app/utils/viewFields')
  const meta = await loadListFieldsWithMeta(tableName, viewTitle, [])
  return {
    fields: meta.fields,
    resolved_layout: meta.resolvedLayout,
    list_sys_id: meta.listSysId,
  }
}

function validateListLayoutColumns(columnNames: string[]): string | null {
  if (!columnNames.length) return 'columns must be a non-empty array'
  if (columnNames.length > LIST_LAYOUT_MAX_COLUMNS) return 'Too many columns (max 30)'
  if (!columnNames.includes('name')) return 'columns must include name'
  return null
}

async function savePersonalListLayoutInternal(
  tableName: string,
  viewTitle: string,
  columnNames: string[],
  userId: string,
): Promise<ListLayoutResult> {
  const validationError = validateListLayoutColumns(columnNames)
  if (validationError) throw new Error(validationError)

  let listId = await findListLayoutSysId(`name=${tableName}^view.title=${viewTitle}^sys_user=${userId}`)
  if (!listId) listId = await createPersonalListLayoutRecord(tableName, viewTitle, userId)

  const backup = await readListLayoutElementNames(listId)
  await deleteListLayoutElements(listId)

  try {
    await insertListLayoutElements(listId, columnNames)
  } catch (err) {
    await deleteListLayoutElements(listId)
    if (backup.length) {
      try {
        await insertListLayoutElements(listId, backup)
      } catch {
        // best-effort rollback
      }
    }
    throw new Error(extractListLayoutApiError(err, 'Failed to save list columns'))
  }

  return reloadListLayoutResult(tableName, viewTitle)
}

async function resetPersonalListLayoutInternal(
  tableName: string,
  viewTitle: string,
  userId: string,
): Promise<ListLayoutResult> {
  const listId = await findListLayoutSysId(`name=${tableName}^view.title=${viewTitle}^sys_user=${userId}`)
  if (listId) {
    await deleteTableRecord('sys_ui_list', listId)
  }
  return reloadListLayoutResult(tableName, viewTitle)
}

// ──────────────────────────────────────────────────────────────────────────────
// Reference / list lookup (autocomplete)
// ──────────────────────────────────────────────────────────────────────────────

export interface ReferenceOption {
  sys_id: string
  display: string
}

const tableLabelCache = new Map<string, string>()
const displayFieldCache = new Map<string, string>()

function coerceDisplay(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.display_value != null) return String(o.display_value)
    if (o.value != null) return String(o.value)
  }
  return String(v)
}

function coerceSysId(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (o.value != null) return String(o.value)
  }
  return String(v)
}

/** Human-readable label derived from a CMDB table name (strips cmdb_ci_ prefix, title-cases words). */
export function formatCmdbTableLabel(tableName: string): string {
  return tableName
    .replace(/^cmdb_ci_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

function formatTableNameFallback(tableName: string): string {
  return formatCmdbTableLabel(tableName)
}

/** Human-readable label for a table (sys_db_object.label). */
export async function getTableLabel(tableName: string): Promise<string> {
  if (!tableName) return ''
  const cached = tableLabelCache.get(tableName)
  if (cached) return cached

  try {
    const { result } = await queryTable<{ label: unknown }>({
      table: 'sys_db_object',
      query: `name=${tableName}`,
      fields: ['label'],
      limit: 1,
    })
    const label = result[0] ? coerceDisplay(result[0].label).trim() : ''
    const resolved = label || formatCmdbTableLabel(tableName)
    tableLabelCache.set(tableName, resolved)
    return resolved
  } catch {
    return formatCmdbTableLabel(tableName)
  }
}

/** Display column for a referenced table (sys_dictionary.display=true). */
export async function getReferenceDisplayField(tableName: string): Promise<string> {
  if (!tableName) return 'name'
  const cached = displayFieldCache.get(tableName)
  if (cached) return cached

  try {
    const { result } = await queryTable<{ element: unknown }>({
      table: 'sys_dictionary',
      query: `name=${tableName}^display=true^internal_type!=collection^ORDERBYcolumn_link`,
      fields: ['element'],
      limit: 1,
    })
    const element = result[0] ? coerceDisplay(result[0].element).trim() : ''
    const resolved = element || 'name'
    displayFieldCache.set(tableName, resolved)
    return resolved
  } catch {
    return 'name'
  }
}

async function queryReferenceRows(
  table: string,
  query: string,
  displayField: string,
  limit: number,
): Promise<ReferenceOption[]> {
  const { result } = await queryTable<Record<string, unknown>>({
    table,
    query,
    fields: ['sys_id', displayField],
    displayValue: 'all',
    limit,
  })

  return (result ?? []).map(row => ({
    sys_id: coerceSysId(row.sys_id),
    display: coerceDisplay(row[displayField]) || coerceSysId(row.sys_id),
  })).filter(o => o.sys_id)
}

/** Append a fixed filter query before a search-specific query segment. */
function combineReferenceQuery(extraQuery: string, searchQuery: string): string {
  const extra = extraQuery.trim();
  const search = searchQuery.trim();
  if (!extra) return search;
  if (!search) return extra;
  return `${extra}^${search}`;
}

/** Search a referenced table by display name for autocomplete. */
export async function searchReferenceTable(
  table: string,
  searchText: string,
  limit = 15,
  extraQuery = '',
): Promise<ReferenceOption[]> {
  const q = searchText.trim()
  if (!table || q.length < 1) return []

  try {
    const displayField = await getReferenceDisplayField(table)
    const escaped = q.replace(/\^/g, '').replace(/=/g, '')

    let rows = await queryReferenceRows(
      table,
      combineReferenceQuery(extraQuery, `${displayField}LIKE${escaped}^ORDERBY${displayField}`),
      displayField,
      limit,
    )

    if (!rows.length && displayField !== 'name') {
      rows = await queryReferenceRows(
        table,
        combineReferenceQuery(extraQuery, `nameLIKE${escaped}^ORDERBYname`),
        'name',
        limit,
      )
    }

    if (!rows.length) {
      rows = await queryReferenceRows(
        table,
        combineReferenceQuery(extraQuery, `123TEXTQUERY321=${escaped}`),
        displayField,
        limit,
      )
    }

    return rows
  } catch {
    return []
  }
}

/** Resolve display labels for comma-separated sys_ids (glide_list). */
export async function resolveReferenceList(
  table: string,
  sysIds: string[],
): Promise<ReferenceOption[]> {
  const ids = sysIds.filter(Boolean)
  if (!table || !ids.length) return []

  try {
    const displayField = await getReferenceDisplayField(table)
    const { result } = await queryTable<Record<string, unknown>>({
      table,
      query: `sys_idIN${ids.join(',')}`,
      fields: ['sys_id', displayField],
      displayValue: 'all',
      limit: ids.length,
    })

    const byId = new Map(
      (result ?? []).map(row => [
        coerceSysId(row.sys_id),
        coerceDisplay(row[displayField]) || coerceSysId(row.sys_id),
      ]),
    )
    return ids.map(id => ({ sys_id: id, display: byId.get(id) || id }))
  } catch {
    return ids.map(id => ({ sys_id: id, display: id }))
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Scripted REST — relationship change
// ──────────────────────────────────────────────────────────────────────────────

export type RelationshipChangeAction = 'create' | 'delete';
export type RelationshipChangeState = 'pending_approval' | 'completed' | 'rejected' | 'cancelled';
export type RelationshipApprovalDecision = 'approve' | 'reject';

export interface RelationshipChangeRequest {
  sys_id: string;
  action: RelationshipChangeAction;
  state: RelationshipChangeState;
  /** Comma-separated cmdb_rel_ci sys_ids (list collector). */
  relationship_sys_id: string;
  relationship_sys_ids?: string[];
  rel_type: string;
  parent_ci_sys_id: string;
  child_ci_sys_id: string;
  source_ci_sys_id: string;
  target_ci_sys_id: string;
  source_ci_name: string;
  target_ci_name: string;
  direction: 'upstream' | 'downstream' | 'bidirectional';
  requested_by_sys_id: string;
  requested_by_name: string;
  requested_at: string;
  approver_sys_id: string;
  approver_name: string;
  approval_comments: string;
  completed_at: string;
}

export interface RelationshipChangeSummary {
  sys_id: string;
  action: RelationshipChangeAction;
  state: RelationshipChangeState;
  relationship_sys_id: string;
  rel_type: string;
  source_ci_sys_id: string;
  target_ci_sys_id: string;
  source_ci_name: string;
  target_ci_name: string;
  direction: string;
  requested_by_name: string;
  requested_at: string;
}

export interface RelationshipApprovalRecord {
  sys_id: string;
  document_id: string;
  state: string;
  approver_sys_id: string;
  approver_name: string;
  comments: string;
  due_date: string;
  sysapproval_sys_id: string;
  change?: RelationshipChangeSummary;
}

export interface RelationshipChangeListResponse {
  result: RelationshipChangeRequest[];
  total_count?: number;
  pending_count?: number;
}

export interface RelationshipApprovalListResponse {
  current_user_sys_id: string;
  result: RelationshipApprovalRecord[];
}

export async function fetchRelationshipChangesForApp(
  ciSysId: string,
  options?: { limit?: number; offset?: number },
): Promise<RelationshipChangeListResponse> {
  const empty: RelationshipChangeListResponse = { result: [] };
  if (!ciSysId) return empty;
  try {
    const params: Record<string, string | number> = { ci_sys_id: ciSysId };
    if (options?.limit != null) {
      params.limit = options.limit;
      params.offset = options.offset ?? 0;
    }
    const r = await axios.get(`/api/${APP_SCOPE}/portal/relationship_change`, { params });
    const body = r.data?.result ?? r.data;
    return {
      result: body?.result ?? [],
      total_count: body?.total_count,
      pending_count: body?.pending_count,
    };
  } catch {
    return empty;
  }
}

export async function fetchRelationshipApprovalsForApp(
  ciSysId: string,
): Promise<RelationshipApprovalListResponse> {
  const empty: RelationshipApprovalListResponse = { current_user_sys_id: '', result: [] };
  if (!ciSysId) return empty;
  try {
    const r = await axios.get(`/api/${APP_SCOPE}/portal/relationship_approval`, {
      params: { ci_sys_id: ciSysId },
    });
    const body = r.data?.result ?? r.data;
    return {
      current_user_sys_id: body?.current_user_sys_id ?? '',
      result: body?.result ?? [],
    };
  } catch {
    return empty;
  }
}

export async function fetchRelationshipApprovalInbox(): Promise<RelationshipApprovalListResponse> {
  const empty: RelationshipApprovalListResponse = { current_user_sys_id: '', result: [] };
  try {
    const r = await axios.get(`/api/${APP_SCOPE}/portal/relationship_approval`, {
      params: { inbox: 'approver' },
    });
    const body = r.data?.result ?? r.data;
    return {
      current_user_sys_id: body?.current_user_sys_id ?? '',
      result: body?.result ?? [],
    };
  } catch {
    return empty;
  }
}

export interface CreateRelationshipChangeBody {
  source_ci_sys_id: string;
  target_ci_sys_id: string;
  direction: 'upstream' | 'downstream' | 'bidirectional';
  rel_type: string;
}

export async function createRelationshipChange(
  body: CreateRelationshipChangeBody,
): Promise<{ ok: true; change: RelationshipChangeRequest } | { ok: false; error: string }> {
  try {
    const r = await axios.post(`/api/${APP_SCOPE}/portal/relationship_change`, {
      action: 'create',
      source_ci: body.source_ci_sys_id,
      target_ci: body.target_ci_sys_id,
      direction: body.direction,
      rel_type: body.rel_type,
    });
    const change = unwrapRestBody<{ result?: RelationshipChangeRequest } & RelationshipChangeRequest>(r.data);
    const row = (change as { result?: RelationshipChangeRequest }).result ?? change;
    return { ok: true, change: row as RelationshipChangeRequest };
  } catch (err) {
    return { ok: false, error: extractRelationshipChangeError(err) };
  }
}

export async function requestRelationshipDelete(body: {
  source_ci_sys_id: string;
  relationship_sys_id?: string;
  relationship_sys_ids?: string[];
  direction?: 'upstream' | 'downstream' | 'bidirectional';
}): Promise<{ ok: true; change: RelationshipChangeRequest } | { ok: false; error: string }> {
  try {
    const relationshipSysIds = body.relationship_sys_ids?.length
      ? body.relationship_sys_ids
      : body.relationship_sys_id
        ? [body.relationship_sys_id]
        : [];
    const r = await axios.post(`/api/${APP_SCOPE}/portal/relationship_change`, {
      action: 'delete',
      source_ci: body.source_ci_sys_id,
      relationship_sys_ids: relationshipSysIds.join(','),
      direction: body.direction,
    });
    const change = unwrapRestBody<{ result?: RelationshipChangeRequest } & RelationshipChangeRequest>(r.data);
    const row = (change as { result?: RelationshipChangeRequest }).result ?? change;
    return { ok: true, change: row as RelationshipChangeRequest };
  } catch (err) {
    return { ok: false, error: extractRelationshipChangeError(err) };
  }
}

function extractRelationshipChangeError(err: unknown): string {
  if (typeof err !== 'object' || err === null || !('response' in err)) {
    return 'Request failed. Please try again.';
  }
  const resp = (err as { response?: { status?: number; data?: unknown } }).response;
  const data = resp?.data;
  const status = resp?.status;

  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;

    if (typeof d.error === 'string' && d.error.trim()) return d.error;

    if (d.error && typeof d.error === 'object') {
      const nested = d.error as { message?: string; detail?: string };
      if (typeof nested.message === 'string' && nested.message.trim()) return nested.message;
      if (typeof nested.detail === 'string' && nested.detail.trim()) return nested.detail;
    }

    const result = d.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (typeof r.error === 'string' && r.error.trim()) return r.error;
      if (typeof r.message === 'string' && r.message.trim()) return r.message;
    }
    if (typeof result === 'string' && result.trim()) return result;
  }

  if (status === 404) return 'Relationship change API not found. Deploy the latest portal REST changes.';
  if (status === 403) return 'You do not have permission to perform this relationship change.';
  if (status === 401) return 'Session expired. Refresh the page and try again.';
  if (status) return `Request failed (HTTP ${status}). Please try again.`;
  return 'Request failed. Please try again.';
}

// ──────────────────────────────────────────────────────────────────────────────
// cmdb_rel_ci direct CRUD (infrastructure relationships)
// ──────────────────────────────────────────────────────────────────────────────

const _relTypeSysIdCache = new Map<string, string>();

export async function resolveRelTypeSysId(relTypeName: string): Promise<string | null> {
  const cached = _relTypeSysIdCache.get(relTypeName);
  if (cached) return cached;

  const { result } = await queryTableWithAccess<{ sys_id: string }>({
    table: 'cmdb_rel_type',
    query: `name=${relTypeName}`,
    fields: ['sys_id'],
    limit: 1,
  });
  const sysId = result?.[0]?.sys_id ?? null;
  if (sysId) _relTypeSysIdCache.set(relTypeName, sysId);
  return sysId;
}

export async function createCmdbRelCi(body: {
  parentSysId: string;
  childSysId: string;
  relTypeName: string;
}): Promise<{ ok: true; relSysId: string } | { ok: false; error: string }> {
  try {
    const typeSysId = await resolveRelTypeSysId(body.relTypeName);
    if (!typeSysId) {
      return { ok: false, error: `Relationship type "${body.relTypeName}" was not found.` };
    }

    const r = await axios.post('/api/now/table/cmdb_rel_ci', {
      parent: body.parentSysId,
      child: body.childSysId,
      type: typeSysId,
    });
    const row = r.data?.result as { sys_id?: string } | undefined;
    return { ok: true, relSysId: row?.sys_id ?? '' };
  } catch (err) {
    if (isAxiosForbidden(err)) {
      return { ok: false, error: 'You do not have permission to create this relationship.' };
    }
    const msg = extractTableApiError(err);
    return { ok: false, error: msg };
  }
}

export async function deleteCmdbRelCi(
  relSysId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!relSysId) return { ok: false, error: 'Missing relationship record.' };
  try {
    await axios.delete(`/api/now/table/cmdb_rel_ci/${relSysId}`);
    return { ok: true };
  } catch (err) {
    if (isAxiosForbidden(err)) {
      return { ok: false, error: 'You do not have permission to delete this relationship.' };
    }
    const msg = extractTableApiError(err);
    return { ok: false, error: msg };
  }
}

function extractTableApiError(err: unknown): string {
  if (typeof err !== 'object' || err === null || !('response' in err)) {
    return 'Request failed. Please try again.';
  }
  const resp = (err as { response?: { status?: number; data?: unknown } }).response;
  const data = resp?.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (typeof d.error === 'object' && d.error !== null) {
      const nested = d.error as { message?: string; detail?: string };
      if (typeof nested.message === 'string' && nested.message.trim()) return nested.message;
      if (typeof nested.detail === 'string' && nested.detail.trim()) return nested.detail;
    }
    if (typeof d.error === 'string' && d.error.trim()) return d.error;
  }
  if (resp?.status === 404) return 'Record not found.';
  if (resp?.status) return `Request failed (HTTP ${resp.status}). Please try again.`;
  return 'Request failed. Please try again.';
}

export async function decideRelationshipApproval(
  approvalSysId: string,
  decision: RelationshipApprovalDecision,
  comments?: string,
): Promise<{ ok: true; approval: RelationshipApprovalRecord } | { ok: false; error: string }> {
  try {
    const r = await axios.patch(`/api/${APP_SCOPE}/portal/relationship_approval/${approvalSysId}`, {
      decision,
      comments: comments ?? '',
    });
    const approval = unwrapRestBody<{ result?: RelationshipApprovalRecord } & RelationshipApprovalRecord>(r.data);
    const row = (approval as { result?: RelationshipApprovalRecord }).result ?? approval;
    return { ok: true, approval: row as RelationshipApprovalRecord };
  } catch (err) {
    return { ok: false, error: extractRelationshipChangeError(err) };
  }
}

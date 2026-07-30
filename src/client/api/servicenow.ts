import axios from 'axios'

// Suppress the browser Basic Auth popup on any 401 response.
// ServiceNow omits WWW-Authenticate when this header is present.
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest'

const APP_SCOPE = 'x_citi4_clsa_cmd_0'

// ServiceNow injects a global `g_user` object into every UI page containing
// the currently logged-in user's details. Read it directly — no HTTP call
// needed and no risk of triggering an auth challenge.
declare const g_user: { userName?: string; firstName?: string; lastName?: string } | undefined

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
  const injected = (window as any).g_ck ?? (window as any).NOW?.user?.userToken ?? ''
  if (injected) {
    axios.defaults.headers.common['X-UserToken'] = injected
    return
  }
  try {
    await fetch('/angular.do?sysparm_type=get_user', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })
  } catch {
    // ignore network errors
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
      (typeof g_user !== 'undefined' && g_user?.userName) ||
      // fallback: NOW global used by newer SN platform versions
      (typeof (window as any).NOW !== 'undefined' && (window as any).NOW?.user?.userName) ||
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
  const { result } = await queryTable<{ name: string; value: string }>({
    table: 'sys_properties',
    query: `nameIN${names.join(',')}`,
    fields: ['name', 'value'],
    limit: names.length,
  })
  return Object.fromEntries((result ?? []).map(r => [r.name, r.value]))
}

const DEFAULT_CI_FILTER = 'install_status!=7'
let _cachedCIFilter: string | null = null

/**
 * Convenience wrapper — returns the `<scope>.ci.filter` property value.
 * Cached for the lifetime of the page.
 */
export async function getCIFilter(): Promise<string> {
  if (_cachedCIFilter !== null) return _cachedCIFilter
  try {
    const props = await getSysProperties([`${APP_SCOPE}.ci.filter`])
    _cachedCIFilter = props[`${APP_SCOPE}.ci.filter`] ?? DEFAULT_CI_FILTER
  } catch {
    _cachedCIFilter = DEFAULT_CI_FILTER
  }
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
  choices?: FieldAccessChoice[]
}

export interface FieldAccessResponse {
  canWriteRecord: boolean
  fields: Record<string, FieldAccessEntry>
}

export async function fetchFieldAccess(
  table: string,
  sysId: string,
  fields: string[],
): Promise<FieldAccessResponse> {
  const fallback: FieldAccessResponse = { canWriteRecord: false, fields: {} }
  if (!table || !sysId || !fields.length) return fallback

  const BATCH_SIZE = 35
  const mergedFields: Record<string, FieldAccessEntry> = {}
  let canWriteRecord = false

  try {
    for (let i = 0; i < fields.length; i += BATCH_SIZE) {
      const batch = fields.slice(i, i + BATCH_SIZE)
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

function formatTableNameFallback(tableName: string): string {
  return tableName
    .replace(/^cmdb_ci_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
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
    const resolved = label || formatTableNameFallback(tableName)
    tableLabelCache.set(tableName, resolved)
    return resolved
  } catch {
    return formatTableNameFallback(tableName)
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

/** Search a referenced table by display name for autocomplete. */
export async function searchReferenceTable(
  table: string,
  searchText: string,
  limit = 15,
): Promise<ReferenceOption[]> {
  const q = searchText.trim()
  if (!table || q.length < 1) return []

  try {
    const displayField = await getReferenceDisplayField(table)
    const escaped = q.replace(/\^/g, '').replace(/=/g, '')

    let rows = await queryReferenceRows(
      table,
      `${displayField}LIKE${escaped}^ORDERBY${displayField}`,
      displayField,
      limit,
    )

    if (!rows.length && displayField !== 'name') {
      rows = await queryReferenceRows(
        table,
        `nameLIKE${escaped}^ORDERBYname`,
        'name',
        limit,
      )
    }

    if (!rows.length) {
      rows = await queryReferenceRows(
        table,
        `123TEXTQUERY321=${escaped}`,
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

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

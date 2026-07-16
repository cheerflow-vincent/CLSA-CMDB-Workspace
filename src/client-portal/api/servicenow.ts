import axios from 'axios'

// Suppress the browser Basic Auth popup on any 401 response.
// ServiceNow omits WWW-Authenticate when this header is present.
axios.defaults.headers.common['X-Requested-With'] = 'XMLHttpRequest'

const APP_SCOPE = 'x_citi4_clsa_cmd_0'

// ServiceNow injects a global `g_user` object into every UI page containing
// the currently logged-in user's details. Read it directly — no HTTP call
// needed and no risk of triggering an auth challenge.
declare const g_user: { userName?: string; firstName?: string; lastName?: string } | undefined

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
}

export async function queryTable<T>({
  table,
  query = '',
  fields = [],
  limit = 50,
  offset = 0,
  orderBy = '',
}: TableQueryParams): Promise<{ result: T[]; totalCount: number }> {
  const params: Record<string, string | number> = {
    sysparm_limit: limit,
    sysparm_offset: offset,
  }
  if (query) params.sysparm_query = query
  if (fields.length) params.sysparm_fields = fields.join(',')
  if (orderBy) params.sysparm_orderby = orderBy

  const r = await axios.get(`/api/now/table/${table}`, { params })
  const totalCount = parseInt(r.headers['x-total-count'] ?? '0', 10)
  return { result: r.data.result, totalCount }
}

export { APP_SCOPE }

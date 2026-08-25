/** True when the string looks like a standard ServiceNow CMDB base table name. */
export function isCmdbTableName(value: string | null | undefined): value is string {
  return !!value && /^cmdb_ci[\w]*$/.test(value);
}

/** True for any ServiceNow table name, including custom CI subclasses (e.g. u_cmdb_ci_mariadb). */
export function isRecordTableName(value: string | null | undefined): value is string {
  return !!value && /^\w+$/.test(value);
}

/** Prefer sys_class_name from the API; fall back to the navigation hint. */
export function resolveRecordTable(className: string, fallback: string): string {
  return isRecordTableName(className) ? className : fallback;
}

/** Read table + sys_id from the URL query string or history state (deep-link / refresh). */
export function readRecordUrlParams(): { table: string; sysId: string } | null {
  const p = new URLSearchParams(window.location.search);
  const table = p.get('table');
  const sysId = p.get('sys_id');
  if (table && sysId) return { table, sysId };

  const state = window.history.state as { table?: string; sysId?: string } | null;
  if (state?.table && state?.sysId) {
    return { table: state.table, sysId: state.sysId };
  }

  return null;
}

/** Stamp table + sys_id into the current history entry (keeps state on refresh). */
export function stampRecordHistory(
  table: string,
  sysId: string,
  extra: Record<string, unknown> = {},
): void {
  replaceRecordUrl(table, sysId, extra);
}

/** Update URL + history state with the resolved record table (no new history entry). */
export function replaceRecordUrl(
  table: string,
  sysId: string,
  extra: Record<string, unknown> = {},
): void {
  const url = new URL(window.location.href);
  url.searchParams.set('table', table);
  url.searchParams.set('sys_id', sysId);
  url.searchParams.delete('page');
  window.history.replaceState({ table, sysId, ...extra }, '', url.toString());
}

/** Pick the best table hint from CI navigation props. */
export function pickCiTableHint(ci: { table?: string; class?: string }): string {
  if (isRecordTableName(ci.table)) return ci.table;
  if (isRecordTableName(ci.class)) return ci.class;
  return 'cmdb_ci';
}

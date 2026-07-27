/** True when the string looks like a ServiceNow CMDB table name. */
export function isCmdbTableName(value: string | null | undefined): value is string {
  return !!value && /^cmdb_ci[\w]*$/.test(value);
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
  window.history.replaceState(
    { table, sysId, ...extra },
    '',
    window.location.href,
  );
}

import type { TableAccess } from '../../api/servicenow';
import type { FieldAccessEntry, FieldAccessResponse } from '../../api/servicenow';
import type { ViewField, FormSectionLayout, FormLayoutRow } from './viewFields';

export type { TableAccess };

export type SectionAccessState = 'loading' | 'visible' | 'empty' | 'hidden';

/** True when the field key exists on the record (field-level read ACL passed). */
export function fieldPresent(record: Record<string, unknown>, element: string): boolean {
  if (element in record) return true;
  // Dot-walk keys e.g. task.number, ci_item.sys_id
  if (`${element}.display_value` in record || `${element}.value` in record) return true;
  return false;
}

/** Keep layout columns where at least one record returned the field (optional key prefix e.g. task.). */
export function filterColumnsByRecords(
  columns: ViewField[],
  records: Array<Record<string, unknown>>,
  keyPrefix = '',
): ViewField[] {
  if (!records.length) return columns;
  return columns.filter(col =>
    records.some(rec => fieldPresent(rec, `${keyPrefix}${col.element}`)),
  );
}

/** Drop columns absent from a single probe record. */
export function filterColumnsByProbe(
  columns: ViewField[],
  probe: Record<string, unknown> | null | undefined,
): ViewField[] {
  if (!probe) return columns;
  return columns.filter(col => fieldPresent(probe, col.element));
}

/** Layout order ∩ fields readable in the supplied records. */
export function mergeColumnAccess(
  layoutColumns: ViewField[],
  records: Array<Record<string, unknown>>,
): ViewField[] {
  return filterColumnsByRecords(layoutColumns, records);
}

/** Filter form/view fields to those present in a values map (keys = readable fields). */
export function filterFieldsByReadableKeys(
  fields: ViewField[],
  values: Record<string, string>,
): ViewField[] {
  return fields.filter(f => f.element in values);
}

export function accessFromTableResult(access: TableAccess, rowCount: number): SectionAccessState {
  if (access === 'denied') return 'hidden';
  if (access === 'error') return 'empty';
  return rowCount > 0 ? 'visible' : 'empty';
}

export function isAccessDenied(access: TableAccess): boolean {
  return access === 'denied';
}

/** Drop form rows/fields not present in readable values (field-level ACL). */
export function filterFormSections(
  sections: FormSectionLayout[],
  values: Record<string, string>,
): FormSectionLayout[] {
  return sections
    .map(sec => ({
      ...sec,
      rows: sec.rows
        .map((row): FormLayoutRow | null => {
          if (row.kind === 'full') {
            return row.field.element in values ? row : null;
          }
          const left = row.left.filter(f => f.element in values);
          const right = row.right.filter(f => f.element in values);
          if (!left.length && !right.length) return null;
          return { kind: 'columns', left, right };
        })
        .filter((row): row is FormLayoutRow => row !== null),
    }))
    .filter(sec => sec.rows.length > 0);
}

/** True when the REST field_access probe grants record-level write. */
export function canEditRecord(access: FieldAccessResponse | null | undefined): boolean {
  return access?.canWriteRecord === true;
}

/** Drop unreadable fields; keep readable but non-writable fields for read-only edit rows. */
export function filterFormSectionsForEdit(
  sections: FormSectionLayout[],
  accessMap: Record<string, FieldAccessEntry>,
  values?: Record<string, unknown>,
): FormSectionLayout[] {
  const readable = (el: string) =>
    accessMap[el]?.read === true || (values != null && el in values);

  return sections
    .map(sec => ({
      ...sec,
      rows: sec.rows
        .map((row): FormLayoutRow | null => {
          if (row.kind === 'full') {
            return readable(row.field.element) ? row : null;
          }
          const left = row.left.filter(f => readable(f.element));
          const right = row.right.filter(f => readable(f.element));
          if (!left.length && !right.length) return null;
          return { kind: 'columns', left, right };
        })
        .filter((row): row is FormLayoutRow => row !== null),
    }))
    .filter(sec => sec.rows.length > 0);
}

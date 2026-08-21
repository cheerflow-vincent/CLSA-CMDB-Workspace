import { queryTable } from '../../api/servicenow';
import type { FieldAccessEntry } from '../../api/servicenow';
import { resolveReferenceList } from '../../api/servicenow';
import type { EditFieldValue } from './viewFields';
import { raw, str } from './viewFields';
import { editDisplayValue, editRawValue } from './editValues';

const REFERENCE_TYPES = new Set(['reference', 'document_id', 'domain_id']);
const SYS_ID_RE = /^[a-f0-9]{32}$/i;

/** True when a reference value still needs a display label lookup. */
export function needsReferenceDisplayResolve(value: EditFieldValue | undefined): boolean {
  const id = editRawValue(value);
  if (!id || !SYS_ID_RE.test(id)) return false;
  const disp = editDisplayValue(value);
  return !disp || disp === id;
}

/**
 * Merge REST field_access with Table API values and dictionary metadata so edit
 * visibility matches read view (field present in GET → show as read-only minimum).
 */
export function mergeEditFieldAccess(
  elements: string[],
  accessFields: Record<string, FieldAccessEntry>,
  values: Record<string, EditFieldValue>,
  dictFallback: Record<string, FieldAccessEntry>,
): Record<string, FieldAccessEntry> {
  const merged: Record<string, FieldAccessEntry> = { ...accessFields };

  for (const el of elements) {
    const readable = el in values;
    const existing = merged[el];

    if (existing) {
      if (!existing.read && readable) {
        merged[el] = { ...existing, read: true };
      }
      continue;
    }

    if (!readable) continue;

    if (dictFallback[el]) {
      merged[el] = {
        ...dictFallback[el],
        read: true,
        write: dictFallback[el].write ?? false,
      };
    } else {
      merged[el] = {
        read: true,
        write: false,
        internal_type: 'string',
      };
    }
  }

  return merged;
}

/** Resolve sys_dictionary metadata for fields missing from field_access (parent-table walk). */
export async function fetchDictionaryFieldMeta(
  recordTable: string,
  elements: string[],
  resolveParent: (table: string) => Promise<string>,
): Promise<Record<string, FieldAccessEntry>> {
  if (!elements.length) return {};

  const tables: string[] = [recordTable];
  const parent = await resolveParent(recordTable);
  if (parent && !tables.includes(parent)) tables.push(parent);
  if (!tables.includes('cmdb_ci')) tables.push('cmdb_ci');

  const meta: Record<string, FieldAccessEntry> = {};
  const remaining = new Set(elements);

  for (const tbl of tables) {
    if (!remaining.size) break;
    const batch = [...remaining];
    try {
      const { result = [] } = await queryTable<{
        element: unknown;
        internal_type: unknown;
        reference: unknown;
        max_length: unknown;
        mandatory: unknown;
      }>({
        table: 'sys_dictionary',
        query: `name=${tbl}^elementIN${batch.join(',')}^active=true`,
        fields: ['element', 'internal_type', 'reference', 'max_length', 'mandatory'],
        limit: batch.length,
      });

      for (const row of result) {
        const el = str(row.element);
        if (!el || meta[el]) continue;
        const internalType = str(row.internal_type) || 'string';
        meta[el] = {
          read: true,
          write: false,
          internal_type: internalType,
          reference: raw(row.reference) || undefined,
          max_length: parseInt(str(row.max_length), 10) || undefined,
          mandatory: str(row.mandatory) === 'true' || undefined,
        };
        remaining.delete(el);
      }
    } catch {
      // try next table in hierarchy
    }
  }

  return meta;
}

/** Resolve reference / glide_list display labels when Table API returned sys_ids only. */
export async function enrichReferenceEditValues(
  values: Record<string, EditFieldValue>,
  accessMap: Record<string, FieldAccessEntry>,
): Promise<Record<string, EditFieldValue>> {
  const next: Record<string, EditFieldValue> = { ...values };
  const tasks: Promise<void>[] = [];

  for (const [el, access] of Object.entries(accessMap)) {
    const refTable = access.reference || '';
    const val = values[el];

    if (REFERENCE_TYPES.has(access.internal_type) && refTable) {
      const id = editRawValue(val);
      if (!needsReferenceDisplayResolve(val)) continue;
      tasks.push(
        resolveReferenceList(refTable, [id]).then(opts => {
          const label = opts[0]?.display;
          if (label && label !== id) {
            next[el] = { value: id, display_value: label };
          }
        }),
      );
      continue;
    }

    if (access.internal_type === 'glide_list' && refTable) {
      const items = editRawValue(val).split(',').map(s => s.trim()).filter(Boolean);
      const disp = editDisplayValue(val);
      const labels = disp.split(',').map(s => s.trim());
      const needs = items.some((id, i) => SYS_ID_RE.test(id) && (!labels[i] || labels[i] === id));
      if (!needs) continue;
      tasks.push(
        resolveReferenceList(refTable, items).then(opts => {
          const byId = new Map(opts.map(o => [o.sys_id, o.display]));
          next[el] = {
            value: items.join(','),
            display_value: items.map(id => byId.get(id) || id).join(', '),
          };
        }),
      );
    }
  }

  await Promise.all(tasks);
  return next;
}

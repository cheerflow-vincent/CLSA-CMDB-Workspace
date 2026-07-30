import type { EditFieldValue } from '../utils/viewFields';

export function editDisplayValue(value: EditFieldValue | undefined): string {
  if (value == null) return '';
  if (typeof value === 'object') return value.display_value || value.value || '';
  return value;
}

export function editRawValue(value: EditFieldValue | undefined): string {
  if (value == null) return '';
  if (typeof value === 'object') return value.value || '';
  return value;
}

export function editValuesEqual(a: EditFieldValue | undefined, b: EditFieldValue | undefined): boolean {
  return editRawValue(a) === editRawValue(b);
}

export interface ListItemValue {
  value: string;
  display: string;
}

/** Parse glide_list value (comma-separated sys_ids + display labels). */
export function parseListFieldValue(value: EditFieldValue | undefined): ListItemValue[] {
  const raw = editRawValue(value);
  if (!raw) return [];
  const ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  const disp = editDisplayValue(value);
  const labels = disp.split(',').map(s => s.trim());
  return ids.map((id, i) => ({ value: id, display: labels[i] || id }));
}

export function serializeListFieldValue(items: ListItemValue[]): EditFieldValue {
  return {
    value: items.map(i => i.value).join(','),
    display_value: items.map(i => i.display).join(', '),
  };
}

/** Build PATCH payload from dirty writable fields only. */
export function buildPatchPayload(
  initial: Record<string, EditFieldValue>,
  current: Record<string, EditFieldValue>,
  writableElements: Set<string>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const element of writableElements) {
    if (!editValuesEqual(initial[element], current[element])) {
      payload[element] = editRawValue(current[element]);
    }
  }
  return payload;
}

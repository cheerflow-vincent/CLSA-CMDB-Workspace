import { queryTable } from '../../api/servicenow';

/** One field configured in a form view */
export interface ViewField { element: string; label: string }

/** Coerce any API value to a plain string (prefers display_value). */
export const str = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.display_value != null) return String(o.display_value);
    if (o.value        != null) return String(o.value);
    return '';
  }
  return String(v);
};

/** Coerce any API value to its raw database value (prefers value). */
export const raw = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (o.value        != null) return String(o.value);
    if (o.display_value != null) return String(o.display_value);
    return '';
  }
  return String(v);
};

const INST_TABLE = 'cmdb_ci_service_auto';
const SVC_TABLE  = 'cmdb_ci_service';

/** Fetch field elements from sys_ui_element and resolve their labels from sys_documentation. */
export async function resolveViewFields(
  tableName: string,
  elemsQuery: string,
  limit: number,
): Promise<ViewField[] | null> {
  const { result: elems = [] } = await queryTable<{ element: unknown }>({
    table: 'sys_ui_element',
    query: elemsQuery,
    fields: ['element', 'position'],
    limit,
  });
  const fieldNames = elems.map(e => str(e.element)).filter(Boolean);
  if (!fieldNames.length) return null;

  const { result: docs = [] } = await queryTable<{ element: unknown; label: unknown }>({
    table: 'sys_documentation',
    query: `name=${tableName}^language=en^elementIN${fieldNames.join(',')}`,
    fields: ['element', 'label'],
    limit: fieldNames.length + 10,
  });
  const labelMap = new Map(docs.map(d => [str(d.element), str(d.label)]));
  return fieldNames.map(e => ({
    element: e,
    label: labelMap.get(e) || e.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));
}

/**
 * Load the form-view field list for a specific CI table using a 4-step fallback:
 *  1. `viewTitle` view on the given table
 *  2. `viewTitle` view on cmdb_ci_service_auto  (skipped when same as tableName)
 *  3. `viewTitle` view on cmdb_ci_service        (skipped when same as tableName)
 *  4. Default view on the given table (first `defaultLimit` fields)
 *
 * @param tableName    The specific CI table (e.g. cmdb_ci_appl, cmdb_ci_service)
 * @param viewTitle    The view title to look for (e.g. "CLSA CMDB Workspace")
 * @param defaultLimit Max fields to return from the default view fallback
 * @param defaultFields Fallback fields if all steps fail
 */
export async function loadViewFields(
  tableName: string,
  viewTitle: string,
  defaultLimit: number,
  defaultFields: ViewField[] = [],
): Promise<ViewField[]> {
  try {
    // Step 1: named view on the given table
    // sys_ui_section.name = table name (API field; label is "Table")
    // sys_ui_view.title   = view display name
    // No type filter — elements without a field name (labels, spacers) are
    // dropped later by the .filter(Boolean) on the element value.
    // sys_ui_element.sys_ui_section is the reference field to sys_ui_section
    const step1 = await resolveViewFields(
      tableName,
      `sys_ui_section.view.title=${viewTitle}^sys_ui_section.name=${tableName}^ORDERBYposition`,
      50,
    );
    if (step1) return step1;

    // Step 2: named view on cmdb_ci_service_auto
    if (tableName !== INST_TABLE) {
      const step2 = await resolveViewFields(
        INST_TABLE,
        `sys_ui_section.view.title=${viewTitle}^sys_ui_section.name=${INST_TABLE}^ORDERBYposition`,
        50,
      );
      if (step2) return step2;
    }

    // Step 3: named view on cmdb_ci_service
    if (tableName !== SVC_TABLE) {
      const step3 = await resolveViewFields(
        SVC_TABLE,
        `sys_ui_section.view.title=${viewTitle}^sys_ui_section.name=${SVC_TABLE}^ORDERBYposition`,
        50,
      );
      if (step3) return step3;
    }

    // Step 4: default view on the given table (default view has an empty name in sys_ui_view)
    const step4 = await resolveViewFields(
      tableName,
      `sys_ui_section.view.name=^sys_ui_section.name=${tableName}^ORDERBYposition`,
      defaultLimit,
    );
    return step4 ?? defaultFields;
  } catch {
    return defaultFields;
  }
}

/** Resolve column labels for a set of field elements on a table. */
async function labelListElements(
  tableName: string,
  fieldNames: string[],
): Promise<ViewField[]> {
  const { result: docs = [] } = await queryTable<{ element: unknown; label: unknown }>({
    table: 'sys_documentation',
    query: `name=${tableName}^language=en^elementIN${fieldNames.join(',')}`,
    fields: ['element', 'label'],
    limit: fieldNames.length + 10,
  });
  const labelMap = new Map(docs.map(d => [str(d.element), str(d.label)]));
  return fieldNames.map(e => ({
    element: e,
    label: labelMap.get(e) || e.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  }));
}

/** Fetch columns from sys_ui_list_element for a resolved list sys_id. */
async function resolveListElementsByListId(
  tableName: string,
  listSysId: string,
  limit: number,
): Promise<ViewField[] | null> {
  const { result: elems = [] } = await queryTable<{ element: unknown }>({
    table: 'sys_ui_list_element',
    query: `list_id=${listSysId}^ORDERBYposition`,
    fields: ['element', 'position'],
    limit,
  });
  const fieldNames = elems.map(e => str(e.element)).filter(Boolean);
  if (!fieldNames.length) return null;
  return labelListElements(tableName, fieldNames);
}

/** Dot-walk fallback on sys_ui_list_element.list_id (some instances). */
async function resolveListFieldsDotWalk(
  tableName: string,
  listTitle: string,
  limit: number,
): Promise<ViewField[] | null> {
  const { result: elems = [] } = await queryTable<{ element: unknown }>({
    table: 'sys_ui_list_element',
    query: `list_id.name=${tableName}^list_id.view.title=${listTitle}^ORDERBYposition`,
    fields: ['element', 'position'],
    limit,
  });
  const fieldNames = elems.map(e => str(e.element)).filter(Boolean);
  if (!fieldNames.length) return null;
  return labelListElements(tableName, fieldNames);
}

async function findListSysId(listQuery: string): Promise<string | null> {
  const { result = [] } = await queryTable<{ sys_id: unknown }>({
    table: 'sys_ui_list',
    query: listQuery,
    fields: ['sys_id'],
    limit: 1,
  });
  const id = result[0] ? raw(result[0].sys_id) : '';
  return id || null;
}

/**
 * Load list-layout columns for a CI table:
 *  1. Find sys_ui_list by name + view.title, then sys_ui_list_element by list_id
 *  2. Default list on the given table (view.name empty)
 *  3. Dot-walk fallback on list_id
 *  4. `defaultFields` fallback
 */
export async function loadListFields(
  tableName: string,
  listTitle: string,
  defaultFields: ViewField[] = [],
): Promise<ViewField[]> {
  try {
    const namedListId = await findListSysId(`name=${tableName}^view.title=${listTitle}`);
    if (namedListId) {
      const cols = await resolveListElementsByListId(tableName, namedListId, 50);
      if (cols) return cols;
    }

    const defaultListId = await findListSysId(`name=${tableName}^view.name=`);
    if (defaultListId) {
      const cols = await resolveListElementsByListId(tableName, defaultListId, 20);
      if (cols) return cols;
    }

    const dotWalk = await resolveListFieldsDotWalk(tableName, listTitle, 50);
    if (dotWalk) return dotWalk;

    return defaultFields;
  } catch {
    return defaultFields;
  }
}

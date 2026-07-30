import { queryTable, queryTableWithAccess, type TableAccess } from '../../api/servicenow';

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

// ─── Form layout (sys_ui_form → sections → elements) ─────────────────────────

export type FormLayoutRow =
  | { kind: 'full'; field: ViewField }
  | { kind: 'columns'; left: ViewField[]; right: ViewField[] };

export interface FormSectionLayout {
  caption: string | null;
  rows: FormLayoutRow[];
}

export interface FormLayoutResult {
  sections: FormSectionLayout[];
  resolvedTable: string;
  resolvedView: 'named' | 'default';
}

interface RawUiElement {
  element: string;
  position: number;
  type: string;
}

type MarkerKind = 'split' | 'end_split' | 'begin_split' | 'field' | 'skip';

function markerKind(el: RawUiElement): MarkerKind {
  const tokens = [el.type, el.element].filter(Boolean);
  for (const t of tokens) {
    if (t === '.split') return 'split';
    if (t === '.end_split' || t === '.end') return 'end_split';
    if (t === '.begin_split') return 'begin_split';
  }
  if (!el.element || el.element.startsWith('.')) return 'skip';
  return 'field';
}

function toRawUiElement(rec: { element: unknown; position: unknown; type: unknown }): RawUiElement {
  return {
    element: str(rec.element),
    position: parseInt(str(rec.position), 10) || 0,
    type: str(rec.type),
  };
}

/** Collect all field element names from parsed rows (for API fetch). */
export function flattenSectionFields(section: FormSectionLayout): string[] {
  const names: string[] = [];
  for (const row of section.rows) {
    if (row.kind === 'full') names.push(row.field.element);
    else {
      names.push(...row.left.map(f => f.element), ...row.right.map(f => f.element));
    }
  }
  return names;
}

/** All unique field elements across form sections (supports dot-walk paths). */
export function flattenLayoutFields(sections: FormSectionLayout[]): string[] {
  return [...new Set(sections.flatMap(flattenSectionFields))];
}

/** Fetch display values for a record, including dot-walked reference fields. */
export async function fetchRecordFieldValues(
  table: string,
  sysId: string,
  elements: string[],
): Promise<{ values: Record<string, string>; access: TableAccess }> {
  if (!elements.length) return { values: {}, access: 'ok' };
  const { result, access } = await queryTableWithAccess<Record<string, unknown>>({
    table,
    query: `sys_id=${sysId}`,
    fields: elements,
    displayValue: true,
    limit: 1,
  });
  if (access === 'denied') {
    return { values: {}, access: 'denied' };
  }
  const rec = result?.[0] ?? {};
  const vals: Record<string, string> = {};
  for (const el of elements) {
    if (el in rec) {
      vals[el] = str(rec[el]);
    }
  }
  return { values: vals, access: result.length ? 'ok' : access };
}

/** Reference / choice values retain { value, display_value } for edit controls. */
export type EditFieldValue = string | { value: string; display_value: string };

const SYS_ID_PATTERN = /^[a-f0-9]{32}$/i;

function toEditFieldValue(v: unknown): EditFieldValue {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const rawVal = o.value != null ? String(o.value) : '';
    const dispVal = o.display_value != null ? String(o.display_value) : '';
    if (dispVal) return { value: rawVal, display_value: dispVal };
    if (rawVal && !SYS_ID_PATTERN.test(rawVal)) return { value: rawVal, display_value: rawVal };
    return { value: rawVal, display_value: '' };
  }
  const s = String(v);
  if (s && !SYS_ID_PATTERN.test(s)) return s;
  return s;
}

/** Fetch raw + display values for editable fields (displayValue: all). */
export async function fetchRecordFieldValuesForEdit(
  table: string,
  sysId: string,
  elements: string[],
): Promise<{ values: Record<string, EditFieldValue>; access: TableAccess }> {
  if (!elements.length) return { values: {}, access: 'ok' };
  const { result, access } = await queryTableWithAccess<Record<string, unknown>>({
    table,
    query: `sys_id=${sysId}`,
    fields: elements,
    displayValue: 'all',
    limit: 1,
  });
  if (access === 'denied') {
    return { values: {}, access: 'denied' };
  }
  const rec = result?.[0] ?? {};
  const vals: Record<string, EditFieldValue> = {};
  for (const el of elements) {
    if (!(el in rec)) continue;
    vals[el] = toEditFieldValue(rec[el]);
  }
  return { values: vals, access: result.length ? 'ok' : access };
}

/**
 * Parse sys_ui_element stream into layout rows (ServiceNow form semantics).
 *
 * - Fields before `.split` → left column; fields between `.split` and `.end_split` → right column
 * - After `.end_split` → full-width rows until `.begin_split` or an implicit split block
 * - `.begin_split` → start a new two-column block (left until next `.split`)
 * - Section with no split markers → full-width rows, or paired columns when `fallbackColumns === 2`
 */
export function parseElementRows(
  elems: RawUiElement[],
  fallbackColumns: 1 | 2 = 1,
): FormLayoutRow[] {
  const rows: FormLayoutRow[] = [];
  type Mode = 'neutral' | 'two_col' | 'full_only';

  let mode: Mode = 'neutral';
  let pendingFields: RawUiElement[] = [];
  let leftCol: RawUiElement[] = [];
  let rightCol: RawUiElement[] = [];
  let pastSplit = false;
  let sawSplitMarker = false;

  const toField = (e: RawUiElement): ViewField => ({ element: e.element, label: e.element });

  const flushTwoCol = () => {
    if (!leftCol.length && !rightCol.length) return;
    rows.push({
      kind: 'columns',
      left: leftCol.map(toField),
      right: rightCol.map(toField),
    });
    leftCol = [];
    rightCol = [];
    pastSplit = false;
  };

  const emitPendingAsFull = () => {
    for (const f of pendingFields) {
      rows.push({ kind: 'full', field: toField(f) });
    }
    pendingFields = [];
  };

  const startTwoColBlock = () => {
    mode = 'two_col';
    leftCol = [];
    rightCol = [];
    pastSplit = false;
  };

  for (const el of elems) {
    switch (markerKind(el)) {
      case 'begin_split':
        sawSplitMarker = true;
        if (mode === 'neutral') emitPendingAsFull();
        else if (mode === 'two_col') flushTwoCol();
        startTwoColBlock();
        break;

      case 'split':
        sawSplitMarker = true;
        if (mode === 'neutral') {
          leftCol = [...pendingFields];
          pendingFields = [];
          mode = 'two_col';
        } else if (mode === 'full_only') {
          startTwoColBlock();
        }
        pastSplit = true;
        break;

      case 'end_split':
        sawSplitMarker = true;
        if (mode === 'neutral') emitPendingAsFull();
        else if (mode === 'two_col') flushTwoCol();
        mode = 'full_only';
        break;

      case 'field':
        if (mode === 'neutral') pendingFields.push(el);
        else if (mode === 'full_only') rows.push({ kind: 'full', field: toField(el) });
        else if (pastSplit) rightCol.push(el);
        else leftCol.push(el);
        break;

      default:
        break;
    }
  }

  if (mode === 'neutral' && pendingFields.length) {
    if (!sawSplitMarker && fallbackColumns === 2) {
      for (let i = 0; i < pendingFields.length; i += 2) {
        if (i + 1 < pendingFields.length) {
          rows.push({
            kind: 'columns',
            left: [toField(pendingFields[i])],
            right: [toField(pendingFields[i + 1])],
          });
        } else {
          rows.push({ kind: 'full', field: toField(pendingFields[i]) });
        }
      }
    } else {
      emitPendingAsFull();
    }
  } else if (mode === 'two_col') {
    flushTwoCol();
  }

  return rows;
}

function formatElementLabel(element: string): string {
  return element
    .replace(/_/g, ' ')
    .replace(/\./g, ' › ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function labelForElement(element: string, labelMap: Map<string, string>): string {
  const direct = labelMap.get(element);
  if (direct) return direct;
  const base = element.split('.')[0];
  if (base !== element) {
    const baseLabel = labelMap.get(base);
    if (baseLabel) return baseLabel;
  }
  return formatElementLabel(element);
}

function applyLabels(rows: FormLayoutRow[], labelMap: Map<string, string>): void {
  for (const row of rows) {
    if (row.kind === 'full') {
      row.field.label = labelForElement(row.field.element, labelMap);
    } else {
      for (const f of [...row.left, ...row.right]) {
        f.label = labelForElement(f.element, labelMap);
      }
    }
  }
}

function collectFieldNames(rows: FormLayoutRow[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (row.kind === 'full') names.push(row.field.element);
    else names.push(...row.left.map(f => f.element), ...row.right.map(f => f.element));
  }
  return names;
}

function parseColumns(v: unknown): 1 | 2 {
  const n = parseInt(str(v), 10);
  return n >= 2 ? 2 : 1;
}

async function findFormSysId(
  tableName: string,
  viewTitle: string | null,
): Promise<string | null> {
  const viewClause = viewTitle ? `view.title=${viewTitle}` : 'view.name=';
  const queries = [
    `name=${tableName}^${viewClause}^sys_userISEMPTY^active=true`,
    `name=${tableName}^${viewClause}^sys_userISEMPTY`,
  ];
  for (const query of queries) {
    const { result = [] } = await queryTable<{ sys_id: unknown }>({
      table: 'sys_ui_form',
      query,
      fields: ['sys_id'],
      limit: 1,
    });
    const id = result[0] ? raw(result[0].sys_id) : '';
    if (id) return id;
  }
  return null;
}

async function fetchSectionElements(sectionId: string): Promise<RawUiElement[]> {
  const { result = [] } = await queryTable<{ element: unknown; position: unknown; type: unknown }>({
    table: 'sys_ui_element',
    query: `sys_ui_section=${sectionId}^ORDERBYposition`,
    fields: ['element', 'position', 'type'],
    limit: 200,
  });
  return result.map(toRawUiElement);
}

async function loadLegacySingleSection(
  tableName: string,
  viewTitle: string | null,
): Promise<FormSectionLayout[] | null> {
  const viewClause = viewTitle
    ? `sys_ui_section.view.title=${viewTitle}`
    : 'sys_ui_section.view.name=';
  const { result = [] } = await queryTable<{ element: unknown; position: unknown; type: unknown }>({
    table: 'sys_ui_element',
    query: `${viewClause}^sys_ui_section.name=${tableName}^ORDERBYposition`,
    fields: ['element', 'position', 'type'],
    limit: 200,
  });
  const elems = result.map(toRawUiElement);
  const rows = parseElementRows(elems, 1);
  if (!collectFieldNames(rows).length) return null;
  return [{ caption: null, rows }];
}

function docLookupNames(elements: string[]): string[] {
  const names = new Set<string>();
  for (const el of elements) {
    names.add(el);
    const base = el.split('.')[0];
    if (base !== el) names.add(base);
  }
  return [...names];
}

async function applySectionLabels(
  tableName: string,
  sections: FormSectionLayout[] | null,
): Promise<FormSectionLayout[] | null> {
  if (!sections?.length) return sections;
  const allFieldNames = sections.flatMap(s => collectFieldNames(s.rows));
  const labeled = await labelListElements(tableName, docLookupNames(allFieldNames));
  const labelMap = new Map(labeled.map(f => [f.element, f.label]));
  for (const sec of sections) {
    applyLabels(sec.rows, labelMap);
  }
  return sections;
}

async function resolveFormLayoutFromTable(
  tableName: string,
  viewTitle: string | null,
): Promise<FormSectionLayout[] | null> {
  const formId = await findFormSysId(tableName, viewTitle);
  if (!formId) return applySectionLabels(tableName, await loadLegacySingleSection(tableName, viewTitle));

  const { result: formSectionRows = [] } = await queryTable<{
    sys_ui_section: unknown;
    position: unknown;
  }>({
    table: 'sys_ui_form_section',
    query: `sys_ui_form=${formId}^ORDERBYposition`,
    fields: ['sys_ui_section', 'position'],
    limit: 50,
  });
  if (!formSectionRows.length) {
    return applySectionLabels(tableName, await loadLegacySingleSection(tableName, viewTitle));
  }

  const sections: FormSectionLayout[] = [];
  const allFieldNames: string[] = [];

  for (const row of formSectionRows) {
    const sectionId = raw(row.sys_ui_section);
    if (!sectionId) continue;

    const { result: sectionMeta = [] } = await queryTable<{
      caption: unknown;
      columns: unknown;
    }>({
      table: 'sys_ui_section',
      query: `sys_id=${sectionId}`,
      fields: ['caption', 'columns'],
      limit: 1,
    });
    const meta = sectionMeta[0];
    const captionRaw = meta ? str(meta.caption).trim() : '';
    const sectionColumns = meta ? parseColumns(meta.columns) : 1;

    const elems = await fetchSectionElements(sectionId);
    const rows = parseElementRows(elems, sectionColumns);
    const fieldNames = collectFieldNames(rows);
    if (!fieldNames.length && !captionRaw) continue;

    allFieldNames.push(...fieldNames);
    sections.push({ caption: captionRaw || null, rows });
  }

  if (!sections.length) return null;

  return applySectionLabels(tableName, sections);
}

async function tryLoadFormLayout(
  tableName: string,
  viewTitle: string | null,
): Promise<FormLayoutResult | null> {
  const sections = await resolveFormLayoutFromTable(tableName, viewTitle);
  if (!sections?.length) return null;
  const hasFields = sections.some(s => collectFieldNames(s.rows).length > 0);
  if (!hasFields) return null;
  return {
    sections,
    resolvedTable: tableName,
    resolvedView: viewTitle ? 'named' : 'default',
  };
}

const CMDB_CI_TABLE = 'cmdb_ci';

/**
 * Load readonly form layout for CI detail:
 * sys_ui_form → sys_ui_form_section → sys_ui_section → sys_ui_element
 *
 * Fallback order: named view on record table → named on parent → named on
 * cmdb_ci → default on record table → default on parent → default on cmdb_ci.
 */
export async function loadFormLayout(
  recordTable: string,
  viewTitle: string,
  resolveParent: (table: string) => Promise<string>,
): Promise<FormLayoutResult> {
  const parentTable = await resolveParent(recordTable);
  const attempts: { table: string; viewTitle: string | null }[] = [
    { table: recordTable, viewTitle },
    { table: parentTable, viewTitle },
    { table: CMDB_CI_TABLE, viewTitle },
    { table: recordTable, viewTitle: null },
    { table: parentTable, viewTitle: null },
    { table: CMDB_CI_TABLE, viewTitle: null },
  ];

  const seen = new Set<string>();
  for (const { table, viewTitle: vt } of attempts) {
    const key = `${table}:${vt ?? 'default'}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const result = await tryLoadFormLayout(table, vt);
    if (result) return result;
  }

  return {
    sections: [],
    resolvedTable: recordTable,
    resolvedView: 'named',
  };
}

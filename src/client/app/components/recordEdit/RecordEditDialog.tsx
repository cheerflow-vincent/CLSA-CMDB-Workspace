import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';
import {
  loadFormLayout,
  flattenLayoutFields,
  buildLayoutFieldLabelMap,
  fetchRecordFieldValuesForEdit,
  type FormSectionLayout,
  type EditFieldValue,
} from '../../utils/viewFields';
import { resolveCiSearchParentTable } from '../../utils/ciTables';
import {
  fetchFieldAccess,
  updateRecord,
  type FieldAccessEntry,
} from '../../../api/servicenow';
import { buildPatchPayload, validateMandatoryEditFields } from '../../utils/editValues';
import { Z_INDEX } from '../../utils/layering';
import {
  mergeEditFieldAccess,
  fetchDictionaryFieldMeta,
  enrichReferenceEditValues,
} from '../../utils/editFormLoad';
import FormEditBlock from '../FormEditBlock';

export const DEFAULT_EDIT_VIEW = 'CLSA CMDB Workspace Edit';

export interface RecordEditDialogProps {
  table: string;
  sysId: string;
  recordName: string;
  onClose: () => void;
  onSaved: () => void;
  /** UI form view title (default: CLSA CMDB Workspace Edit) */
  editView?: string;
  /** Modal heading (default: Edit Record) */
  title?: string;
  resolveParent?: (table: string) => Promise<string>;
}

export default function RecordEditDialog({
  table,
  sysId,
  recordName,
  onClose,
  onSaved,
  editView = DEFAULT_EDIT_VIEW,
  title = 'Edit Record',
  resolveParent = resolveCiSearchParentTable,
}: RecordEditDialogProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sections, setSections] = useState<FormSectionLayout[]>([]);
  const [accessMap, setAccessMap] = useState<Record<string, FieldAccessEntry>>({});
  const [initialValues, setInitialValues] = useState<Record<string, EditFieldValue>>({});
  const [values, setValues] = useState<Record<string, EditFieldValue>>({});
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const layout = await loadFormLayout(table, editView, resolveParent);
        if (cancelled) return;

        setSections(layout.sections);

        const elements = flattenLayoutFields(layout.sections);
        if (!elements.length) {
          setAccessMap({});
          setInitialValues({});
          setValues({});
          return;
        }

        const [valueResult, accessResult] = await Promise.all([
          fetchRecordFieldValuesForEdit(table, sysId, elements),
          fetchFieldAccess(table, sysId, elements),
        ]);
        if (cancelled) return;

        if (valueResult.access === 'denied') {
          setError('You do not have permission to view this record.');
          return;
        }

        const missingFromAccess = elements.filter(el => !accessResult.fields[el]);
        const dictMeta = missingFromAccess.length
          ? await fetchDictionaryFieldMeta(table, missingFromAccess, resolveParent)
          : {};
        if (cancelled) return;

        const mergedAccess = mergeEditFieldAccess(
          elements,
          accessResult.fields,
          valueResult.values,
          dictMeta,
        );
        const enrichedValues = await enrichReferenceEditValues(valueResult.values, mergedAccess);
        if (cancelled) return;

        setAccessMap(mergedAccess);
        setInitialValues(enrichedValues);
        setValues(enrichedValues);
      } catch {
        if (!cancelled) setError('Failed to load edit form.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [table, sysId, editView, resolveParent]);

  const handleChange = useCallback((element: string, value: EditFieldValue) => {
    setValues(prev => ({ ...prev, [element]: value }));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    const validationError = validateMandatoryEditFields(
      accessMap,
      values,
      buildLayoutFieldLabelMap(sections),
    );
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const writable = new Set(
      Object.entries(accessMap)
        .filter(([, a]) => a.read && a.write)
        .map(([el]) => el),
    );
    const payload = buildPatchPayload(initialValues, values, writable);
    if (!Object.keys(payload).length) {
      onClose();
      setSaving(false);
      return;
    }

    const result = await updateRecord(table, sysId, payload);
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? 'Save failed.');
      return;
    }
    onSaved();
    onClose();
  };

  return createPortal(
    <div
      className="clsa-portal fixed inset-0 flex items-center justify-center bg-black/40 p-4"
      style={{ zIndex: Z_INDEX.modal }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="typo-section-title text-gray-900">{title}</h2>
            <p className="typo-page-subtitle mt-0.5 truncate">{recordName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg shrink-0"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2 typo-body">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading edit form…
            </div>
          ) : (
            <FormEditBlock
              sections={sections}
              accessMap={accessMap}
              values={values}
              onChange={handleChange}
            />
          )}
        </div>

        {error && (
          <div className="px-6 pb-2 shrink-0">
            <p className="typo-body text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          </div>
        )}

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 rounded-lg typo-body text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={loading || saving}
            className="px-4 py-2 bg-blue-900 text-white rounded-lg typo-body hover:bg-blue-800 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save Changes
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

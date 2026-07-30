import type { FieldAccessEntry } from '../../api/servicenow';
import type { FormSectionLayout, FormLayoutRow, EditFieldValue } from '../utils/viewFields';
import { filterFormSectionsForEdit } from '../utils/acl';
import CollapsibleFormSection from './formLayout/CollapsibleFormSection';
import FormEditField from './FormEditField';

export interface FormEditBlockProps {
  sections: FormSectionLayout[];
  accessMap: Record<string, FieldAccessEntry>;
  values: Record<string, EditFieldValue>;
  onChange: (element: string, value: EditFieldValue) => void;
}

export default function FormEditBlock({
  sections,
  accessMap,
  values,
  onChange,
}: FormEditBlockProps) {
  const visibleSections = filterFormSectionsForEdit(sections, accessMap, values);

  const fieldAccess = (element: string): FieldAccessEntry => (
    accessMap[element] ?? { read: true, write: false, internal_type: 'string' }
  );

  const renderRow = (row: FormLayoutRow, key: string) => {
    if (row.kind === 'full') {
      const access = fieldAccess(row.field.element);
      if (!access.read && !(row.field.element in values)) return null;
      return (
        <div key={key} className="col-span-2">
          <FormEditField
            label={row.field.label}
            element={row.field.element}
            access={access}
            value={values[row.field.element] ?? ''}
            onChange={onChange}
          />
        </div>
      );
    }

    const left = row.left.filter(f => fieldAccess(f.element).read || f.element in values);
    const right = row.right.filter(f => fieldAccess(f.element).read || f.element in values);
    if (!left.length && !right.length) return null;

    return (
      <div key={key} className="form-split-row">
        <div className="space-y-4">
          {left.map(f => (
            <FormEditField
              key={f.element}
              label={f.label}
              element={f.element}
              access={fieldAccess(f.element)}
              value={values[f.element] ?? ''}
              onChange={onChange}
            />
          ))}
        </div>
        <div className="space-y-4">
          {right.map(f => (
            <FormEditField
              key={f.element}
              label={f.label}
              element={f.element}
              access={fieldAccess(f.element)}
              value={values[f.element] ?? ''}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
    );
  };

  if (!visibleSections.length) {
    return (
      <p className="text-sm text-gray-400 italic py-4">
        Edit form not configured or no editable fields are visible.
      </p>
    );
  }

  return (
    <div className="detail-pane record-edit-form min-w-0">
      <div className="space-y-0">
        {visibleSections.map((sec, idx) => (
          <CollapsibleFormSection key={idx} caption={sec.caption} isFirst={idx === 0}>
            <div className="grid grid-cols-2 gap-y-4">
              {sec.rows.map((row, rowIdx) => renderRow(row, `${idx}-${rowIdx}`))}
            </div>
          </CollapsibleFormSection>
        ))}
      </div>
    </div>
  );
}

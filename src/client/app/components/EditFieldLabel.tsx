export interface EditFieldLabelProps {
  label: string;
  required?: boolean;
  className?: string;
}

export default function EditFieldLabel({
  label,
  required = false,
  className = 'block typo-field-label mb-1',
}: EditFieldLabelProps) {
  return (
    <label className={className}>
      {label}
      {required && <span className="text-red-600 ml-0.5" aria-hidden="true">*</span>}
    </label>
  );
}

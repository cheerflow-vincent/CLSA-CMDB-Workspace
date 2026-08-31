import type { ReactNode } from 'react';
import { Calendar, Clock } from 'lucide-react';
import type { FieldAccessEntry } from '../../api/servicenow';
import type { EditFieldValue } from '../utils/viewFields';
import { editDisplayValue } from '../utils/editValues';
import EditFieldLabel from './EditFieldLabel';
import ReferenceAutocomplete from './ReferenceAutocomplete';
import ListCollectorField from './ListCollectorField';

const READONLY_TYPES = new Set([
  'html', 'script', 'conditions', 'template_value', 'password', 'password2',
  'user_image', 'image', 'video', 'audio', 'file_attachment',
  'glide_duration', 'duration', 'composite_name', 'collection',
]);

const REFERENCE_TYPES = new Set(['reference', 'document_id', 'domain_id']);

function isJournalType(internalType: string): boolean {
  return internalType.startsWith('journal');
}

function inputClass(disabled: boolean): string {
  return `w-full border rounded-lg px-3 py-2 typo-body ${
    disabled
      ? 'border-gray-200 bg-gray-50 text-gray-600 cursor-not-allowed'
      : 'border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent'
  }`;
}

function pickerShellClass(disabled: boolean): string {
  return `flex items-center gap-2 border rounded-lg px-3 py-2 ${
    disabled
      ? 'border-gray-200 bg-gray-50 cursor-not-allowed'
      : 'border-gray-300 bg-white focus-within:ring-2 focus-within:ring-blue-400 focus-within:border-transparent'
  }`;
}

/** SN glide_date → yyyy-MM-dd */
function toDateInput(value: string): string {
  if (!value) return '';
  return value.slice(0, 10);
}

/** SN glide_date_time → { date, time } for HTML inputs */
function splitDateTime(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const [datePart, timePart = ''] = value.replace('T', ' ').split(' ');
  const time = timePart.slice(0, 5);
  return { date: datePart.slice(0, 10), time };
}

function joinDateTime(date: string, time = '00:00'): string {
  if (!date) return '';
  return `${date} ${time}:00`;
}

/** SN glide_time → HH:mm */
function toTimeInput(value: string): string {
  if (!value) return '';
  return value.replace(' ', 'T').slice(11, 16) || value.slice(0, 5);
}

function fromTimeInput(value: string): string {
  if (!value) return '';
  return value.length === 5 ? `${value}:00` : value;
}

export interface FormEditFieldProps {
  readonly label: string;
  readonly element: string;
  readonly access: FieldAccessEntry;
  readonly value: EditFieldValue;
  readonly onChange: (element: string, value: EditFieldValue) => void;
}

interface FieldRenderCtx {
  readonly label: string;
  readonly element: string;
  readonly access: FieldAccessEntry;
  readonly value: EditFieldValue;
  readonly onChange: (element: string, value: EditFieldValue) => void;
  readonly disabled: boolean;
  readonly required: boolean;
  readonly internalType: string;
  readonly display: string;
  readonly maxLength: number | undefined;
  readonly referenceTable: string;
}

function renderDateTimePicker(ctx: FieldRenderCtx): ReactNode {
  const { label, element, onChange, disabled, required, internalType, display } = ctx;
  if (internalType === 'glide_date') {
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <div className={pickerShellClass(disabled)}>
          <Calendar className="w-4 h-4 text-gray-400 shrink-0 pointer-events-none" />
          <input
            type="date"
            value={toDateInput(display)}
            disabled={disabled}
            onChange={e => onChange(element, e.target.value)}
            className="flex-1 typo-body bg-transparent outline-none min-w-0 disabled:cursor-not-allowed"
          />
        </div>
      </div>
    );
  }
  if (internalType === 'glide_date_time' || internalType === 'due_date') {
    const { date, time } = splitDateTime(display);
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <div className="flex flex-wrap gap-2">
          <div className={`${pickerShellClass(disabled)} flex-1 min-w-[140px]`}>
            <Calendar className="w-4 h-4 text-gray-400 shrink-0 pointer-events-none" />
            <input
              type="date"
              value={date}
              disabled={disabled}
              onChange={e => onChange(element, joinDateTime(e.target.value, time))}
              className="flex-1 typo-body bg-transparent outline-none min-w-0 disabled:cursor-not-allowed"
            />
          </div>
          <div className={`${pickerShellClass(disabled)} w-[130px] shrink-0`}>
            <Clock className="w-4 h-4 text-gray-400 shrink-0 pointer-events-none" />
            <input
              type="time"
              value={time}
              disabled={disabled}
              onChange={e => onChange(element, joinDateTime(date, e.target.value))}
              className="flex-1 typo-body bg-transparent outline-none min-w-0 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <EditFieldLabel label={label} required={required} />
      <div className={pickerShellClass(disabled)}>
        <Clock className="w-4 h-4 text-gray-400 shrink-0 pointer-events-none" />
        <input
          type="time"
          value={toTimeInput(display)}
          disabled={disabled}
          onChange={e => onChange(element, fromTimeInput(e.target.value))}
          className="flex-1 typo-body bg-transparent outline-none min-w-0 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  );
}

function renderNumericInput(ctx: FieldRenderCtx): ReactNode {
  const { label, element, onChange, disabled, required, internalType, display } = ctx;
  if (internalType === 'integer' || internalType === 'long') {
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <input type="number" step="1" value={display} disabled={disabled}
          onChange={e => onChange(element, e.target.value)} className={inputClass(disabled)} />
      </div>
    );
  }
  if (internalType === 'float' || internalType === 'decimal' || internalType === 'currency') {
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <input type="number" step="any" value={display} disabled={disabled}
          onChange={e => onChange(element, e.target.value)} className={inputClass(disabled)} />
      </div>
    );
  }
  if (internalType === 'percent_complete') {
    const num = Math.min(100, Math.max(0, Number.parseInt(display, 10) || 0));
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <div className="flex items-center gap-3">
          <input type="range" min={0} max={100} value={num} disabled={disabled}
            onChange={e => onChange(element, e.target.value)} className="flex-1 disabled:opacity-60" />
          <span className="typo-body w-10 text-right tabular-nums">{num}%</span>
        </div>
      </div>
    );
  }
  const colorVal = display.startsWith('#') ? display : '#000000';
  return (
    <div className="min-w-0">
      <EditFieldLabel label={label} required={required} />
      <div className="flex items-center gap-2">
        <input type="color" value={colorVal} disabled={disabled}
          onChange={e => onChange(element, e.target.value)}
          className="h-9 w-12 rounded border border-gray-300 disabled:opacity-60" />
        <input type="text" value={display} disabled={disabled}
          onChange={e => onChange(element, e.target.value)}
          className={`${inputClass(disabled)} flex-1 font-mono typo-body`} />
      </div>
    </div>
  );
}

function resolveFieldRenderer(ctx: FieldRenderCtx): ReactNode {
  const { label, element, access, value, onChange, disabled, required, internalType, display, maxLength, referenceTable } = ctx;

  if (READONLY_TYPES.has(internalType) || isJournalType(internalType)) {
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <div className={`${inputClass(true)} min-h-[38px] whitespace-pre-wrap break-words`}>
          {display || '—'}
        </div>
      </div>
    );
  }

  if (internalType === 'boolean') {
    const checked = display === 'true' || display === '1';
    return (
      <div className="min-w-0">
        <label className="flex items-center gap-2 typo-field-label">
          <input type="checkbox" checked={checked} disabled={disabled}
            onChange={e => onChange(element, e.target.checked ? 'true' : 'false')}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-400 disabled:opacity-60" />
          <span>
            {label}
            {required && <span className="text-red-600 ml-0.5" aria-hidden="true">*</span>}
          </span>
        </label>
      </div>
    );
  }

  const choices = access.choices ?? [];
  if (choices.length > 0) {
    const current = String(typeof value === 'object' ? value.value : value ?? '');
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <select value={current} disabled={disabled}
          onChange={e => onChange(element, e.target.value)} className={inputClass(disabled)}>
          <option value="">—</option>
          {choices.map(c => <option key={c.value} value={c.value}>{c.label || c.value}</option>)}
        </select>
      </div>
    );
  }

  if (internalType === 'glide_list') {
    return <ListCollectorField label={label} required={required} referenceTable={referenceTable}
      value={value} disabled={disabled} onChange={v => onChange(element, v)} />;
  }
  if (REFERENCE_TYPES.has(internalType)) {
    return <ReferenceAutocomplete label={label} required={required} referenceTable={referenceTable}
      value={value} disabled={disabled} onChange={v => onChange(element, v)} />;
  }
  if (['glide_date', 'glide_date_time', 'due_date', 'glide_time'].includes(internalType)) {
    return renderDateTimePicker(ctx);
  }
  if (['integer', 'long', 'float', 'decimal', 'currency', 'percent_complete', 'color'].includes(internalType)) {
    return renderNumericInput(ctx);
  }
  if (internalType === 'table_name' || internalType === 'GUID' || internalType === 'sys_id') {
    return (
      <div className="min-w-0">
        <EditFieldLabel label={label} required={required} />
        <input type="text" value={display} disabled={disabled}
          onChange={e => onChange(element, e.target.value)}
          className={`${inputClass(disabled)} font-mono typo-body`} />
      </div>
    );
  }

  const inputType = (() => {
    if (internalType === 'email') return 'email';
    if (internalType === 'url') return 'url';
    if (internalType === 'phone_number' || internalType === 'ph_number') return 'tel';
    return 'text';
  })();
  const effectiveMaxLength = maxLength ?? 255;
  const useMultiline = effectiveMaxLength > 255
    || internalType === 'string_full_utf8'
    || internalType === 'translated_text';
  return (
    <div className="min-w-0">
      <EditFieldLabel label={label} required={required} />
      {useMultiline ? (
        <textarea value={display} disabled={disabled} maxLength={maxLength} rows={4}
          onChange={e => onChange(element, e.target.value)}
          className={`${inputClass(disabled)} resize-y min-h-[96px]`} />
      ) : (
        <input type={inputType} value={display} disabled={disabled} maxLength={maxLength}
          onChange={e => onChange(element, e.target.value)} className={inputClass(disabled)} />
      )}
    </div>
  );
}

export default function FormEditField({ label, element, access, value, onChange }: FormEditFieldProps) {
  const disabled = !access.write;
  const required = access.mandatory === true && !disabled;
  const internalType = access.internal_type || 'string';
  const display = editDisplayValue(value);
  const maxLength = access.max_length && access.max_length > 0 ? access.max_length : undefined;
  const referenceTable = access.reference || '';
  return <>{resolveFieldRenderer({ label, element, access, value, onChange, disabled, required, internalType, display, maxLength, referenceTable })}</>;
}

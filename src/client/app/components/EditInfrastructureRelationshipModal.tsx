import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Server, Network, CircuitBoard, Database } from 'lucide-react';
import ReferenceAutocomplete from './ReferenceAutocomplete';
import {
  fetchInfraRelationshipsForEdit,
  addInfraRelationship,
  removeInfraRelationship,
  type InfraRelationshipsByType,
  type InfraRelationshipRow,
} from '../utils/relatedCIs';
import { INFRA_CI_STYLE, type InfraCIType } from '../utils/infraCiStyles';
import { editDisplayValue, editRawValue } from '../utils/editValues';
import type { EditFieldValue } from '../utils/viewFields';

interface Props {
  selectedApp: { sysId: string; name: string };
  onClose: () => void;
  onSaved?: () => void;
}

const SECTION_META: Record<InfraCIType, { title: string; Icon: typeof Server }> = {
  server:   { title: 'Servers',        Icon: Server },
  netgear:  { title: 'Network Gear',   Icon: Network },
  circuit:  { title: 'Circuits',       Icon: CircuitBoard },
  database: { title: 'Databases',      Icon: Database },
};

function emptyRefValue(): EditFieldValue {
  return { value: '', display_value: '' };
}

function InfraPill({
  row,
  ciType,
  canEdit,
  removing,
  onRemove,
}: {
  row: InfraRelationshipRow;
  ciType: InfraCIType;
  canEdit: boolean;
  removing: boolean;
  onRemove: () => void;
}) {
  const style = INFRA_CI_STYLE[ciType];

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs border max-w-full"
      style={{
        backgroundColor: style.bg,
        borderColor: style.border,
        color: style.text,
      }}
    >
      <span className="truncate max-w-[180px]" title={row.ciName}>
        {row.ciName}
      </span>
      {canEdit && (
        <button
          type="button"
          className="ml-0.5 hover:bg-black/10 rounded-full p-px shrink-0 disabled:opacity-50"
          onClick={onRemove}
          disabled={removing}
          title={`Remove ${row.ciName}`}
          aria-label={`Remove ${row.ciName}`}
        >
          {removing
            ? <Loader2 size={10} className="animate-spin" />
            : <X size={10} />}
        </button>
      )}
    </span>
  );
}

function InfraAddRow({
  ciType,
  config,
  relTypesInUse,
  existingIds,
  onAdd,
  disabled,
}: {
  ciType: InfraCIType;
  config: InfraRelationshipsByType['config'];
  relTypesInUse: string[];
  existingIds: Set<string>;
  onAdd: (ciSysId: string, ciName: string, relType: string) => Promise<string | null>;
  disabled?: boolean;
}) {
  const meta = SECTION_META[ciType];
  const [selectedRelType, setSelectedRelType] = useState(config.relType);
  const [addValue, setAddValue] = useState<EditFieldValue>(emptyRefValue);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedRelType(config.relType);
  }, [config.relType]);

  const handleAdd = async () => {
    const ciSysId = editRawValue(addValue);
    const ciName = editDisplayValue(addValue) || ciSysId;
    if (!ciSysId) {
      setError('Select a CI to link.');
      return;
    }
    if (existingIds.has(ciSysId)) {
      setError('This CI is already linked.');
      return;
    }

    setAdding(true);
    setError('');
    const err = await onAdd(ciSysId, ciName, selectedRelType);
    setAdding(false);
    if (err) {
      setError(err);
      return;
    }
    setAddValue(emptyRefValue());
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="flex-1 min-w-[200px]">
          <ReferenceAutocomplete
            label={meta.title.replace(/s$/, '')}
            referenceTable={config.ciTable}
            value={addValue}
            disabled={disabled || adding}
            onChange={setAddValue}
          />
        </div>
        {relTypesInUse.length > 1 && (
          <div className="w-44">
            <label className="block text-[10px] font-semibold text-gray-500 uppercase mb-1">Type</label>
            <select
              value={selectedRelType}
              disabled={disabled || adding}
              onChange={e => setSelectedRelType(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg px-2 py-2 bg-white"
            >
              {relTypesInUse.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        )}
        <button
          type="button"
          disabled={disabled || adding || !editRawValue(addValue)}
          onClick={handleAdd}
          className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 inline-flex items-center gap-1.5"
        >
          {adding && <Loader2 className="w-4 h-4 animate-spin" />}
          Add
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function InfraSection({
  section,
  appSysId,
  canEdit,
  onChanged,
}: {
  section: InfraRelationshipsByType;
  appSysId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { config, rows, relTypesInUse, ciType } = section;
  const meta = SECTION_META[ciType];
  const style = INFRA_CI_STYLE[ciType];
  const Icon = meta.Icon;
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemove = async (relSysId: string) => {
    setRemovingId(relSysId);
    const res = await removeInfraRelationship(relSysId);
    setRemovingId(null);
    if (!res.ok) return;
    onChanged();
  };

  const handleAdd = async (ciSysId: string, _ciName: string, relType: string): Promise<string | null> => {
    const res = await addInfraRelationship(appSysId, config, ciSysId, relType);
    if (!res.ok) return res.error;
    onChanged();
    return null;
  };

  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-4 h-4" style={{ color: style.border }} />
        <label className="text-sm font-semibold text-gray-800">{meta.title}</label>
        <span className="text-[10px] text-gray-400 ml-1">({config.relType})</span>
        {rows.length > 0 && (
          <span className="ml-auto text-[10px] font-medium text-gray-500">{rows.length}</span>
        )}
      </div>

      <div className="border border-gray-200 rounded-lg p-3 mb-2 min-h-[52px] bg-gray-50/50">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No linked {meta.title.toLowerCase()}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {rows.map(row => (
              <InfraPill
                key={row.relSysId}
                row={row}
                ciType={ciType}
                canEdit={canEdit}
                removing={removingId === row.relSysId}
                onRemove={() => handleRemove(row.relSysId)}
              />
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <InfraAddRow
          ciType={ciType}
          config={config}
          relTypesInUse={relTypesInUse}
          existingIds={new Set(rows.map(r => r.ciSysId))}
          onAdd={handleAdd}
        />
      )}
    </div>
  );
}

export default function EditInfrastructureRelationshipModal({
  selectedApp,
  onClose,
  onSaved,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<InfraRelationshipsByType[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchInfraRelationshipsForEdit(selectedApp.sysId);
      setSections(data);
    } catch {
      setSections([]);
    } finally {
      setLoading(false);
    }
  }, [selectedApp.sysId]);

  useEffect(() => { reload(); }, [reload]);

  const handleChanged = () => {
    reload();
    onSaved?.();
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/50">
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Edit Infrastructure Relationships</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">{selectedApp.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-gray-200 rounded-lg text-gray-500"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-gray-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading relationships…</span>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                Add or remove infrastructure CIs linked to this application.
                Changes are applied immediately.
              </p>
              {sections.map(section => (
                <InfraSection
                  key={section.ciType}
                  section={section}
                  appSysId={selectedApp.sysId}
                  canEdit
                  onChanged={handleChanged}
                />
              ))}
            </>
          )}
        </div>

        <div className="px-6 py-3.5 border-t border-gray-200 bg-gray-50 flex justify-end flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

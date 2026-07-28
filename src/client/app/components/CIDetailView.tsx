import { useState, useEffect } from 'react';
import {
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Edit2, MoreHorizontal, ExternalLink, MapPin,
  AlertCircle, Calendar, Activity, Server, Database,
  Network, Shield, User,
  ArrowUpDown, Layers, Loader2,
} from 'lucide-react';
import TaskTrendChart from './TaskTrendChart';
import { fetchCITaskTrend, getLast6MonthBuckets, type TrendMonthPoint } from '../utils/taskTrend';
import { type AppItem } from '../data/appData';
import { queryTable } from '../../api/servicenow';
import {
  loadFormLayout, str, raw, flattenLayoutFields, fetchRecordFieldValues,
  type FormSectionLayout, type FormLayoutRow,
} from '../utils/viewFields';
import { CI_OVERVIEW_VIEW, CI_CONTACT_VIEW, resolveCiSearchParentTable } from '../utils/ciTables';
import { readRecordUrlParams, isCmdbTableName } from '../utils/routing';
import RelatedApplicationsPanel from './RelatedApplicationsPanel';
import RelatedListSection from './RelatedListSection';
import HealthResultsPanel from './HealthResultsPanel';
import { INCIDENT_TASK_CONFIG, CHANGE_TASK_CONFIG, fetchRelatedTaskCount } from '../utils/relatedTasks';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CIItem {
  id: string;
  name: string;
  type: string;
  class: string;
  /** Raw ServiceNow table name (e.g. cmdb_ci_server) used to build the classic record URL */
  table?: string;
  environment: string;
  location: string;
  owner: string;
  supportGroup: string;
  lastModified: string;
  hasIncident: boolean;
  hasChange: boolean;
}

interface CIDetailViewProps {
  ci: CIItem;
  onBack: () => void;
  onSelectApp?: (app: AppItem) => void;
  fromApp?: AppItem | null;
  hierarchyMode?: boolean;
}

// ─── Mock data ────────────────────────────────────────────────────────────────
const getDetail = (ci: CIItem) => ({
  serverType:
    ci.type === 'Server'   ? (ci.class.includes('Windows') ? 'Windows Server' : 'Linux Server')
    : ci.type === 'Database' ? ci.class
    : ci.type === 'Switch'   ? 'Network Switch'
    : ci.type === 'Circuit'  ? 'WAN Circuit'
    : 'Business Service',
  serverOS:  ci.class.split(' ').slice(0, 2).join(' '),
  osVersion: ci.class.match(/[\d.]+/)?.[0] ?? 'N/A',
  status:    'In Use',
  ip:        `10.120.${45 + (ci.name.charCodeAt(0) % 100)}.${19 + (ci.name.charCodeAt(1) % 200)}`,
  cpu:  '32 vCPU',
  ram:  '128 GB',
  disk: '2 TB',
});

// Contact section uses live form layout (CLSA CMDB Workspace Contact).

// Related Applications loaded live via RelatedApplicationsPanel.

// ─── Helpers ──────────────────────────────────────────────────────────────────
function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-900 break-words whitespace-pre-line">{value || '—'}</p>
    </div>
  );
}

/** Pick the best CMDB table hint from URL params or CI props. */
function resolveTableHint(ci: CIItem): string {
  const url = readRecordUrlParams();
  if (isCmdbTableName(url?.table)) return url!.table;
  if (isCmdbTableName(ci.table)) return ci.table!;
  if (isCmdbTableName(ci.class)) return ci.class;
  return 'cmdb_ci';
}

/** Resolve sys_id + table for a CI record (refresh / deep-link safe). */
async function resolveRecordContext(
  ci: CIItem,
): Promise<{ sysId: string; recordTable: string; name: string }> {
  const url = readRecordUrlParams();
  const sysId = url?.sysId ?? ci.id;
  const tableHint = resolveTableHint(ci);
  const tablesToTry = [...new Set([tableHint, 'cmdb_ci'])];

  for (const table of tablesToTry) {
    const { result } = await queryTable<Record<string, unknown>>({
      table,
      query: `sys_id=${sysId}`,
      fields: ['sys_id', 'name', 'sys_class_name'],
      displayValue: false,
      limit: 1,
    });
    const rec = result?.[0];
    if (!rec) continue;

    const className = raw(rec.sys_class_name);
    const recordTable = isCmdbTableName(className) ? className : table;

    return {
      sysId,
      recordTable,
      name: str(rec.name) || ci.name,
    };
  }

  // Record lookup failed — still render using props / URL hints.
  return { sysId, recordTable: tableHint, name: ci.name };
}

function CollapsibleFormSection({
  caption,
  defaultOpen = true,
  isFirst,
  children,
}: {
  caption: string | null;
  defaultOpen?: boolean;
  isFirst?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!caption) {
    return (
      <div className={isFirst ? '' : 'pt-4 border-t border-gray-100'}>
        {children}
      </div>
    );
  }

  return (
    <div className={isFirst ? '' : 'pt-4 border-t border-gray-100'}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 mb-3 py-1 hover:bg-gray-50 rounded transition-colors"
      >
        <div className="flex items-center gap-2 text-base font-semibold text-gray-800">
          <span className="w-1 h-4 bg-blue-600 rounded-full shrink-0" />
          {caption}
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && children}
    </div>
  );
}

function FormOverviewBlock({
  sections,
  values,
  loading,
  embedded = false,
  emptyMessage = 'No overview fields configured.',
  loadingMessage = 'Loading overview…',
}: {
  sections: FormSectionLayout[];
  values: Record<string, string>;
  loading: boolean;
  embedded?: boolean;
  emptyMessage?: string;
  loadingMessage?: string;
}) {
  const renderRow = (row: FormLayoutRow, key: string) => {
    if (row.kind === 'full') {
      return (
        <div key={key} className="col-span-2">
          <ReadonlyField label={row.field.label} value={values[row.field.element] ?? ''} />
        </div>
      );
    }
    return (
      <div key={key} className="col-span-2 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <div className="space-y-4">
          {row.left.map(f => (
            <ReadonlyField key={f.element} label={f.label} value={values[f.element] ?? ''} />
          ))}
        </div>
        <div className="space-y-4">
          {row.right.map(f => (
            <ReadonlyField key={f.element} label={f.label} value={values[f.element] ?? ''} />
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`${embedded ? '' : 'mt-4 pt-4 border-t border-gray-100'} flex items-center justify-center py-8 text-gray-400 gap-2 text-sm`}>
        <Loader2 className="w-4 h-4 animate-spin" /> {loadingMessage}
      </div>
    );
  }
  if (!sections.length) {
    return (
      <p className={`${embedded ? '' : 'mt-4 pt-4 border-t border-gray-100'} text-sm text-gray-400 italic`}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={`${embedded ? '' : 'mt-4 pt-4 border-t border-gray-100'} space-y-0`}>
      {sections.map((sec, idx) => (
        <CollapsibleFormSection key={idx} caption={sec.caption} isFirst={idx === 0}>
          <div className="grid grid-cols-2 gap-y-4">
            {sec.rows.map((row, rowIdx) => renderRow(row, `${idx}-${rowIdx}`))}
          </div>
        </CollapsibleFormSection>
      ))}
    </div>
  );
}

// ─── Collapsible Section ──────────────────────────────────────────────────────
function Section({ title, icon, defaultOpen = true, children }: {
  title: string; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <span className="w-1 h-4 bg-blue-600 rounded-full" />
          {icon}
          {title}
        </div>
        {open
          ? <ChevronUp   className="w-4 h-4 text-gray-400" />
          : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="border-t border-gray-100">{children}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function CIDetailView({ ci, onBack, onSelectApp, fromApp, hierarchyMode = true }: CIDetailViewProps) {
  const detail  = getDetail(ci);
  const isServer = ci.type === 'Server';
  const [taskTab, setTaskTab] = useState<'incidents' | 'changes'>('incidents');
  const [incidentCount, setIncidentCount] = useState(0);
  const [changeCount, setChangeCount] = useState(0);
  const [trendData, setTrendData] = useState<TrendMonthPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [showEditModal, setShowEditModal] = useState(false);
  const [displayName, setDisplayName] = useState(ci.name);
  const [formSections, setFormSections] = useState<FormSectionLayout[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [contactSections, setContactSections] = useState<FormSectionLayout[]>([]);
  const [contactValues, setContactValues] = useState<Record<string, string>>({});
  const [contactLoading, setContactLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setOverviewLoading(true);
    setContactLoading(true);
    setFormSections([]);
    setFieldValues({});
    setContactSections([]);
    setContactValues({});
    setDisplayName(ci.name);

    resolveRecordContext(ci)
      .then(async ctx => {
        if (cancelled) return;
        if (!ctx.sysId) {
          setFormSections([]);
          setFieldValues({});
          setContactSections([]);
          setContactValues({});
          return;
        }

        setDisplayName(ctx.name);

        const [overviewLayout, contactLayout] = await Promise.all([
          loadFormLayout(ctx.recordTable, CI_OVERVIEW_VIEW, resolveCiSearchParentTable),
          loadFormLayout(ctx.recordTable, CI_CONTACT_VIEW, resolveCiSearchParentTable),
        ]);
        if (cancelled) return;

        setFormSections(overviewLayout.sections);
        setContactSections(contactLayout.sections);

        const overviewElements = flattenLayoutFields(overviewLayout.sections);
        const contactElements = flattenLayoutFields(contactLayout.sections);
        const allElements = [...new Set(['name', ...overviewElements, ...contactElements])];
        if (allElements.length <= 1 && !overviewElements.length && !contactElements.length) return;

        const vals = await fetchRecordFieldValues(ctx.recordTable, ctx.sysId, allElements);
        if (cancelled) return;

        setDisplayName(vals.name || ctx.name);

        const overviewVals: Record<string, string> = {};
        for (const el of overviewElements) overviewVals[el] = vals[el] ?? '';

        const contactVals: Record<string, string> = {};
        for (const el of contactElements) contactVals[el] = vals[el] ?? '';

        setFieldValues(overviewVals);
        setContactValues(contactVals);
      })
      .catch(() => {
        if (!cancelled) {
          setFormSections([]);
          setFieldValues({});
          setContactSections([]);
          setContactValues({});
        }
      })
      .finally(() => {
        if (!cancelled) {
          setOverviewLoading(false);
          setContactLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [ci.id, ci.table, ci.class, ci.name]);

  useEffect(() => {
    if (!ci.id) {
      setIncidentCount(0);
      setChangeCount(0);
      return;
    }
    fetchRelatedTaskCount(ci.id, INCIDENT_TASK_CONFIG).then(setIncidentCount).catch(() => setIncidentCount(0));
    fetchRelatedTaskCount(ci.id, CHANGE_TASK_CONFIG).then(setChangeCount).catch(() => setChangeCount(0));
  }, [ci.id]);

  useEffect(() => {
    let cancelled = false;
    setTrendLoading(true);
    fetchCITaskTrend(ci.id)
      .then(data => { if (!cancelled) setTrendData(data); })
      .catch(() => {
        if (!cancelled) {
          setTrendData(getLast6MonthBuckets().map(b => ({
            month: b.label,
            monthKey: b.monthKey,
            incidents: 0,
            changes: 0,
            incidentListUrl: `/incident_list.do`,
            changeListUrl: `/change_request_list.do`,
          })));
        }
      })
      .finally(() => { if (!cancelled) setTrendLoading(false); });
    return () => { cancelled = true; };
  }, [ci.id]);

  return (
    <div className="p-6 space-y-4">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500 flex-wrap">
        <button onClick={onBack} className="hover:text-blue-600 transition-colors">Home</button>
        <ChevronRight className="w-4 h-4 flex-shrink-0" />
        {fromApp ? (
          <>
            <button onClick={onBack} className="hover:text-blue-600 transition-colors">Application Mapping</button>
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
            <button onClick={onBack} className="hover:text-blue-600 transition-colors">{fromApp.name}</button>
          </>
        ) : (
          <button onClick={onBack} className="hover:text-blue-600 transition-colors">CI Search</button>
        )}
        <ChevronRight className="w-4 h-4 flex-shrink-0" />
        <span className="text-gray-900 font-medium">{displayName}</span>
      </div>

      {/* ── CI Header card ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900">{displayName}</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {detail.status}
            </span>
            {ci.hasIncident && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs">
                <AlertCircle className="w-3 h-3" /> Active Incident
              </span>
            )}
            {ci.hasChange && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 text-xs">
                <Calendar className="w-3 h-3" /> Upcoming Change
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {isServer && (
              <button className="flex items-center gap-1.5 px-3 py-1.5 border border-orange-300 text-orange-700 rounded-lg text-sm hover:bg-orange-50 transition-colors">
                <Activity className="w-4 h-4" /> Grafana
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
            <a
              href={`/${ci.table || 'cmdb_ci'}.do?sys_id=${ci.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg text-sm hover:bg-indigo-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Open in ServiceNow
            </a>
            <button onClick={() => setShowEditModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              <Edit2 className="w-4 h-4" /> Edit
            </button>
            <button className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        <FormOverviewBlock
          sections={formSections}
          values={fieldValues}
          loading={overviewLoading}
        />
      </div>

      {/* ── Contact Information ── */}
      <Section title="Contact Information" icon={<User className="w-4 h-4 text-blue-500" />}>
        <div className="p-5">
          <FormOverviewBlock
            embedded
            sections={contactSections}
            values={contactValues}
            loading={contactLoading}
            emptyMessage="No contact fields configured."
            loadingMessage="Loading contact information…"
          />
        </div>
      </Section>

      {/* ── Related Applications ── */}
      <Section title="Related Applications" icon={<Layers className="w-4 h-4 text-blue-500" />}>
        <RelatedApplicationsPanel
          ciSysId={ci.id}
          hierarchyMode={hierarchyMode}
          onSelectApp={onSelectApp}
        />
      </Section>

      {/* ── Incidents & Changes ── */}
      <Section title="Related Incidents & Changes" icon={<AlertCircle className="w-4 h-4 text-blue-500" />}>
        <div className="p-5">
          <div className="flex gap-2 mb-4">
            <button
              type="button"
              onClick={() => setTaskTab('incidents')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${taskTab === 'incidents' ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
              Incidents ({incidentCount})
            </button>
            <button
              type="button"
              onClick={() => setTaskTab('changes')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${taskTab === 'changes' ? 'bg-yellow-100 text-yellow-700' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Calendar className="w-3.5 h-3.5 inline mr-1" />
              Changes ({changeCount})
            </button>
          </div>

          {taskTab === 'incidents' ? (
            <RelatedListSection
              embedded
              config={INCIDENT_TASK_CONFIG}
              recordSysId={ci.id}
              variant="cards"
              isOpen
              onToggle={() => {}}
              title="Active Incidents"
              Icon={AlertCircle}
              iconBg="bg-red-100"
              iconColor="text-red-600"
              badgeBg="bg-red-50"
              badgeText="text-red-700"
              badgeBorder="border-red-200"
              emptyMessage="No active incidents linked to this CI."
            />
          ) : (
            <RelatedListSection
              embedded
              config={CHANGE_TASK_CONFIG}
              recordSysId={ci.id}
              variant="cards"
              isOpen
              onToggle={() => {}}
              title="Change Requests"
              Icon={Calendar}
              iconBg="bg-amber-100"
              iconColor="text-amber-600"
              badgeBg="bg-amber-50"
              badgeText="text-amber-700"
              badgeBorder="border-amber-200"
              emptyMessage="No approved change requests linked to this CI."
            />
          )}
        </div>
      </Section>

      {/* ── Trend Chart ── */}
      <Section title="Incident & Change Trend (Last 6 Months)" icon={<Activity className="w-4 h-4 text-blue-500" />}>
        <div className="p-5">
          {trendLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2 text-sm">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading trend…
            </div>
          ) : trendData.length === 0 ? (
            <p className="text-sm text-gray-400 italic text-center py-16">No trend data available.</p>
          ) : (
            <>
              <TaskTrendChart data={trendData} />
              <p className="text-xs text-gray-400 text-center mt-3">
                Click a data point to open the filtered list in ServiceNow.
              </p>
            </>
          )}
        </div>
      </Section>

      {/* ── CMDB Health ── */}
      <Section title="CMDB Health Metrics" icon={<Shield className="w-4 h-4 text-blue-500" />} defaultOpen={false}>
        <div className="p-5">
          <HealthResultsPanel ciSysId={ci.id} />
        </div>
      </Section>

      {/* ── Edit modal ── */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Edit CI</h2>
            <p className="text-sm text-gray-500 mb-5">Update the attributes of <span className="font-medium">{ci.name}</span></p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Environment</label>
                <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" defaultValue={ci.environment}>
                  <option>Production</option><option>Non-production</option><option>DR</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Owner</label>
                <input type="text" defaultValue={ci.owner} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Support Group</label>
                <input type="text" defaultValue={ci.supportGroup} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => setShowEditModal(false)} className="px-4 py-2 bg-blue-900 text-white rounded-lg text-sm hover:bg-blue-800">Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

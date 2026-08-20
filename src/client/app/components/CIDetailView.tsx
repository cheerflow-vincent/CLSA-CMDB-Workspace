import { useState, useEffect, useCallback } from 'react';
import {
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Edit2, ExternalLink, MapPin,
  AlertCircle, Calendar, Activity, Server, Database,
  Network, Shield, User,
  ArrowUpDown, Loader2, RefreshCw,
} from 'lucide-react';
import TaskTrendChart from './TaskTrendChart';
import { fetchCITaskTrend, getLast6MonthBuckets, type TrendMonthPoint } from '../utils/taskTrend';
import { type AppItem } from '../data/appData';
import { queryTable, fetchFieldAccess, getSysProperties, getTableLabel, APP_SCOPE, type TableAccess } from '../../api/servicenow';
import { filterFormSections, isAccessDenied, canEditRecord } from '../utils/acl';
import RecordEditDialog from './recordEdit/RecordEditDialog';
import {
  loadFormLayout, str, raw, flattenLayoutFields, fetchRecordFieldValues,
  type FormSectionLayout, type FormLayoutRow,
} from '../utils/viewFields';
import { CI_OVERVIEW_VIEW, CI_CONTACT_VIEW, resolveCiSearchParentTable } from '../utils/ciTables';
import { readRecordUrlParams, isCmdbTableName } from '../utils/routing';
import RelatedListSection from './RelatedListSection';
import HealthResultsPanel from './HealthResultsPanel';
import CiRelatedComponentsSection, {
  shouldShowRelatedComponents,
  RelatedComponentsSectionIcon,
} from './CiRelatedComponentsSection';
import { INCIDENT_TASK_CONFIG, CHANGE_TASK_CONFIG, fetchRelatedTaskCount } from '../utils/relatedTasks';
import CollapsibleFormSection from './formLayout/CollapsibleFormSection';

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
  onViewCI?: (ci: CIItem) => void;
  fromApp?: AppItem | null;
  hierarchyMode?: boolean;
  sidebarCollapsed?: boolean;
}

// ─── Mock data ────────────────────────────────────────────────────────────────
const getDetail = (ci: CIItem) => ({
  serverType:
    ci.type === 'Server'   ? (ci.class.includes('Windows') ? 'Windows Server' : 'Linux Server')
    : ci.type === 'Database' ? ci.class
    : ci.type === 'Switch'   ? 'Network Switch'
    : ci.type === 'Network Link' ? 'Network Link'
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
    <div className="rf-field-row min-w-0 mb-0">
      <span className="rf-field-row__label">{label}</span>
      <span className="rf-field-row__value font-medium text-gray-900">{value || '—'}</span>
    </div>
  );
}

function grafanaPropertyName(table: string): string {
  return `${APP_SCOPE}.grafana.url.${table}`;
}

/** Substitute `{0}` in a Grafana URL template with the CI name. */
function buildGrafanaUrl(template: string, ciName: string): string {
  return template.replace(/\{0\}/g, encodeURIComponent(ciName));
}

function formatClassLabel(cls: string): string {
  return cls.replace(/^cmdb_ci_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function initialClassLabel(ci: CIItem): string {
  if (ci.class && !isCmdbTableName(ci.class)) return ci.class;
  if (isCmdbTableName(ci.table)) return formatClassLabel(ci.table);
  if (isCmdbTableName(ci.class)) return formatClassLabel(ci.class);
  return ci.type || '';
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
      if (!(row.field.element in values)) return null;
      return (
        <div key={key} className="col-span-2">
          <ReadonlyField label={row.field.label} value={values[row.field.element] ?? ''} />
        </div>
      );
    }
    const left = row.left.filter(f => f.element in values);
    const right = row.right.filter(f => f.element in values);
    if (!left.length && !right.length) return null;
    return (
      <div key={key} className="form-split-row">
        <div className="space-y-4">
          {left.map(f => (
            <ReadonlyField key={f.element} label={f.label} value={values[f.element] ?? ''} />
          ))}
        </div>
        <div className="space-y-4">
          {right.map(f => (
            <ReadonlyField key={f.element} label={f.label} value={values[f.element] ?? ''} />
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className={`${embedded ? '' : 'mt-4 pt-4 border-t border-gray-100'} flex items-center justify-center py-8 text-gray-400 gap-2 typo-body`}>
        <Loader2 className="w-4 h-4 animate-spin" /> {loadingMessage}
      </div>
    );
  }
  const visibleSections = filterFormSections(sections, values);
  if (!visibleSections.length) {
    return (
      <p className={`${embedded ? '' : 'mt-4 pt-4 border-t border-gray-100'} typo-body text-gray-400 italic`}>
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className={`${embedded ? '' : 'mt-4 pt-4 border-t border-gray-100'} space-y-0`}>
      {visibleSections.map((sec, idx) => (
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
        <div className="flex items-center gap-2 typo-section-title">
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
export default function CIDetailView({
  ci,
  onBack,
  onSelectApp,
  onViewCI,
  fromApp,
  hierarchyMode = true,
  sidebarCollapsed = false,
}: CIDetailViewProps) {
  const detail  = getDetail(ci);
  const [opsTab, setOpsTab] = useState<'trend' | 'tasks'>('trend');
  const [taskTab, setTaskTab] = useState<'incidents' | 'changes'>('incidents');
  const [incidentCount, setIncidentCount] = useState(0);
  const [changeCount, setChangeCount] = useState(0);
  const [trendData, setTrendData] = useState<TrendMonthPoint[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [showRecordEditModal, setShowRecordEditModal] = useState(false);
  const [canWriteRecord, setCanWriteRecord] = useState(false);
  const [recordSysId, setRecordSysId] = useState('');
  const [recordTable, setRecordTable] = useState('');
  const [pageRefreshKey, setPageRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [displayName, setDisplayName] = useState(ci.name);
  const [displayClassLabel, setDisplayClassLabel] = useState(() => initialClassLabel(ci));
  const [grafanaUrl, setGrafanaUrl] = useState<string | null>(null);
  const [formSections, setFormSections] = useState<FormSectionLayout[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [contactSections, setContactSections] = useState<FormSectionLayout[]>([]);
  const [contactValues, setContactValues] = useState<Record<string, string>>({});
  const [contactLoading, setContactLoading] = useState(true);
  const [recordAccess, setRecordAccess] = useState<TableAccess>('ok');
  const [incidentAccess, setIncidentAccess] = useState<TableAccess>('ok');
  const [changeAccess, setChangeAccess] = useState<TableAccess>('ok');
  const [trendAccess, setTrendAccess] = useState<TableAccess>('ok');
  const [healthAccess, setHealthAccess] = useState<TableAccess>('ok');
  const [relatedAppsAccess, setRelatedAppsAccess] = useState<TableAccess>('ok');
  const [infraAccess, setInfraAccess] = useState<TableAccess>('ok');

  useEffect(() => {
    let cancelled = false;
    setOverviewLoading(true);
    setContactLoading(true);
    setFormSections([]);
    setFieldValues({});
    setContactSections([]);
    setContactValues({});
    setDisplayName(ci.name);
    setDisplayClassLabel(initialClassLabel(ci));
    setCanWriteRecord(false);
    setRecordSysId('');
    setRecordTable('');

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

        setRecordSysId(ctx.sysId);
        setRecordTable(ctx.recordTable);
        setDisplayName(ctx.name);

        getTableLabel(ctx.recordTable)
          .then(label => {
            if (!cancelled && label) setDisplayClassLabel(label);
          })
          .catch(() => {
            if (!cancelled) setDisplayClassLabel(formatClassLabel(ctx.recordTable));
          });

        fetchFieldAccess(ctx.recordTable, ctx.sysId, ['name'])
          .then(access => { if (!cancelled) setCanWriteRecord(canEditRecord(access)); })
          .catch(() => { if (!cancelled) setCanWriteRecord(false); });

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

        const { values: vals, access: recordFetchAccess } = await fetchRecordFieldValues(
          ctx.recordTable, ctx.sysId, allElements,
        );
        if (cancelled) return;

        setRecordAccess(recordFetchAccess);
        setDisplayName(vals.name || ctx.name);

        const overviewVals: Record<string, string> = {};
        for (const el of overviewElements) {
          if (el in vals) overviewVals[el] = vals[el];
        }

        const contactVals: Record<string, string> = {};
        for (const el of contactElements) {
          if (el in vals) contactVals[el] = vals[el];
        }

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
  }, [ci.id, ci.table, ci.class, ci.name, pageRefreshKey]);

  useEffect(() => {
    const table = recordTable || resolveTableHint(ci);
    if (!table || !displayName) {
      setGrafanaUrl(null);
      return;
    }
    let cancelled = false;
    const propName = grafanaPropertyName(table);
    getSysProperties([propName])
      .then(props => {
        if (cancelled) return;
        const template = props[propName]?.trim();
        setGrafanaUrl(template ? buildGrafanaUrl(template, displayName) : null);
      })
      .catch(() => {
        if (!cancelled) setGrafanaUrl(null);
      });
    return () => { cancelled = true; };
  }, [recordTable, displayName, ci, pageRefreshKey]);

  const refreshPage = useCallback(() => {
    setRefreshing(true);
    setPageRefreshKey(n => n + 1);
    window.setTimeout(() => setRefreshing(false), 600);
  }, []);

  useEffect(() => {
    if (!ci.id) {
      setIncidentCount(0);
      setChangeCount(0);
      return;
    }
    fetchRelatedTaskCount(ci.id, INCIDENT_TASK_CONFIG)
      .then(r => { setIncidentCount(r.totalCount); setIncidentAccess(r.access); })
      .catch(() => { setIncidentCount(0); setIncidentAccess('error'); });
    fetchRelatedTaskCount(ci.id, CHANGE_TASK_CONFIG)
      .then(r => { setChangeCount(r.totalCount); setChangeAccess(r.access); })
      .catch(() => { setChangeCount(0); setChangeAccess('error'); });
  }, [ci.id, pageRefreshKey]);

  const showTaskSection = !isAccessDenied(incidentAccess) || !isAccessDenied(changeAccess);

  useEffect(() => {
    if (isAccessDenied(incidentAccess) && taskTab === 'incidents' && !isAccessDenied(changeAccess)) {
      setTaskTab('changes');
    } else if (isAccessDenied(changeAccess) && taskTab === 'changes' && !isAccessDenied(incidentAccess)) {
      setTaskTab('incidents');
    }
  }, [incidentAccess, changeAccess, taskTab]);

  useEffect(() => {
    if (isAccessDenied(trendAccess) && opsTab === 'trend' && showTaskSection) {
      setOpsTab('tasks');
    } else if (!showTaskSection && opsTab === 'tasks' && !isAccessDenied(trendAccess)) {
      setOpsTab('trend');
    }
  }, [trendAccess, showTaskSection, opsTab]);

  useEffect(() => {
    let cancelled = false;
    setTrendLoading(true);
    fetchCITaskTrend(ci.id)
      .then(({ points, access }) => {
        if (!cancelled) {
          setTrendData(points);
          setTrendAccess(access);
        }
      })
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
          setTrendAccess('error');
        }
      })
      .finally(() => { if (!cancelled) setTrendLoading(false); });
    return () => { cancelled = true; };
  }, [ci.id, pageRefreshKey]);

  const showOverviewSection =
    !isAccessDenied(recordAccess)
    && (overviewLoading || filterFormSections(formSections, fieldValues).length > 0);

  const showContactSection =
    !isAccessDenied(recordAccess)
    && (contactLoading || filterFormSections(contactSections, contactValues).length > 0);

  const showOpsSection =
    !isAccessDenied(trendAccess) || showTaskSection;

  const operationalSection = showOpsSection && (
    <Section title="Operational Activity" icon={<Activity className="w-4 h-4 text-blue-500" />}>
      <div className="p-5">
        <div className="flex gap-2 mb-4 flex-wrap">
          {!isAccessDenied(trendAccess) && (
            <button
              type="button"
              onClick={() => setOpsTab('trend')}
              className={`px-4 py-1.5 rounded-full typo-body font-medium transition-colors ${opsTab === 'trend' ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Activity className="w-3.5 h-3.5 inline mr-1" />
              Trend
            </button>
          )}
          {showTaskSection && (
            <button
              type="button"
              onClick={() => setOpsTab('tasks')}
              className={`px-4 py-1.5 rounded-full typo-body font-medium transition-colors ${opsTab === 'tasks' ? 'bg-gray-200 text-gray-800' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
              Incidents & Changes
            </button>
          )}
        </div>

        {opsTab === 'trend' && !isAccessDenied(trendAccess) ? (
          trendLoading ? (
            <div className="flex items-center justify-center py-16 text-gray-400 gap-2 typo-body">
              <Loader2 className="w-5 h-5 animate-spin" /> Loading trend…
            </div>
          ) : trendData.length === 0 ? (
            <p className="typo-body text-gray-400 italic text-center py-16">No trend data available.</p>
          ) : (
            <>
              <TaskTrendChart data={trendData} />
              <p className="typo-caption text-center mt-3">
                Click a data point to open the filtered list in ServiceNow.
              </p>
            </>
          )
        ) : showTaskSection ? (
          <>
            <div className="flex gap-2 mb-4 flex-wrap">
              {!isAccessDenied(incidentAccess) && (
                <button
                  type="button"
                  onClick={() => setTaskTab('incidents')}
                  className={`px-4 py-1.5 rounded-full typo-body font-medium transition-colors ${taskTab === 'incidents' ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
                  Incidents ({incidentCount})
                </button>
              )}
              {!isAccessDenied(changeAccess) && (
                <button
                  type="button"
                  onClick={() => setTaskTab('changes')}
                  className={`px-4 py-1.5 rounded-full typo-body font-medium transition-colors ${taskTab === 'changes' ? 'bg-yellow-100 text-yellow-700' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                  <Calendar className="w-3.5 h-3.5 inline mr-1" />
                  Changes ({changeCount})
                </button>
              )}
            </div>

            {taskTab === 'incidents' && !isAccessDenied(incidentAccess) ? (
              <RelatedListSection
                embedded
                config={INCIDENT_TASK_CONFIG}
                recordSysId={ci.id}
                refreshKey={pageRefreshKey}
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
                recordContext="ci"
              />
            ) : (
              <RelatedListSection
                embedded
                config={CHANGE_TASK_CONFIG}
                recordSysId={ci.id}
                refreshKey={pageRefreshKey}
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
                recordContext="ci"
              />
            )}
          </>
        ) : null}
      </div>
    </Section>
  );

  const relatedComponentsSection = shouldShowRelatedComponents(relatedAppsAccess, infraAccess) && (
    <Section title="Related Components" icon={<RelatedComponentsSectionIcon />}>
      <CiRelatedComponentsSection
        ci={ci}
        hierarchyMode={hierarchyMode}
        onSelectApp={onSelectApp}
        onViewCI={onViewCI}
        refreshKey={pageRefreshKey}
        canEditCenterRecord={canWriteRecord}
        onEditCiDetails={() => setShowRecordEditModal(true)}
        onAppsAccessResolved={setRelatedAppsAccess}
        onInfraAccessResolved={setInfraAccess}
      />
    </Section>
  );

  const healthSection = !isAccessDenied(healthAccess) && (
    <Section title="CMDB Health Metrics" icon={<Shield className="w-4 h-4 text-blue-500" />} defaultOpen={false}>
      <div className="p-5">
        <HealthResultsPanel ciSysId={ci.id} onAccessResolved={setHealthAccess} refreshKey={pageRefreshKey} />
      </div>
    </Section>
  );

  const hasLeftColumn = showOverviewSection || showContactSection;
  const bodyLayoutClass = !hasLeftColumn
    ? ''
    : sidebarCollapsed
      ? 'lg:flex-row lg:items-start'
      : 'xl:flex-row xl:items-start';
  const bodyGapClass = !hasLeftColumn
    ? ''
    : sidebarCollapsed
      ? 'lg:gap-6'
      : 'xl:gap-6';
  const leftColClass = !hasLeftColumn
    ? ''
    : sidebarCollapsed
      ? 'lg:w-[38%] lg:max-w-xl lg:shrink-0 lg:sticky lg:top-4 lg:self-start'
      : 'xl:w-[38%] xl:max-w-xl xl:shrink-0 xl:sticky xl:top-4 xl:self-start';
  const headerCountChipClass = sidebarCollapsed ? 'hidden lg:inline-flex' : 'hidden xl:inline-flex';

  return (
    <div className="p-4 sm:p-6 space-y-4">

      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-1.5 typo-page-subtitle flex-wrap">
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

      {/* ── CI Header (identity + actions only) ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="typo-page-title">{displayName}</h1>
            {displayClassLabel && (
              <p className="typo-page-subtitle mt-1 mb-2">{displayClassLabel}</p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-100 text-green-700 typo-badge">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {detail.status}
              </span>
              {ci.hasIncident && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 typo-badge">
                  <AlertCircle className="w-3 h-3" /> Active Incident
                </span>
              )}
              {ci.hasChange && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 typo-badge">
                  <Calendar className="w-3 h-3" /> Upcoming Change
                </span>
              )}
              {showTaskSection && !isAccessDenied(incidentAccess) && incidentCount > 0 && (
                <span className={`${headerCountChipClass} items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 typo-badge border border-red-200`}>
                  <AlertCircle className="w-3 h-3" /> {incidentCount} incident{incidentCount !== 1 ? 's' : ''}
                </span>
              )}
              {showTaskSection && !isAccessDenied(changeAccess) && changeCount > 0 && (
                <span className={`${headerCountChipClass} items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 typo-badge border border-yellow-200`}>
                  <Calendar className="w-3 h-3" /> {changeCount} change{changeCount !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              onClick={refreshPage}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg typo-body hover:bg-gray-50 transition-colors disabled:opacity-60"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <a
              href={`/${recordTable || resolveTableHint(ci)}.do?sys_id=${recordSysId || ci.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-indigo-300 text-indigo-700 rounded-lg typo-body hover:bg-indigo-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> Open in ServiceNow
            </a>
            {canWriteRecord && (
              <button
                type="button"
                onClick={() => setShowRecordEditModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-blue-300 text-blue-700 rounded-lg typo-body hover:bg-blue-50 transition-colors"
              >
                <Edit2 className="w-4 h-4" /> Edit
              </button>
            )}
            {grafanaUrl && (
              <a
                href={grafanaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-orange-300 text-orange-700 rounded-lg typo-body hover:bg-orange-50 transition-colors"
              >
                <Activity className="w-4 h-4" /> Grafana
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-column body (stacked until viewport fits sidebar + panes) ── */}
      <div className={`flex flex-col gap-4 ${bodyGapClass} ${bodyLayoutClass}`}>
        {hasLeftColumn && (
        <div className={`detail-pane space-y-4 ${leftColClass}`}>
          {showOverviewSection && (
            <Section title="Record Overview" icon={<Server className="w-4 h-4 text-blue-500" />}>
              <div className="p-5">
                <FormOverviewBlock
                  embedded
                  sections={formSections}
                  values={fieldValues}
                  loading={overviewLoading}
                  emptyMessage="No overview fields configured."
                  loadingMessage="Loading overview…"
                />
              </div>
            </Section>
          )}

          {showContactSection && (
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
          )}
        </div>
        )}

        {/* Operational & related */}
        <div className="detail-pane flex-1 min-w-0 space-y-4">
          {operationalSection}
          {relatedComponentsSection}
          {healthSection}
        </div>
      </div>

      {showRecordEditModal && recordSysId && recordTable && (
        <RecordEditDialog
          title="Edit CI"
          table={recordTable}
          sysId={recordSysId}
          recordName={displayName}
          onClose={() => setShowRecordEditModal(false)}
          onSaved={() => setPageRefreshKey(n => n + 1)}
        />
      )}
    </div>
  );
}

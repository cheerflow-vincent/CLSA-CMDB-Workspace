import { useState } from 'react';
import {
  ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  Edit2, MoreHorizontal, ExternalLink, MapPin,
  AlertCircle, Calendar, Activity, Server, Database,
  Network, Shield, Clock, User, Mail, Phone,
  ArrowUpDown, CheckCircle2, Layers, Building2,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { type AppItem } from '../data/appData';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface CIItem {
  id: string;
  name: string;
  type: string;
  class: string;
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

// Contact mock
const getContact = (ci: CIItem) => ({
  owner:      ci.owner,
  group:      ci.supportGroup,
  email:      ci.type === 'Database' ? 'it-dba-support@clsa.com' : 'it-techops@clsa.com',
  hotline:    '+852 2600 7456\n+91 20 6646 8317',
  escalation: 'Sandeep Savalam',
});

// Related Applications mock
type RelatedApp = AppItem & { role: string };
const RELATED_APPS: RelatedApp[] = [
  { id: '3', name: 'Trading Platform - PROD',  app: 'Trading System',  family: 'core', dept: 'Finance',             env: 'Production',     status: 'Operational', incidents: 1, changes: 0, criticality: 'Tier 1', servers: 32,  lastUpdated: '4 hours ago',  role: 'Primary Host'        },
  { id: '8', name: 'Market Data Feed - PROD',  app: 'Trading System',  family: 'core', dept: 'Finance',             env: 'Production',     status: 'Operational', incidents: 0, changes: 1, criticality: 'Tier 1', servers: 18,  lastUpdated: '6 hours ago',  role: 'Secondary Host'      },
  { id: '1', name: 'Payment Gateway - PROD',   app: 'Payment Portal',  family: 'core', dept: 'Fintech',             env: 'Production',     status: 'Operational', incidents: 1, changes: 0, criticality: 'Tier 1', servers: 14,  lastUpdated: '2 hours ago',  role: 'Upstream Consumer'   },
  { id: '7', name: 'Risk Dashboard - PROD',    app: 'Risk Management', family: 'risk', dept: 'Risk',                env: 'Production',     status: 'Degraded',    incidents: 2, changes: 0, criticality: 'Tier 1', servers: 20,  lastUpdated: '30 mins ago',  role: 'Downstream Consumer' },
  { id: '6', name: 'ES - Cobra HK (HUB)',      app: 'ES Cobra',        family: 'core', dept: 'Execution Services',  env: 'Production',     status: 'Operational', incidents: 3, changes: 5, criticality: 'Tier 1', servers: 142, lastUpdated: '1 hour ago',   role: 'Primary Host'        },
];

const incidentTrendData = [
  { month: 'Nov', incidents: 3, changes: 2 },
  { month: 'Dec', incidents: 5, changes: 4 },
  { month: 'Jan', incidents: 2, changes: 3 },
  { month: 'Feb', incidents: 4, changes: 5 },
  { month: 'Mar', incidents: 1, changes: 2 },
  { month: 'Apr', incidents: 3, changes: 6 },
];

const recentIncidents = [
  { number: 'INC0012345', priority: 'P2 - High',   state: 'In Progress', short: 'CPU spike >95% sustained 30 min', opened:    '2026-02-10 08:12' },
  { number: 'INC0012201', priority: 'P3 - Medium', state: 'Resolved',    short: 'Disk usage warning on /var',       opened:    '2026-01-28 14:55' },
];

const recentChanges = [
  { number: 'CHG0008811', type: 'Standard', state: 'Scheduled', short: 'OS patching – KB5034441', scheduled: '2026-03-05 22:00' },
  { number: 'CHG0008650', type: 'Normal',   state: 'Closed',    short: 'Disk expansion +200 GB',   scheduled: '2026-02-20 01:00' },
];

const healthChecks = [
  { label: 'CI Completeness',   score: 92,  status: 'good'    },
  { label: 'Ownership Defined', score: 100, status: 'good'    },
  { label: 'Stale Data Risk',   score: 68,  status: 'warning' },
  { label: 'Duplicate Check',   score: 100, status: 'good'    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const priorityColor: Record<string, string> = {
  'P1 - Critical': 'bg-red-100 text-red-700',
  'P2 - High':     'bg-orange-100 text-orange-700',
  'P3 - Medium':   'bg-yellow-100 text-yellow-700',
};
const stateColor: Record<string, string> = {
  'In Progress': 'bg-purple-100 text-purple-700',
  'Resolved':    'bg-green-100 text-green-700',
  'Closed':      'bg-gray-100 text-gray-500',
  'Scheduled':   'bg-blue-100 text-blue-700',
  'Approved':    'bg-green-100 text-green-700',
};
const changeTypeColor: Record<string, string> = {
  'Standard':  'bg-gray-100 text-gray-600',
  'Normal':    'bg-blue-100 text-blue-700',
  'Emergency': 'bg-red-100 text-red-700',
};

function EnvBadge({ env }: { env: string }) {
  const cls =
    env === 'Production'   ? 'bg-green-100 text-green-700'  :
    env === 'DR'           ? 'bg-orange-100 text-orange-700' :
    env.includes('Non')    ? 'bg-yellow-100 text-yellow-700' :
                             'bg-gray-100 text-gray-600';
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>{env}</span>;
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
export default function CIDetailView({ ci, onBack, onSelectApp, fromApp }: CIDetailViewProps) {
  const detail  = getDetail(ci);
  const contact = getContact(ci);
  const isServer = ci.type === 'Server';
  const [activeTab, setActiveTab] = useState<'incidents' | 'changes'>('incidents');
  const [showEditModal, setShowEditModal] = useState(false);

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
        <span className="text-gray-900 font-medium">{ci.name}</span>
      </div>

      {/* ── CI Header card ── */}
      <div className="bg-white rounded-lg border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-gray-900">{ci.name}</h1>
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
            <button onClick={() => setShowEditModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 transition-colors">
              <Edit2 className="w-4 h-4" /> Edit
            </button>
            <button className="p-1.5 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-500">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Key fields */}
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 pt-4 border-t border-gray-100">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">
              {ci.type === 'Server' ? 'Server Type' : ci.type === 'Database' ? 'DB Engine' : 'CI Type'}
            </p>
            <p className="text-sm font-medium text-gray-900">{detail.serverType}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Environment</p>
            <EnvBadge env={ci.environment} />
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Location</p>
            <p className="text-sm font-medium text-gray-900 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-gray-400" />{ci.location}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">
              {ci.type === 'Server' ? 'Server OS' : ci.type === 'Database' ? 'Version' : 'Class'}
            </p>
            <p className="text-sm font-medium text-gray-900">{detail.serverOS}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">
              {ci.type === 'Server' ? 'OS Version' : 'Sub-type'}
            </p>
            <p className="text-sm font-medium text-gray-900">{detail.osVersion}</p>
          </div>
        </div>

        {/* Extra tech fields (servers) */}
        {isServer && (
          <div className="mt-3 grid grid-cols-4 gap-4 pt-3 border-t border-gray-100">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">IP Address</p>
              <p className="text-sm font-medium text-gray-900 font-mono">{detail.ip}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">CPU</p>
              <p className="text-sm font-medium text-gray-900">{detail.cpu}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">RAM</p>
              <p className="text-sm font-medium text-gray-900">{detail.ram}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Disk</p>
              <p className="text-sm font-medium text-gray-900">{detail.disk}</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Contact Information ── */}
      <Section title="Contact Information" icon={<User className="w-4 h-4 text-blue-500" />}>
        <div className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

            <div className="flex items-start gap-3">
              <div className="p-2 bg-blue-100 rounded-lg flex-shrink-0">
                <User className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">TechOps Owner</p>
                <p className="text-sm font-medium text-gray-900">{contact.owner}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-100 rounded-lg flex-shrink-0">
                <Building2 className="w-4 h-4 text-indigo-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Support Group</p>
                <p className="text-sm font-medium text-gray-900">{contact.group}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-green-100 rounded-lg flex-shrink-0">
                <Mail className="w-4 h-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Email</p>
                <a href={`mailto:${contact.email}`} className="text-sm font-medium text-blue-600 hover:underline">
                  {contact.email}
                </a>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-amber-100 rounded-lg flex-shrink-0">
                <Phone className="w-4 h-4 text-amber-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Hotline</p>
                <p className="text-sm font-medium text-gray-900 whitespace-pre-line">{contact.hotline}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-rose-100 rounded-lg flex-shrink-0">
                <Shield className="w-4 h-4 text-rose-600" />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Escalation Contact</p>
                <p className="text-sm font-medium text-gray-900">{contact.escalation}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="p-2 bg-gray-100 rounded-lg flex-shrink-0">
                <Clock className="w-4 h-4 text-gray-500" />
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-0.5">Last Modified</p>
                <p className="text-sm font-medium text-gray-900">{ci.lastModified}</p>
              </div>
            </div>

          </div>
        </div>
      </Section>

      {/* ── Related Applications ── */}
      <Section title="Related Applications" icon={<Layers className="w-4 h-4 text-blue-500" />}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Application', 'IT Department', 'Environment', 'Role', 'Incidents', 'Changes', ''].map(col => (
                  <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {RELATED_APPS.map((app) => (
                <tr key={app.id} className="hover:bg-blue-50/40 transition-colors group">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onSelectApp?.(app)}
                      className="text-sm font-medium text-blue-700 hover:underline text-left"
                    >
                      {app.name}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{app.dept}</td>
                  <td className="px-4 py-3"><EnvBadge env={app.env} /></td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-medium text-gray-600 bg-gray-100 px-2 py-0.5 rounded">
                      {app.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {app.incidents > 0
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                          <AlertCircle className="w-3 h-3" />{app.incidents}
                        </span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {app.changes > 0
                      ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                          <Calendar className="w-3 h-3" />{app.changes}
                        </span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => onSelectApp?.(app)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
                    >
                      Open <ExternalLink className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Incidents & Changes ── */}
      <Section title="Related Incidents & Changes" icon={<AlertCircle className="w-4 h-4 text-blue-500" />}>
        <div className="p-5">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('incidents')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${activeTab === 'incidents' ? 'bg-red-100 text-red-700' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <AlertCircle className="w-3.5 h-3.5 inline mr-1" />
              Incidents ({recentIncidents.length})
            </button>
            <button
              onClick={() => setActiveTab('changes')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${activeTab === 'changes' ? 'bg-yellow-100 text-yellow-700' : 'text-gray-500 hover:bg-gray-100'}`}
            >
              <Calendar className="w-3.5 h-3.5 inline mr-1" />
              Changes ({recentChanges.length})
            </button>
          </div>

          {activeTab === 'incidents' ? (
            <div className="space-y-3">
              {recentIncidents.map((inc, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-sm font-semibold text-blue-700 hover:underline cursor-pointer">{inc.number}</span>
                    <div className="flex gap-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${priorityColor[inc.priority] ?? 'bg-gray-100 text-gray-600'}`}>{inc.priority}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateColor[inc.state]  ?? 'bg-gray-100 text-gray-600'}`}>{inc.state}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-800 mb-1.5">{inc.short}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Opened: {inc.opened}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {recentChanges.map((chg, i) => (
                <div key={i} className="border border-gray-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <span className="text-sm font-semibold text-blue-700 hover:underline cursor-pointer">{chg.number}</span>
                    <div className="flex gap-1.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${changeTypeColor[chg.type] ?? 'bg-gray-100 text-gray-600'}`}>{chg.type}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${stateColor[chg.state]    ?? 'bg-gray-100 text-gray-600'}`}>{chg.state}</span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-800 mb-1.5">{chg.short}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1"><Clock className="w-3 h-3" /> Scheduled: {chg.scheduled}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* ── Trend Chart ── */}
      <Section title="Incident & Change Trend (Last 6 Months)" icon={<Activity className="w-4 h-4 text-blue-500" />}>
        <div className="p-5">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={incidentTrendData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="incidents" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} name="Incidents" />
              <Line type="monotone" dataKey="changes"   stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} name="Changes"   />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Section>

      {/* ── CMDB Health ── */}
      <Section title="CMDB Health Metrics" icon={<Shield className="w-4 h-4 text-blue-500" />} defaultOpen={false}>
        <div className="p-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {healthChecks.map(h => (
            <div key={h.label} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{h.label}</span>
                <span className={`font-semibold ${h.status === 'good' ? 'text-green-600' : 'text-yellow-600'}`}>{h.score}%</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${h.status === 'good' ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${h.score}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 flex items-center gap-1">
                {h.status === 'good'
                  ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                  : <AlertCircle  className="w-3 h-3 text-yellow-500" />}
                {h.status === 'good' ? 'OK' : 'Needs attention'}
              </p>
            </div>
          ))}
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

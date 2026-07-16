import { useState, useEffect } from 'react';
import {
  Server, Database, CircuitBoard, Network, Layout,
  Search, ChevronRight, ChevronLeft, Menu, Loader2,
  FileSearch, Home, ArrowLeft,
} from 'lucide-react';
import CISearchView from './app/components/CISearchView';
import ApplicationHome from './app/components/ApplicationHome';
import ApplicationDetails from './app/components/ApplicationDetails';
import CIDetailView, { type CIItem } from './app/components/CIDetailView';
import GlobalSearchBar from './app/components/GlobalSearchBar';
import { type AppItem } from './app/data/appData';
import { queryTable } from './api/servicenow';

type View = 'loading' | 'ci-search' | 'app-home' | 'app-details' | 'ci-detail' | 'dashboard' | 'network-links' | 'not-found';

interface Props { username: string }

// ── URL / routing helpers ─────────────────────────────────────────────────────

// Map between View names and the ?page= URL value
const VIEW_TO_PAGE: Partial<Record<View, string>> = {
  'app-home':  'app',
  'ci-search': 'ci',
};
const PAGE_TO_VIEW: Record<string, View> = {
  app: 'app-home',
  ci:  'ci-search',
};

function isServiceClass(table: string) {
  return table.startsWith('cmdb_ci_service');
}

function formatClassName(cls: string) {
  return cls.replace(/^cmdb_ci_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/** Read table + sys_id (detail deep-link). Returns null if either is missing. */
function readUrlParams(): { table: string; sysId: string } | null {
  const p = new URLSearchParams(window.location.search);
  const table = p.get('table');
  const sysId = p.get('sys_id');
  return table && sysId ? { table, sysId } : null;
}

/** Read ?page= and return the matching View, or null if absent/unknown. */
function readPageParam(): View | null {
  const page = new URLSearchParams(window.location.search).get('page');
  return page ? (PAGE_TO_VIEW[page] ?? null) : null;
}

function pushUrl(table: string, sysId: string, ciSource: 'ci-search' | 'app-details' = 'ci-search') {
  const url = new URL(window.location.href);
  url.searchParams.set('table', table);
  url.searchParams.set('sys_id', sysId);
  url.searchParams.delete('page');
  window.history.pushState({ table, sysId, ciSource }, '', url.toString());
}

/** Navigate to a home/sidebar view — uses pushState so back button works. */
function pushPageUrl(view: View) {
  const url = new URL(window.location.href);
  url.searchParams.delete('table');
  url.searchParams.delete('sys_id');
  const page = VIEW_TO_PAGE[view];
  if (page) url.searchParams.set('page', page);
  else url.searchParams.delete('page');
  window.history.pushState({ view }, '', url.toString());
}

// ── Main component ────────────────────────────────────────────────────────────

export function App({ username }: Props) {
  // Determine initial view SYNCHRONOUSLY from URL — prevents any flash of the
  // wrong page. Detail deep-links (table+sys_id) start in 'loading' until the
  // API call resolves; ?page= params resolve immediately.
  const [currentView, setCurrentView] = useState<View>(() => {
    if (readUrlParams()) return 'loading';
    return readPageParam() ?? 'ci-search';
  });

  const [selectedApp, setSelectedApp] = useState<AppItem | null>(null);
  const [selectedCI,  setSelectedCI]  = useState<CIItem  | null>(null);
  const [ciSource, setCISource]       = useState<'ci-search' | 'app-details'>('ci-search');
  const [notFoundCtx, setNotFoundCtx] = useState<{ table: string; sysId: string } | null>(null);

  const initials = username.split('.').map(p => p.charAt(0).toUpperCase()).join('').slice(0, 2);

  // ── Navigate to a record fetched from the API ─────────────────────────────
  //
  // Used both on initial deep-link load and by the popstate (back/fwd) handler.
  // State setters from useState are guaranteed stable so it's safe to call this
  // from inside effect closures without useCallback.

  function navigateToRecord(table: string, sysId: string, ciSrc: 'ci-search' | 'app-details') {
    setCurrentView('loading');
    queryTable<Record<string, string>>({
      table,
      query:  `sys_id=${sysId}`,
      fields: ['sys_id', 'name', 'sys_class_name', 'environment', 'install_status'],
      limit:  1,
    })
      .then(({ result }) => {
        const r = result?.[0];
        if (!r) {
          setNotFoundCtx({ table, sysId });
          setCurrentView('not-found');
          return;
        }

        if (isServiceClass(table)) {
          setSelectedApp({
            id: sysId, sysId, table,
            name: r.name ?? '', app: r.name ?? '',
            family: 'core', dept: '',
            env: r.environment ?? 'Production',
            status: 'Operational', incidents: 0, changes: 0,
            criticality: 'Medium', servers: 0, lastUpdated: '',
          });
          setCurrentView('app-details');
        } else {
          setSelectedCI({
            id: sysId,
            name:         r.name ?? '',
            type:         formatClassName(r.sys_class_name ?? table),
            class:        r.sys_class_name ?? table,
            environment:  r.environment ?? '',
            location: '', owner: '', supportGroup: '',
            lastModified: '', hasIncident: false, hasChange: false,
          });
          setCISource(ciSrc);
          setCurrentView('ci-detail');
        }
      })
      .catch(() => {
        setNotFoundCtx({ table, sysId });
        setCurrentView('not-found');
      });
  }

  // ── Initial deep-link / page-param fetch ─────────────────────────────────
  useEffect(() => {
    const params = readUrlParams();
    if (!params) {
      // No detail params — stamp the initial entry with the resolved view so
      // popstate can read it back (including ?page= that may already be in URL).
      const view = readPageParam() ?? 'ci-search';
      window.history.replaceState({ view }, '', window.location.href);
      return;
    }
    // Detail deep-link: stamp current entry then fetch the record
    window.history.replaceState(
      { table: params.table, sysId: params.sysId, ciSource: 'ci-search' },
      '',
      window.location.href,
    );
    navigateToRecord(params.table, params.sysId, 'ci-search');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Browser back / forward ────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      type HistState = { table?: string; sysId?: string; ciSource?: string; view?: string } | null;
      const state = e.state as HistState;

      // After navigation the URL already reflects the target; use it first,
      // fall back to the pushState state object for cases where URL has no params.
      const params  = readUrlParams();
      const table   = params?.table   ?? state?.table;
      const sysId   = params?.sysId   ?? state?.sysId;
      const ciSrc   = (state?.ciSource ?? 'ci-search') as 'ci-search' | 'app-details';

      if (!table || !sysId) {
        // No record params → check ?page=, then fall back to state.view
        setCurrentView(readPageParam() ?? (state?.view as View) ?? 'ci-search');
        return;
      }

      navigateToRecord(table, sysId, ciSrc);
    };

    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Navigation handlers ───────────────────────────────────────────────────

  const handleSelectApp = (app: AppItem) => {
    setSelectedApp(app);
    setCurrentView('app-details');
    pushUrl(app.table ?? 'cmdb_ci_service', app.sysId ?? app.id);
  };

  const handleViewCI = (ci: CIItem, source: 'ci-search' | 'app-details') => {
    setSelectedCI(ci);
    setCISource(source);
    setCurrentView('ci-detail');
    pushUrl(ci.class, ci.id, source);
  };

  // In-app Back buttons use the browser history stack — equivalent to the
  // browser back button, so both behave identically.
  const handleBack = () => window.history.back();

  // Sidebar navigation pushes a new history entry so the back button works
  // and each home page gets its own URL (?page=app / ?page=ci).
  const navTo = (view: View) => {
    setCurrentView(view);
    pushPageUrl(view);
  };

  // ── Sidebar nav item ──────────────────────────────────────────────────────
  const navItem = (view: View, label: string, Icon: React.ElementType) => {
    const active = currentView === view;
    return (
      <button
        onClick={() => navTo(view)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
          active ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        {!sidebarCollapsed && <span>{label}</span>}
      </button>
    );
  };

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="size-full flex flex-col bg-gray-50 h-screen overflow-hidden">
      {/* ── Top header ───────────────────────────────────────────────────── */}
      <header className="h-14 bg-gradient-to-r from-blue-900 via-blue-700 to-blue-600 flex items-center gap-4 px-6 shadow-lg shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
            <span className="text-white text-xs font-bold">C</span>
          </div>
          <span className="text-white font-semibold text-lg">CLSA</span>
        </div>
        <div className="flex-1 flex justify-center px-4">
          <GlobalSearchBar onSelectCI={(ci) => handleViewCI(ci, 'ci-search')} />
        </div>
        <div className="shrink-0 w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
          {initials}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <aside className={`${sidebarCollapsed ? 'w-16' : 'w-56'} bg-white border-r border-gray-200 flex flex-col transition-all duration-200 shrink-0`}>
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            {!sidebarCollapsed && <span className="text-xs font-semibold text-gray-500 uppercase">Main Menu</span>}
            <button onClick={() => setSidebarCollapsed(c => !c)} className="p-1 hover:bg-gray-100 rounded">
              {sidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navItem('app-home',      'Application Mapping', Layout)}
            {navItem('ci-search',     'CI Search',           Search)}
            {navItem('dashboard',     'Dashboard',           Layout)}
            {navItem('network-links', 'Network Links',       Network)}
            {!sidebarCollapsed && (
              <>
                <div className="pt-4 pb-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase px-3">Inventory</span>
                </div>
                {[
                  ['Appliances',      Menu],
                  ['Circuits',        CircuitBoard],
                  ['Databases',       Database],
                  ['Network Devices', Network],
                  ['Servers',         Server],
                ].map(([label, Icon]) => (
                  <button key={label as string} className="w-full flex items-center gap-3 px-3 py-2 rounded text-gray-700 hover:bg-gray-100 text-sm">
                    {/* @ts-ignore */}
                    <Icon className="w-5 h-5 shrink-0" />
                    <span>{label as string}</span>
                  </button>
                ))}
              </>
            )}
          </nav>
        </aside>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          <main className="flex-1 overflow-auto">

            {currentView === 'loading' && (
              <div className="flex-1 h-full flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              </div>
            )}

            {currentView === 'ci-search' && (
              <CISearchView onViewDetails={(ci) => handleViewCI(ci, 'ci-search')} />
            )}
            {currentView === 'app-home' && (
              <ApplicationHome onSelectApp={handleSelectApp} />
            )}
            {currentView === 'app-details' && (
              <ApplicationDetails
                selectedApp={selectedApp}
                onSelectApp={handleSelectApp}
                onViewCI={(ci) => handleViewCI(ci, 'app-details')}
                onBack={handleBack}
              />
            )}
            {currentView === 'ci-detail' && selectedCI && (
              <CIDetailView
                ci={selectedCI}
                onBack={handleBack}
                onSelectApp={handleSelectApp}
                fromApp={ciSource === 'app-details' ? selectedApp : null}
              />
            )}
            {currentView === 'dashboard' && <DashboardView />}
            {currentView === 'network-links' && (
              <div className="p-6 text-gray-500 text-sm">Network Links — coming soon.</div>
            )}
            {currentView === 'not-found' && (
              <NotFoundView
                table={notFoundCtx?.table ?? ''}
                sysId={notFoundCtx?.sysId ?? ''}
                onGoHome={() => { navTo('app-home'); }}
                onGoSearch={() => { navTo('ci-search'); }}
              />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ── Record not found ─────────────────────────────────────────────────────────
function NotFoundView({ table, sysId, onGoHome, onGoSearch }: {
  table: string; sysId: string;
  onGoHome: () => void; onGoSearch: () => void;
}) {
  return (
    <div className="flex-1 h-full flex items-center justify-center p-12">
      <div className="max-w-md w-full text-center">
        <div className="flex justify-center mb-6">
          <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center">
            <FileSearch className="w-10 h-10 text-gray-400" />
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">Record Not Found</h2>
        <p className="text-gray-500 mb-2">
          The requested configuration item could not be found in the CMDB.
        </p>
        {sysId && (
          <div className="mt-4 mb-6 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-left space-y-1">
            <div className="flex gap-3 text-sm">
              <span className="text-gray-400 w-16 shrink-0">Table</span>
              <span className="font-mono text-gray-700 break-all">{table || '—'}</span>
            </div>
            <div className="flex gap-3 text-sm">
              <span className="text-gray-400 w-16 shrink-0">Sys ID</span>
              <span className="font-mono text-gray-700 break-all">{sysId}</span>
            </div>
          </div>
        )}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onGoHome}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Home className="w-4 h-4" />
            App Home
          </button>
          <button
            onClick={onGoSearch}
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            CI Search
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Inline dashboard ──────────────────────────────────────────────────────────
function DashboardView() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Overview of CMDB configuration items</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Servers',   count: '1,240', Icon: Server,       bg: 'bg-blue-100',   ic: 'text-blue-600'   },
          { label: 'Switches',  count: '385',   Icon: Network,      bg: 'bg-green-100',  ic: 'text-green-600'  },
          { label: 'Databases', count: '452',   Icon: Database,     bg: 'bg-purple-100', ic: 'text-purple-600' },
          { label: 'Circuits',  count: '98',    Icon: CircuitBoard, bg: 'bg-orange-100', ic: 'text-orange-600' },
        ].map(({ label, count, Icon, bg, ic }) => (
          <div key={label} className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-4">
              <div className={`p-3 ${bg} rounded-lg`}><Icon className={`w-6 h-6 ${ic}`} /></div>
              <div>
                <p className="text-3xl font-semibold text-gray-900">{count}</p>
                <p className="text-sm text-gray-600">{label}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

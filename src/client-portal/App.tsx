import { useState } from 'react';
import {
  Server, Database, CircuitBoard, Network, Layout,
  Search, Bell, ChevronRight, ChevronLeft,
  Filter, Menu,
} from 'lucide-react';
import CISearchView from './app/components/CISearchView';
import ApplicationHome from './app/components/ApplicationHome';
import ApplicationDetails from './app/components/ApplicationDetails';
import CIDetailView, { type CIItem } from './app/components/CIDetailView';
import { type AppItem } from './app/data/appData';

type View = 'dashboard' | 'ci-search' | 'app-home' | 'app-details' | 'network-links' | 'ci-detail';

interface Props {
  username: string;
}

export function App({ username }: Props) {
  const [currentView, setCurrentView]     = useState<View>('ci-search');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedApp, setSelectedApp]     = useState<AppItem | null>(null);
  const [selectedCI, setSelectedCI]       = useState<CIItem | null>(null);
  const [ciSource, setCISource]           = useState<'ci-search' | 'app-details'>('ci-search');

  const initials = username
    .split('.')
    .map(p => p.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);

  const handleSelectApp = (app: AppItem) => {
    setSelectedApp(app);
    setCurrentView('app-details');
  };

  const handleViewCI = (ci: CIItem, source: 'ci-search' | 'app-details') => {
    setSelectedCI(ci);
    setCISource(source);
    setCurrentView('ci-detail');
  };

  const navItem = (view: View, label: string, Icon: React.ElementType) => {
    const active = currentView === view;
    return (
      <button
        onClick={() => setCurrentView(view)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
          active
            ? 'bg-blue-600 text-white'
            : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        <Icon className="w-5 h-5 shrink-0" />
        {!sidebarCollapsed && <span>{label}</span>}
      </button>
    );
  };

  return (
    <div className="size-full flex flex-col bg-gray-50 h-screen overflow-hidden">
      {/* ── Top header ───────────────────────────────────────────────────── */}
      <header className="h-16 bg-gradient-to-r from-blue-900 via-blue-700 to-blue-600 flex items-center justify-between px-6 shadow-lg shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center">
              <span className="text-white text-xs font-bold">C</span>
            </div>
            <span className="text-white font-semibold text-lg">CLSA</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button className="text-white hover:bg-white/10 px-3 py-1.5 rounded flex items-center gap-1 text-sm">
            History <ChevronRight className="w-4 h-4" />
          </button>
          <button className="text-white hover:bg-white/10 p-2 rounded">
            <Bell className="w-5 h-5" />
          </button>
          <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-semibold text-sm">
            {initials}
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <aside
          className={`${
            sidebarCollapsed ? 'w-16' : 'w-56'
          } bg-white border-r border-gray-200 flex flex-col transition-all duration-200 shrink-0`}
        >
          <div className="p-4 border-b border-gray-200 flex items-center justify-between">
            {!sidebarCollapsed && (
              <span className="text-xs font-semibold text-gray-500 uppercase">Main Menu</span>
            )}
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="p-1 hover:bg-gray-100 rounded"
            >
              {sidebarCollapsed
                ? <ChevronRight className="w-4 h-4" />
                : <ChevronLeft  className="w-4 h-4" />}
            </button>
          </div>

          <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navItem('app-home',    'Application Mapping', Layout)}
            {navItem('ci-search',   'CI Search',           Search)}
            {navItem('dashboard',   'Dashboard',           Layout)}
            {navItem('network-links', 'Network Links',     Network)}

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
                  <button
                    key={label as string}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded text-gray-700 hover:bg-gray-100 text-sm"
                  >
                    {/* @ts-ignore */}
                    <Icon className="w-5 h-5 shrink-0" />
                    <span>{label as string}</span>
                  </button>
                ))}
              </>
            )}
          </nav>
        </aside>

        {/* ── Main content ───────────────────────────────────────────────── */}
        <main className="flex-1 overflow-auto">
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
              onBack={() => setCurrentView('app-home')}
            />
          )}
          {currentView === 'ci-detail' && selectedCI && (
            <CIDetailView
              ci={selectedCI}
              onBack={() => setCurrentView(ciSource)}
              onSelectApp={handleSelectApp}
              fromApp={ciSource === 'app-details' ? selectedApp : null}
            />
          )}
          {currentView === 'dashboard' && <DashboardView />}
          {currentView === 'network-links' && (
            <div className="p-6 text-gray-500 text-sm">Network Links — coming soon.</div>
          )}
        </main>
      </div>
    </div>
  );
}

// ── Inline dashboard (matches Figma's DashboardView) ─────────────────────────
function DashboardView() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Overview of CMDB configuration items</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Servers',    count: '1,240', Icon: Server,      bg: 'bg-blue-100',   ic: 'text-blue-600'   },
          { label: 'Switches',   count: '385',   Icon: Network,     bg: 'bg-green-100',  ic: 'text-green-600'  },
          { label: 'Databases',  count: '452',   Icon: Database,    bg: 'bg-purple-100', ic: 'text-purple-600' },
          { label: 'Circuits',   count: '98',    Icon: CircuitBoard,bg: 'bg-orange-100', ic: 'text-orange-600' },
        ].map(({ label, count, Icon, bg, ic }) => (
          <div key={label} className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center gap-4">
              <div className={`p-3 ${bg} rounded-lg`}>
                <Icon className={`w-6 h-6 ${ic}`} />
              </div>
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

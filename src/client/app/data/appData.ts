// ─── Shared Application data ──────────────────────────────────────────────────

export interface AppFamily {
  id: string;
  name: string;
  description: string;
  accentColor: string; // tailwind bg color for the family badge
}

export const appFamilies: AppFamily[] = [
  { id: 'core',       name: 'Core Application',  description: 'Mission-critical financial & trading systems', accentColor: 'bg-blue-700'   },
  { id: 'operations', name: 'Operations',         description: 'Back-office and payroll systems',              accentColor: 'bg-violet-600' },
  { id: 'hr',         name: 'Human Resources',    description: 'People management and HR platforms',           accentColor: 'bg-teal-600'   },
  { id: 'risk',       name: 'Risk & Compliance',  description: 'Risk monitoring and regulatory compliance',    accentColor: 'bg-rose-600'   },
];

export interface AppItem {
  id: string;
  name: string;
  app: string;
  family: string; // matches AppFamily.id
  dept: string;
  env: string;
  status: string;
  incidents: number;
  changes: number;
  criticality: string;
  servers: number;
  lastUpdated: string;
  /** u_tier value from cmdb_ci_service_auto (0, 1, 2, 3) */
  tier?: string;
  /** Real ServiceNow sys_id when navigated from a live record */
  sysId?: string;
  /** ServiceNow sys_class_name / table name of the underlying record */
  table?: string;
}

export const mockApplications: AppItem[] = [
  { id: '1', name: 'Payment Gateway - PROD',   app: 'Payment Portal',  family: 'core',       dept: 'Fintech',    env: 'Production',     status: 'Operational', incidents: 1, changes: 0, criticality: 'Tier 1', servers: 14, lastUpdated: '2 hours ago'  },
  { id: '2', name: 'Payment Gateway - UAT',    app: 'Payment Portal',  family: 'core',       dept: 'Fintech',    env: 'Non-Prod (UAT)', status: 'Testing',     incidents: 0, changes: 1, criticality: 'Tier 2', servers: 6,  lastUpdated: '1 day ago'    },
  { id: '3', name: 'Trading Platform - PROD',  app: 'Trading System',  family: 'core',       dept: 'Finance',    env: 'Production',     status: 'Operational', incidents: 1, changes: 0, criticality: 'Tier 1', servers: 32, lastUpdated: '4 hours ago'  },
  { id: '4', name: 'Payroll Engine - PROD',    app: 'Payroll System',  family: 'operations', dept: 'Accounting', env: 'Production',     status: 'Operational', incidents: 0, changes: 0, criticality: 'Tier 2', servers: 8,  lastUpdated: '3 days ago'   },
  { id: '5', name: 'Payroll Gateway - UAT',    app: 'Payroll System',  family: 'operations', dept: 'Accounting', env: 'Non-Prod (UAT)', status: 'Operational', incidents: 0, changes: 1, criticality: 'Tier 3', servers: 4,  lastUpdated: '5 days ago'   },
  { id: '6', name: 'HR Portal - UAT',          app: 'HRIS',            family: 'hr',         dept: 'HR',         env: 'Non-Prod (UAT)', status: 'Operational', incidents: 0, changes: 0, criticality: 'Tier 2', servers: 5,  lastUpdated: '2 days ago'   },
  { id: '7', name: 'Risk Dashboard - PROD',    app: 'Risk Management', family: 'risk',       dept: 'Risk',       env: 'Production',     status: 'Degraded',    incidents: 2, changes: 0, criticality: 'Tier 1', servers: 20, lastUpdated: '30 mins ago'  },
  { id: '8', name: 'Market Data Feed - PROD',  app: 'Trading System',  family: 'core',       dept: 'Finance',    env: 'Production',     status: 'Operational', incidents: 0, changes: 1, criticality: 'Tier 1', servers: 18, lastUpdated: '6 hours ago'  },
  { id: '9', name: 'Compliance Monitor - UAT', app: 'Risk Management', family: 'risk',       dept: 'Risk',       env: 'Non-Prod (UAT)', status: 'Testing',     incidents: 0, changes: 0, criticality: 'Tier 3', servers: 3,  lastUpdated: '1 week ago'   },
];

export const departments = [
  'Execution Services TechOps',
  'Finance Technology',
  'HR Technology',
  'Risk Technology',
  'Trading Technology',
];

export const businessServicesByDept: Record<string, string[]> = {
  'Execution Services TechOps': ['ES - Cobra HK (HUB)', 'ES - Cobra AU', 'ES - Cobra JP', 'ES - Cobra KR', 'ES - Cobra SG', 'ES - Cobra TW'],
  'Finance Technology':         ['FT - Payment Gateway', 'FT - Settlement System', 'FT - Clearing Engine'],
  'HR Technology':              ['HRT - HR Portal', 'HRT - Payroll Engine', 'HRT - Onboarding System'],
  'Risk Technology':            ['RT - Risk Dashboard', 'RT - VaR Calculator', 'RT - Compliance Monitor'],
  'Trading Technology':         ['TT - Trading Platform', 'TT - Market Data Feed', 'TT - Order Management'],
};

export const appIncidents: Record<string, object[]> = {
  '1': [{ number: 'INC0014001', priority: 'P2 - High',     state: 'In Progress', short: 'Payment callback timeout > 30s',         opened: '2026-04-30 10:15', assignee: 'Kevin Pang'   }],
  '3': [{ number: 'INC0014102', priority: 'P3 - Medium',   state: 'In Progress', short: 'Order book latency spike on HK equities', opened: '2026-05-01 08:42', assignee: 'Michael Chen' }],
  '7': [
    { number: 'INC0014200', priority: 'P1 - Critical', state: 'New',         short: 'Risk engine down – VaR calc failing',      opened: '2026-05-03 23:10', assignee: 'Sarah Liu'    },
    { number: 'INC0014188', priority: 'P2 - High',     state: 'In Progress', short: 'Dashboard not loading for APAC users',     opened: '2026-05-03 21:05', assignee: 'David Yuen'   },
  ],
};

export const appChanges: Record<string, object[]> = {
  '2': [{ number: 'CHG0010011', type: 'Standard',  state: 'Scheduled', short: 'UAT environment refresh – Q2 data load',  scheduled: '2026-05-10 01:00', implementer: 'Kevin Pang'   }],
  '5': [{ number: 'CHG0010022', type: 'Normal',    state: 'Approved',  short: 'Payroll UAT – new tax band configuration', scheduled: '2026-05-08 22:00', implementer: 'Grace Ho'     }],
  '8': [{ number: 'CHG0010033', type: 'Emergency', state: 'Scheduled', short: 'Market data feed failover test',           scheduled: '2026-05-05 03:00', implementer: 'Michael Chen' }],
};

export type InfraCIType = 'server' | 'netgear' | 'circuit' | 'database';

export interface InfraCIStyle {
  border: string;
  bg: string;
  edge: string;
  text: string;
  label: string;
}

export const INFRA_CI_STYLE: Record<InfraCIType, InfraCIStyle> = {
  server: {
    border: '#2563EB',
    bg: '#EFF6FF',
    edge: '#2563EB',
    text: '#1E40AF',
    label: 'Servers',
  },
  netgear: {
    border: '#7C3AED',
    bg: '#F5F3FF',
    edge: '#7C3AED',
    text: '#5B21B6',
    label: 'Network Gear',
  },
  circuit: {
    border: '#EA580C',
    bg: '#FFF7ED',
    edge: '#EA580C',
    text: '#C2410C',
    label: 'Circuits',
  },
  database: {
    border: '#059669',
    bg: '#ECFDF5',
    edge: '#059669',
    text: '#047857',
    label: 'Databases',
  },
};

/** Column order left → right in the infrastructure diagram. */
export const INFRA_COLUMN_ORDER: InfraCIType[] = ['server', 'netgear', 'circuit', 'database'];

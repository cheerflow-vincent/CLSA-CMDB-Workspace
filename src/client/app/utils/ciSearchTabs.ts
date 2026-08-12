/** CI Search result tabs (matches CISearchView card tabs). */
export type CISearchTab = 'all' | 'servers' | 'switches' | 'databases' | 'network_links';

export type CISearchInventoryTab = Exclude<CISearchTab, 'all'>;

export const CI_INVENTORY_TABS: { tab: CISearchInventoryTab; label: string }[] = [
  { tab: 'servers', label: 'Servers' },
  { tab: 'switches', label: 'Network Gear' },
  { tab: 'databases', label: 'Databases' },
  { tab: 'network_links', label: 'Network Links' },
];

export function parseCISearchTab(value: string | null | undefined): CISearchTab | null {
  if (value === 'circuits') return 'network_links';
  if (value === 'all' || value === 'servers' || value === 'switches' || value === 'databases' || value === 'network_links') {
    return value;
  }
  return null;
}

export function readCISearchTabFromUrl(): CISearchTab {
  const parsed = parseCISearchTab(new URLSearchParams(window.location.search).get('tab'));
  return parsed ?? 'all';
}

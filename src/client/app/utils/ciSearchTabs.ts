/** CI Search result tabs (matches CISearchView card tabs). */
export type CISearchTab = 'all' | 'servers' | 'switches' | 'databases' | 'circuits';

export type CISearchInventoryTab = Exclude<CISearchTab, 'all'>;

export const CI_INVENTORY_TABS: { tab: CISearchInventoryTab; label: string }[] = [
  { tab: 'servers', label: 'Servers' },
  { tab: 'switches', label: 'Network Gear' },
  { tab: 'databases', label: 'Databases' },
  { tab: 'circuits', label: 'Circuits' },
];

export function parseCISearchTab(value: string | null | undefined): CISearchTab | null {
  if (value === 'all' || value === 'servers' || value === 'switches' || value === 'databases' || value === 'circuits') {
    return value;
  }
  return null;
}

export function readCISearchTabFromUrl(): CISearchTab {
  const parsed = parseCISearchTab(new URLSearchParams(window.location.search).get('tab'));
  return parsed ?? 'all';
}

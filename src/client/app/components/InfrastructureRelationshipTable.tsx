import { useState, useEffect } from 'react';
import { Server, Network, Link, Database } from 'lucide-react';
import RelatedListSection from './RelatedListSection';
import type { CIItem } from './CIDetailView';
import {
  SERVER_REL_CONFIG,
  NETGEAR_REL_CONFIG,
  NETWORK_LINK_REL_CONFIG,
  DATABASE_REL_CONFIG,
  fetchRelatedCICount,
  fetchRelatedCICountForCi,
  type RelatedCIConfig,
} from '../utils/relatedCIs';
import { INFRA_CI_STYLE, type InfraCIType } from '../utils/infraCiStyles';

interface Props {
  recordSysId?: string;
  ciSysId?: string;
  refreshKey?: number;
  onViewCI?: (ci: CIItem) => void;
  nodeSearch?: string;
}

const APP_SECTIONS: Array<{
  config: RelatedCIConfig;
  title: string;
  emptyMessage: string;
  Icon: typeof Server;
  iconBg: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}> = [
  {
    config: SERVER_REL_CONFIG,
    title: 'Servers hosting the application',
    emptyMessage: 'No linked servers.',
    Icon: Server,
    iconBg: 'bg-blue-100',
    iconColor: 'text-blue-600',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-200',
  },
  {
    config: NETGEAR_REL_CONFIG,
    title: 'Network gears hosting the application',
    emptyMessage: 'No linked network gears.',
    Icon: Network,
    iconBg: 'bg-teal-100',
    iconColor: 'text-teal-600',
    badgeBg: 'bg-teal-50',
    badgeText: 'text-teal-700',
    badgeBorder: 'border-teal-200',
  },
  {
    config: NETWORK_LINK_REL_CONFIG,
    title: 'Network links connected to this application',
    emptyMessage: 'No linked network links.',
    Icon: Link,
    iconBg: 'bg-orange-100',
    iconColor: 'text-orange-600',
    badgeBg: 'bg-orange-50',
    badgeText: 'text-orange-700',
    badgeBorder: 'border-orange-200',
  },
  {
    config: DATABASE_REL_CONFIG,
    title: 'Databases used by the application',
    emptyMessage: 'No linked databases.',
    Icon: Database,
    iconBg: 'bg-purple-100',
    iconColor: 'text-purple-600',
    badgeBg: 'bg-purple-50',
    badgeText: 'text-purple-700',
    badgeBorder: 'border-purple-200',
  },
];

const CI_SECTION_TITLES: Record<InfraCIType, string> = {
  server: 'Related servers',
  netgear: 'Related network gears',
  network_link: 'Related network links',
  database: 'Related databases',
};

function buildSections(ciMode: boolean) {
  const source = APP_SECTIONS;
  if (!ciMode) return source;
  return source.map(section => ({
    ...section,
    title: CI_SECTION_TITLES[section.config.ciType as InfraCIType],
  }));
}

function InfraTableSection({
  section,
  recordSysId,
  ciSysId,
  refreshKey,
  onViewCI,
  nodeSearch = '',
}: {
  section: typeof APP_SECTIONS[number];
  recordSysId?: string;
  ciSysId?: string;
  refreshKey: number;
  onViewCI?: (ci: CIItem) => void;
  nodeSearch?: string;
}) {
  const { config, Icon } = section;
  const ciType = config.ciType as InfraCIType;
  const style = INFRA_CI_STYLE[ciType];
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const anchorId = ciSysId || recordSysId;

  useEffect(() => {
    if (!anchorId) {
      setTotalCount(0);
      return;
    }
    let cancelled = false;
    const loadCount = ciSysId
      ? fetchRelatedCICountForCi(ciSysId, config)
      : fetchRelatedCICount(recordSysId!, config);
    loadCount
      .then(({ totalCount: count }) => {
        if (!cancelled) setTotalCount(count);
      })
      .catch(() => {
        if (!cancelled) setTotalCount(0);
      });
    return () => { cancelled = true; };
  }, [anchorId, ciSysId, recordSysId, config, refreshKey]);

  return (
    <section className="rounded-xl border border-gray-200 overflow-hidden bg-white">
      <header
        className="px-4 py-3 flex items-center gap-2.5 border-b border-gray-200"
        style={{ backgroundColor: style.bg }}
      >
        <div className={`p-1.5 rounded-md bg-white/80 ${section.iconBg}`}>
          <Icon className={`w-4 h-4 ${section.iconColor}`} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="typo-panel-title">{style.label}</h4>
          <p className="typo-caption truncate">
            {ciSysId ? 'Direct relationships' : config.relType}
          </p>
        </div>
        {totalCount !== null && (
          <span className={`typo-badge font-semibold ${section.badgeBg} ${section.badgeText} border ${section.badgeBorder} px-2.5 py-0.5 rounded-full shrink-0`}>
            {totalCount}
          </span>
        )}
      </header>

      <RelatedListSection
        embedded
        config={config}
        recordSysId={recordSysId}
        ciSysId={ciSysId}
        nodeSearch={nodeSearch}
        refreshKey={refreshKey}
        responsiveLayout={false}
        showCIFlags
        isOpen
        onToggle={() => {}}
        onViewCI={onViewCI}
        title={section.title}
        Icon={Icon}
        iconBg={section.iconBg}
        iconColor={section.iconColor}
        badgeBg={section.badgeBg}
        badgeText={section.badgeText}
        badgeBorder={section.badgeBorder}
        emptyMessage={section.emptyMessage}
        hoverRow="cursor-pointer"
      />
    </section>
  );
}

export default function InfrastructureRelationshipTable({
  recordSysId,
  ciSysId,
  refreshKey = 0,
  onViewCI,
  nodeSearch = '',
}: Props) {
  const sections = buildSections(!!ciSysId);

  return (
    <div className="space-y-5">
      {sections.map(section => (
        <InfraTableSection
          key={section.config.ciType}
          section={section}
          recordSysId={recordSysId}
          ciSysId={ciSysId}
          refreshKey={refreshKey}
          onViewCI={onViewCI}
          nodeSearch={nodeSearch}
        />
      ))}
    </div>
  );
}

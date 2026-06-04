import { SITE_VARIANT } from './variant';

/** Sidebar navigation groups aligned with the redesign mockup. */
export interface LayoutNavGroup {
  labelKey: string;
  panelKeys: string[];
  variants?: string[];
}

export const LAYOUT_SIDEBAR_GROUPS: LayoutNavGroup[] = [
  {
    labelKey: 'layout.nav.geopolitics',
    panelKeys: ['ucdp-events', 'strategic-posture', 'cii', 'strategic-risk', 'politics', 'middleeast', 'gov'],
    variants: ['full'],
  },
  {
    labelKey: 'layout.nav.infrastructure',
    panelKeys: ['cascade', 'supply-chain', 'live-webcams', 'economic', 'trade-policy'],
    variants: ['full'],
  },
  {
    labelKey: 'layout.nav.naturalEvents',
    panelKeys: ['satellite-fires', 'climate', 'population-exposure', 'displacement'],
    variants: ['full'],
  },
  {
    labelKey: 'layout.nav.intelligence',
    panelKeys: ['live-news', 'insights', 'gdelt-intel', 'intel', 'telegram-intel'],
    variants: ['full'],
  },
  {
    labelKey: 'layout.nav.markets',
    panelKeys: ['markets', 'commodities', 'finance', 'polymarket', 'macro-signals', 'heatmap'],
    variants: ['full'],
  },
  {
    labelKey: 'layout.nav.regional',
    panelKeys: ['us', 'europe', 'africa', 'latam', 'asia', 'energy'],
    variants: ['full'],
  },
  {
    labelKey: 'layout.nav.core',
    panelKeys: ['live-news', 'insights', 'tech', 'ai', 'markets', 'events'],
    variants: ['tech'],
  },
  {
    labelKey: 'layout.nav.startups',
    panelKeys: ['startups', 'vcblogs', 'regionalStartups', 'unicorns', 'accelerators', 'funding'],
    variants: ['tech'],
  },
  {
    labelKey: 'layout.nav.markets',
    panelKeys: ['markets', 'finance', 'crypto', 'polymarket', 'macro-signals'],
    variants: ['tech', 'finance'],
  },
  {
    labelKey: 'layout.nav.intelligence',
    panelKeys: ['positive-feed', 'digest', 'spotlight', 'breakthroughs', 'counters', 'progress'],
    variants: ['happy'],
  },
];

export function getLayoutNavGroups(): LayoutNavGroup[] {
  return LAYOUT_SIDEBAR_GROUPS.filter(
    (g) => !g.variants || g.variants.includes(SITE_VARIANT),
  );
}

/** Map view tab → default panel to show in the right context column. */
export const VIEW_TAB_PANEL: Record<string, string> = {
  globe: 'live-news',
  timeline: 'gdelt-intel',
  heatmap: 'heatmap',
  'country-intel': 'cii',
};

export const VIEW_TAB_PANEL_BY_VARIANT: Record<string, Record<string, string>> = {
  full: VIEW_TAB_PANEL,
  tech: { globe: 'live-news', timeline: 'events', heatmap: 'heatmap', 'country-intel': 'tech-readiness' },
  finance: { globe: 'markets', timeline: 'analysis', heatmap: 'heatmap', 'country-intel': 'macro-signals' },
  happy: { globe: 'positive-feed', timeline: 'breakthroughs', heatmap: 'progress', 'country-intel': 'spotlight' },
};

export function getViewTabPanel(tab: string): string {
  const map = VIEW_TAB_PANEL_BY_VARIANT[SITE_VARIANT] ?? VIEW_TAB_PANEL;
  return map[tab] ?? 'live-news';
}

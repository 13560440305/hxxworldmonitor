import { SITE_VARIANT } from '@/config/variant';
import { getLayoutNavGroups } from '@/config/layout-nav';
import { t } from '@/services/i18n';
import type { PanelConfig } from '@/types';

export interface SidebarNavOptions {
  panelSettings: Record<string, PanelConfig>;
  getPanelLabel: (panelKey: string, fallback: string) => string;
  onSelectPanel: (panelKey: string) => void;
  isDesktopApp: boolean;
}

const PANEL_ICONS: Record<string, string> = {
  'live-news': '📡',
  insights: '🤖',
  'strategic-posture': '🛡️',
  cii: '📊',
  'strategic-risk': '⚠️',
  intel: '🔍',
  'gdelt-intel': '📰',
  cascade: '🔗',
  politics: '🌍',
  'ucdp-events': '🔥',
  'satellite-fires': '🛰️',
  climate: '🌡️',
  'positive-feed': '☀️',
  markets: '📈',
  heatmap: '🗺️',
  gov: '🏛️',
  middleeast: '🕌',
  'live-webcams': '📹',
  'supply-chain': '🚢',
  displacement: '👥',
  counters: '🔢',
  progress: '📈',
  spotlight: '⭐',
  digest: '✨',
  breakthroughs: '🔬',
};

export class SidebarNav {
  private root: HTMLElement;
  private activePanelId: string | null = null;
  private options: SidebarNavOptions;

  constructor(mount: HTMLElement, options: SidebarNavOptions) {
    this.root = mount;
    this.options = options;
    this.render();
  }

  setActivePanel(panelKey: string): void {
    this.activePanelId = panelKey;
    this.root.querySelectorAll('.wm-nav-item').forEach((el) => {
      el.classList.toggle('active', (el as HTMLElement).dataset.panel === panelKey);
    });
  }

  refresh(): void {
    this.render();
    if (this.activePanelId) {
      this.setActivePanel(this.activePanelId);
    }
  }

  private render(): void {
    const local =
      this.options.isDesktopApp ||
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1';
    const vHref = (v: string, prod: string) => (local || SITE_VARIANT === v ? '#' : prod);
    const vTarget = (v: string) => (!local && SITE_VARIANT !== v ? 'target="_blank" rel="noopener"' : '');

    let html = `<div class="wm-sidebar-inner">`;

    // Dashboards / variant switcher
    html += `<div class="wm-sidebar-section">
      <div class="wm-sidebar-label">${t('layout.nav.dashboards')}</div>
      <a href="${vHref('full', 'https://worldmonitor.app')}" class="wm-nav-item wm-nav-variant ${SITE_VARIANT === 'full' ? 'active' : ''}" data-variant="full" ${vTarget('full')}>
        <span class="wm-nav-icon">🌍</span>${t('header.world')}
      </a>
      <a href="${vHref('tech', 'https://tech.worldmonitor.app')}" class="wm-nav-item wm-nav-variant ${SITE_VARIANT === 'tech' ? 'active' : ''}" data-variant="tech" ${vTarget('tech')}>
        <span class="wm-nav-icon">💻</span>${t('header.tech')}
      </a>
      <a href="${vHref('finance', 'https://finance.worldmonitor.app')}" class="wm-nav-item wm-nav-variant ${SITE_VARIANT === 'finance' ? 'active' : ''}" data-variant="finance" ${vTarget('finance')}>
        <span class="wm-nav-icon">📈</span>${t('header.finance')}
      </a>`;
    if (SITE_VARIANT === 'happy') {
      html += `<a href="${vHref('happy', 'https://happy.worldmonitor.app')}" class="wm-nav-item wm-nav-variant active" data-variant="happy" ${vTarget('happy')}>
        <span class="wm-nav-icon">☀️</span>${t('header.goodNews')}
      </a>`;
    }
    html += `</div><hr class="wm-sidebar-divider">`;

    const seen = new Set<string>();
    for (const group of getLayoutNavGroups()) {
      const items = group.panelKeys.filter((key) => {
        if (key === 'map' || seen.has(key)) return false;
        const cfg = this.options.panelSettings[key];
        if (!cfg?.enabled) return false;
        seen.add(key);
        return true;
      });
      if (items.length === 0) continue;

      html += `<div class="wm-sidebar-section">
        <div class="wm-sidebar-label">${t(group.labelKey)}</div>`;
      for (const key of items) {
        const cfg = this.options.panelSettings[key]!;
        const label = this.options.getPanelLabel(key, cfg.name);
        const icon = PANEL_ICONS[key] ?? '▸';
        html += `<div class="wm-nav-item" data-panel="${key}" role="button" tabindex="0">
          <span class="wm-nav-icon">${icon}</span>
          <span class="wm-nav-label">${label}</span>
        </div>`;
      }
      html += `</div><hr class="wm-sidebar-divider">`;
    }

    html += `<div class="wm-sidebar-footer">
      <div class="wm-pro-badge" title="${t('layout.proTitle')}">
        <span class="wm-pro-icon">✦</span>
        <div>
          <div class="wm-pro-title">${t('layout.proTitle')}</div>
          <div class="wm-pro-sub">${t('layout.proSubtitle')}</div>
        </div>
      </div>
    </div></div>`;

    this.root.innerHTML = html;

    this.root.querySelectorAll('.wm-nav-item[data-panel]').forEach((el) => {
      const activate = () => {
        const key = (el as HTMLElement).dataset.panel;
        if (key) this.options.onSelectPanel(key);
      };
      el.addEventListener('click', activate);
      el.addEventListener('keydown', (e: Event) => {
        const ke = e as KeyboardEvent;
        if (ke.key === 'Enter' || ke.key === ' ') {
          ke.preventDefault();
          activate();
        }
      });
    });
  }
}

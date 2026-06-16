import { t } from '@/services/i18n';
import type { EnterpriseGraphDto, EnterpriseGraphNodeDto } from '@/services/enterprise-graph';
import { escapeHtml } from '@/utils/sanitize';

export type CompanySelectHandler = (symbol: string, market: string) => void;

export class EnterpriseGraphView {
  private root: HTMLElement;
  private canvasEl: HTMLElement;
  private metaEl: HTMLElement;
  private statusEl: HTMLElement;
  private onSelectCompany: CompanySelectHandler | null = null;

  constructor(mount: HTMLElement) {
    this.root = mount;
    this.root.innerHTML = `
      <div class="eg-shell">
        <div class="eg-header">
          <div class="eg-title">${t('layout.viewEnterpriseGraph')}</div>
          <div class="eg-status" id="egStatus"></div>
        </div>
        <div class="eg-canvas" id="egCanvas" role="img" aria-label="${t('layout.viewEnterpriseGraph')}"></div>
        <div class="eg-meta" id="egMeta"></div>
      </div>
    `;
    this.canvasEl = this.root.querySelector('#egCanvas')!;
    this.metaEl = this.root.querySelector('#egMeta')!;
    this.statusEl = this.root.querySelector('#egStatus')!;
    this.showPlaceholder();
  }

  setOnSelectCompany(handler: CompanySelectHandler | null): void {
    this.onSelectCompany = handler;
  }

  showPlaceholder(): void {
    this.statusEl.textContent = t('components.enterpriseGraph.selectHint');
    this.canvasEl.innerHTML = `<div class="eg-empty">${t('components.enterpriseGraph.empty')}</div>`;
    this.metaEl.innerHTML = '';
  }

  showLoading(symbol: string): void {
    this.statusEl.textContent = t('components.enterpriseGraph.loading', { symbol });
    this.canvasEl.innerHTML = `<div class="eg-empty eg-loading">${t('common.loading')}</div>`;
  }

  showError(message: string): void {
    this.statusEl.textContent = message;
    this.canvasEl.innerHTML = `<div class="eg-empty eg-error">${escapeHtml(message)}</div>`;
  }

  renderGraph(graph: EnterpriseGraphDto): void {
    const center = graph.center;
    this.statusEl.textContent = t('components.enterpriseGraph.status', {
      name: center.name,
      source: graph.source,
      count: String(graph.nodes.length),
    });

    const width = 640;
    const height = 420;
    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.min(width, height) * 0.32;

    const companyNodes = graph.nodes.filter((n) => n.entityType === 'company');
    const others = graph.nodes.filter((n) => n.entityType !== 'company');
    const ordered = [
      center,
      ...companyNodes.filter((n) => n.id !== center.id),
      ...others.filter((n) => n.id !== center.id),
    ];

    const positions = new Map<string, { x: number; y: number }>();
    positions.set(center.id, { x: cx, y: cy });

    const orbit = ordered.filter((n) => n.id !== center.id);
    orbit.forEach((node, i) => {
      const angle = (Math.PI * 2 * i) / Math.max(orbit.length, 1) - Math.PI / 2;
      positions.set(node.id, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
      });
    });

    const lines = graph.edges
      .map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return '';
        return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="eg-edge" data-relation="${escapeHtml(edge.relationType)}" />`;
      })
      .join('');

    const nodes = ordered
      .map((node) => this.renderNode(node, positions.get(node.id)!, node.id === center.id))
      .join('');

    this.canvasEl.innerHTML = `
      <svg class="eg-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
        ${lines}
        ${nodes}
      </svg>
    `;

    this.canvasEl.querySelectorAll<SVGGElement>('.eg-node').forEach((el) => {
      el.addEventListener('click', () => {
        const symbol = el.dataset.symbol;
        const market = el.dataset.market ?? graph.market;
        if (symbol && this.onSelectCompany) {
          this.onSelectCompany(symbol, market);
        }
      });
    });

    this.metaEl.innerHTML = `
      <div class="eg-meta-row">
        <span class="eg-meta-label">${t('components.enterpriseGraph.market')}</span>
        <span>${escapeHtml(graph.market.toUpperCase())}</span>
      </div>
      <div class="eg-meta-row">
        <span class="eg-meta-label">${t('components.enterpriseGraph.relations')}</span>
        <span>${graph.edges.length}</span>
      </div>
      <div class="eg-meta-note">${t('components.enterpriseGraph.sourceNote')}</div>
    `;
  }

  private renderNode(
    node: EnterpriseGraphNodeDto,
    pos: { x: number; y: number },
    isCenter: boolean,
  ): string {
    const label = node.symbol.length <= 8 ? node.symbol : node.symbol.slice(0, 8);
    const r = isCenter ? 34 : 26;
    return `
      <g class="eg-node ${isCenter ? 'eg-node-center' : ''}" data-symbol="${escapeHtml(node.symbol)}" data-market="${escapeHtml(node.market ?? '')}" style="cursor:pointer">
        <circle cx="${pos.x}" cy="${pos.y}" r="${r}" class="eg-node-circle" />
        <text x="${pos.x}" y="${pos.y - 4}" text-anchor="middle" class="eg-node-symbol">${escapeHtml(label)}</text>
        <text x="${pos.x}" y="${pos.y + 12}" text-anchor="middle" class="eg-node-name">${escapeHtml(node.name.slice(0, 14))}</text>
      </g>
    `;
  }

  destroy(): void {
    this.root.innerHTML = '';
  }
}

import { t } from '@/services/i18n';
import type {
  CompanyFilingDto,
  EnterpriseGraphDto,
  EnterpriseGraphNodeDto,
} from '@/services/enterprise-graph';
import { escapeHtml } from '@/utils/sanitize';

export type CompanySelectHandler = (symbol: string, market: string) => void;
export type ExtractRelationsHandler = (opts: { useLlm: boolean; force: boolean }) => void;

export class EnterpriseGraphView {
  private root: HTMLElement;
  private canvasEl: HTMLElement;
  private metaEl: HTMLElement;
  private filingsEl: HTMLElement;
  private statusEl: HTMLElement;
  private actionsEl: HTMLElement;
  private onSelectCompany: CompanySelectHandler | null = null;
  private onExtractRelations: ExtractRelationsHandler | null = null;
  private extracting = false;

  constructor(mount: HTMLElement) {
    this.root = mount;
    this.root.innerHTML = `
      <div class="eg-shell">
        <div class="eg-header">
          <div class="eg-title">${t('layout.viewEnterpriseGraph')}</div>
          <div class="eg-status" id="egStatus"></div>
        </div>
        <div class="eg-actions" id="egActions"></div>
        <div class="eg-canvas" id="egCanvas" role="img" aria-label="${t('layout.viewEnterpriseGraph')}"></div>
        <div class="eg-meta" id="egMeta"></div>
        <div class="eg-filings" id="egFilings"></div>
      </div>
    `;
    this.canvasEl = this.root.querySelector('#egCanvas')!;
    this.metaEl = this.root.querySelector('#egMeta')!;
    this.filingsEl = this.root.querySelector('#egFilings')!;
    this.statusEl = this.root.querySelector('#egStatus')!;
    this.actionsEl = this.root.querySelector('#egActions')!;
    this.showPlaceholder();
  }

  setOnSelectCompany(handler: CompanySelectHandler | null): void {
    this.onSelectCompany = handler;
  }

  setOnExtractRelations(handler: ExtractRelationsHandler | null): void {
    this.onExtractRelations = handler;
  }

  setExtracting(busy: boolean): void {
    this.extracting = busy;
    const btn = this.actionsEl.querySelector('#egExtractBtn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = busy;
      btn.textContent = busy
        ? t('components.enterpriseGraph.extracting')
        : t('components.enterpriseGraph.extractRelations');
    }
  }

  showPlaceholder(): void {
    this.statusEl.textContent = t('components.enterpriseGraph.selectHint');
    this.canvasEl.innerHTML = `<div class="eg-empty">${t('components.enterpriseGraph.empty')}</div>`;
    this.metaEl.innerHTML = '';
    this.filingsEl.innerHTML = '';
    this.actionsEl.innerHTML = '';
  }

  showLoading(symbol: string): void {
    this.statusEl.textContent = t('components.enterpriseGraph.loading', { symbol });
    this.canvasEl.innerHTML = `<div class="eg-empty eg-loading">${t('common.loading')}</div>`;
    this.filingsEl.innerHTML = '';
    this.actionsEl.innerHTML = '';
  }

  showError(message: string): void {
    this.statusEl.textContent = message;
    this.canvasEl.innerHTML = `<div class="eg-empty eg-error">${escapeHtml(message)}</div>`;
    this.filingsEl.innerHTML = '';
  }

  renderGraph(graph: EnterpriseGraphDto, filings: CompanyFilingDto[] = []): void {
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
    const orgNodes = graph.nodes.filter((n) => n.entityType === 'org');
    const filingNodes = graph.nodes.filter((n) => n.entityType === 'filing');
    const others = graph.nodes.filter(
      (n) => n.entityType !== 'company' && n.entityType !== 'filing' && n.entityType !== 'org',
    );
    const ordered = [
      center,
      ...companyNodes.filter((n) => n.id !== center.id),
      ...orgNodes.filter((n) => n.id !== center.id),
      ...filingNodes.filter((n) => n.id !== center.id),
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

    const relationLabel = (type: string): string => {
      const map: Record<string, string> = {
        filed: '公告',
        subsidiary: '子公司',
        shareholder: '股东',
        controller: '实控人',
        related_party: '关联方',
        guarantee: '担保',
        mentioned_in: '提及',
        related: '相关',
      };
      return map[type] ?? type;
    };

    const lines = graph.edges
      .map((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return '';
        const mx = (from.x + to.x) / 2;
        const my = (from.y + to.y) / 2;
        const relClass = `eg-edge eg-edge-${escapeHtml(edge.relationType)}`;
        return `
          <line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="${relClass}" data-relation="${escapeHtml(edge.relationType)}" />
          <text x="${mx}" y="${my - 4}" text-anchor="middle" class="eg-edge-label">${escapeHtml(relationLabel(edge.relationType))}</text>`;
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
        if (el.classList.contains('eg-node-filing') || el.classList.contains('eg-node-org')) return;
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
      <div class="eg-meta-row">
        <span class="eg-meta-label">${t('components.enterpriseGraph.filings')}</span>
        <span>${filings.length}</span>
      </div>
      <div class="eg-meta-note">${t('components.enterpriseGraph.sourceNote')}</div>
    `;

    this.renderActions(graph.source === 'kg' || graph.source === 'db');
    this.renderFilings(filings);
  }

  private renderActions(enabled: boolean): void {
    if (!enabled || !this.onExtractRelations) {
      this.actionsEl.innerHTML = '';
      return;
    }
    this.actionsEl.innerHTML = `
      <button type="button" class="eg-action-btn" id="egExtractBtn" ${this.extracting ? 'disabled' : ''}>
        ${this.extracting ? t('components.enterpriseGraph.extracting') : t('components.enterpriseGraph.extractRelations')}
      </button>
      <label class="eg-action-check">
        <input type="checkbox" id="egUseLlm" />
        ${t('components.enterpriseGraph.useLlm')}
      </label>
      <label class="eg-action-check">
        <input type="checkbox" id="egForceExtract" />
        ${t('components.enterpriseGraph.forceExtract')}
      </label>
    `;
    this.actionsEl.querySelector('#egExtractBtn')?.addEventListener('click', () => {
      if (!this.onExtractRelations || this.extracting) return;
      const useLlm = (this.actionsEl.querySelector('#egUseLlm') as HTMLInputElement).checked;
      const force = (this.actionsEl.querySelector('#egForceExtract') as HTMLInputElement).checked;
      this.onExtractRelations({ useLlm, force });
    });
  }

  private renderFilings(filings: CompanyFilingDto[]): void {
    if (!filings.length) {
      this.filingsEl.innerHTML = `
        <div class="eg-filings-head">${t('components.enterpriseGraph.filingsTitle')}</div>
        <div class="eg-filings-empty">${t('components.enterpriseGraph.filingsEmpty')}</div>`;
      return;
    }

    const rows = filings
      .map((f) => {
        const title = f.title?.trim() || f.sourceDocId || f.id.slice(0, 8);
        const date = f.publishedAt
          ? new Date(f.publishedAt).toLocaleDateString()
          : '—';
        const status = f.parseStatus || '—';
        const statusClass =
          status === 'failed' ? ' eg-filing-status-failed'
            : status === 'partial' ? ' eg-filing-status-partial'
              : '';
        const link = f.sourceUrl
          ? `<a class="eg-filing-link" href="${escapeHtml(f.sourceUrl)}" target="_blank" rel="noopener noreferrer">${t('components.enterpriseGraph.openPdf')}</a>`
          : '';
        return `
          <li class="eg-filing-item${statusClass}" data-status="${escapeHtml(status)}">
            <div class="eg-filing-title">${escapeHtml(title.slice(0, 120))}</div>
            <div class="eg-filing-meta">
              <span>${escapeHtml(date)}</span>
              <span class="eg-filing-status">${escapeHtml(status)}</span>
              ${link}
            </div>
          </li>`;
      })
      .join('');

    const failedN = filings.filter((f) => f.parseStatus === 'failed' || f.parseStatus === 'partial').length;
    const hint = failedN > 0
      ? `<div class="eg-filings-hint">${t('components.enterpriseGraph.filingsFailedHint', { count: String(failedN) })}</div>`
      : '';

    this.filingsEl.innerHTML = `
      <div class="eg-filings-head">${t('components.enterpriseGraph.filingsTitle')}</div>
      ${hint}
      <ul class="eg-filings-list">${rows}</ul>`;
  }

  private renderNode(
    node: EnterpriseGraphNodeDto,
    pos: { x: number; y: number },
    isCenter: boolean,
  ): string {
    const isFiling = node.entityType === 'filing';
    const isOrg = node.entityType === 'org';
    const label = isFiling
      ? 'DOC'
      : isOrg
        ? node.name.slice(0, 4)
        : node.symbol.length <= 8
          ? node.symbol
          : node.symbol.slice(0, 8);
    const r = isCenter ? 34 : isFiling ? 18 : isOrg ? 22 : 26;
    const typeClass = isFiling ? ' eg-node-filing' : isOrg ? ' eg-node-org' : '';
    const circleClass = isFiling
      ? ' eg-node-circle-filing'
      : isOrg
        ? ' eg-node-circle-org'
        : '';
    return `
      <g class="eg-node ${isCenter ? 'eg-node-center' : ''}${typeClass}" data-symbol="${escapeHtml(node.symbol)}" data-market="${escapeHtml(node.market ?? '')}" style="cursor:${isFiling || isOrg ? 'default' : 'pointer'}">
        <circle cx="${pos.x}" cy="${pos.y}" r="${r}" class="eg-node-circle${circleClass}" />
        <text x="${pos.x}" y="${pos.y - 4}" text-anchor="middle" class="eg-node-symbol">${escapeHtml(label)}</text>
        <text x="${pos.x}" y="${pos.y + 12}" text-anchor="middle" class="eg-node-name">${escapeHtml(node.name.slice(0, 14))}</text>
      </g>
    `;
  }

  destroy(): void {
    this.root.innerHTML = '';
  }
}

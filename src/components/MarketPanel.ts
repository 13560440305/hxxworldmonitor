import { Panel } from './Panel';
import { t } from '@/services/i18n';
import type { MarketData, CryptoData } from '@/types';
import { formatPrice, formatChange, getChangeClass, getHeatmapClass } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import { miniSparkline } from '@/utils/sparkline';



export class MarketPanel extends Panel {
  constructor() {
    super({ id: 'markets', title: t('panels.markets') });
  }

  public renderMarkets(data: MarketData[], rateLimited?: boolean): void {
    if (data.length === 0) {
      this.showError(rateLimited ? t('common.rateLimitedMarket') : t('common.failedMarketData'));
      return;
    }

    const html = data
      .map(
        (stock) => `
      <div class="market-item">
        <div class="market-info">
          <span class="market-name">${escapeHtml(stock.name)}</span>
          <span class="market-symbol">${escapeHtml(stock.display)}</span>
        </div>
        <div class="market-data">
          ${miniSparkline(stock.sparkline, stock.change)}
          <span class="market-price">${formatPrice(stock.price!)}</span>
          <span class="market-change ${getChangeClass(stock.change!)}">${formatChange(stock.change!)}</span>
        </div>
      </div>
    `
      )
      .join('');

    this.setContent(html);
  }
}

export class StocksPanel extends Panel {
  private market: 'us' | 'hk' | 'eu' | 'cn' = 'us';
  private selectable = false;
  private allowedSymbols: Set<string> | null = null;
  private onCompanySelect: ((symbol: string, market: string) => void) | null = null;
  private lastData: MarketData[] = [];
  private lastRateLimited: boolean | undefined;

  constructor() {
    super({ id: 'stocks', title: t('panels.stocks') });
  }

  setRegionFilter(region: string, market?: 'us' | 'hk' | 'eu' | 'cn'): void {
    if (market) this.market = market;
    else this.market = region === 'asia' ? 'cn' : region === 'eu' ? 'eu' : 'us';
    this.rerenderIfReady();
  }

  setAllowedSymbols(symbols: Set<string> | null): void {
    this.allowedSymbols = symbols;
    this.rerenderIfReady();
  }

  setSelectableMode(enabled: boolean): void {
    this.selectable = enabled;
    this.rerenderIfReady();
  }

  setOnCompanySelect(handler: ((symbol: string, market: string) => void) | null): void {
    this.onCompanySelect = handler;
  }

  getActiveMarket(): string {
    return this.market;
  }

  public renderStocks(data: MarketData[], rateLimited?: boolean): void {
    this.lastData = data;
    this.lastRateLimited = rateLimited;
    this.paintStocks();
  }

  /** Render catalog/API companies (quotes merged when available in lastData). */
  public renderCompanyList(
    companies: Array<{ symbol: string; name: string; display: string; market: string }>,
  ): void {
    const quoteBySymbol = new Map(this.lastData.map((row) => [row.symbol.toUpperCase(), row]));
    const rows: MarketData[] = companies.map((c) => {
      const quote = quoteBySymbol.get(c.symbol.toUpperCase());
      return quote ?? {
        symbol: c.symbol,
        name: c.name,
        display: c.display,
        price: null,
        change: null,
      };
    });
    this.paintRows(rows);
  }

  private rerenderIfReady(): void {
    if (this.lastData.length > 0 || this.allowedSymbols) {
      this.paintStocks();
    }
  }

  private paintStocks(): void {
    this.paintRows(this.filterRows(this.lastData));
  }

  private paintRows(rows: MarketData[]): void {
    if (rows.length === 0) {
      this.showError(
        this.lastRateLimited
          ? t('common.rateLimitedMarket')
          : t('components.enterpriseGraph.noStocksForRegion'),
      );
      return;
    }

    const html = rows
      .map(
        (stock) => `
      <div class="market-item${this.selectable ? ' market-item-selectable' : ''}" data-symbol="${escapeHtml(stock.symbol)}" data-market="${escapeHtml(this.market)}">
        <div class="market-info">
          <span class="market-name">${escapeHtml(stock.name)}</span>
          <span class="market-symbol">${escapeHtml(stock.display)}</span>
        </div>
        <div class="market-data">
          ${stock.price != null ? miniSparkline(stock.sparkline, stock.change) : ''}
          <span class="market-price">${stock.price != null ? formatPrice(stock.price) : '—'}</span>
          <span class="market-change ${stock.change != null ? getChangeClass(stock.change) : ''}">${stock.change != null ? formatChange(stock.change) : ''}</span>
        </div>
      </div>
    `,
      )
      .join('');

    this.setContent(html);

    if (this.selectable) {
      this.getElement().querySelectorAll<HTMLElement>('.market-item-selectable').forEach((el) => {
        el.addEventListener('click', () => {
          const symbol = el.dataset.symbol;
          const market = el.dataset.market ?? this.market;
          if (symbol && this.onCompanySelect) {
            this.onCompanySelect(symbol, market);
          }
        });
      });
    }
  }

  private filterRows(data: MarketData[]): MarketData[] {
    if (this.allowedSymbols && this.allowedSymbols.size > 0) {
      return data.filter((row) => this.allowedSymbols!.has(row.symbol.toUpperCase()));
    }
    return data;
  }
}

export class HeatmapPanel extends Panel {
  constructor() {
    super({ id: 'heatmap', title: t('panels.heatmap') });
  }

  public renderHeatmap(data: Array<{ name: string; change: number | null }>): void {
    const validData = data.filter((d) => d.change !== null);

    if (validData.length === 0) {
      this.showError(t('common.failedSectorData'));
      return;
    }

    const html =
      '<div class="heatmap">' +
      validData
        .map(
          (sector) => `
        <div class="heatmap-cell ${getHeatmapClass(sector.change!)}">
          <div class="sector-name">${escapeHtml(sector.name)}</div>
          <div class="sector-change ${getChangeClass(sector.change!)}">${formatChange(sector.change!)}</div>
        </div>
      `
        )
        .join('') +
      '</div>';

    this.setContent(html);
  }
}

export class CommoditiesPanel extends Panel {
  constructor() {
    super({ id: 'commodities', title: t('panels.commodities') });
  }

  public renderCommodities(data: Array<{ display: string; price: number | null; change: number | null; sparkline?: number[] }>): void {
    const validData = data.filter((d) => d.price !== null);

    if (validData.length === 0) {
      this.showError(t('common.failedCommodities'));
      return;
    }

    const html =
      '<div class="commodities-grid">' +
      validData
        .map(
          (c) => `
        <div class="commodity-item">
          <div class="commodity-name">${escapeHtml(c.display)}</div>
          ${miniSparkline(c.sparkline, c.change, 60, 18)}
          <div class="commodity-price">${formatPrice(c.price!)}</div>
          <div class="commodity-change ${getChangeClass(c.change!)}">${formatChange(c.change!)}</div>
        </div>
      `
        )
        .join('') +
      '</div>';

    this.setContent(html);
  }
}

export class CryptoPanel extends Panel {
  constructor() {
    super({ id: 'crypto', title: t('panels.crypto') });
  }

  public renderCrypto(data: CryptoData[]): void {
    if (data.length === 0) {
      this.showError(t('common.failedCryptoData'));
      return;
    }

    const html = data
      .map(
        (coin) => `
      <div class="market-item">
        <div class="market-info">
          <span class="market-name">${escapeHtml(coin.name)}</span>
          <span class="market-symbol">${escapeHtml(coin.symbol)}</span>
        </div>
        <div class="market-data">
          ${miniSparkline(coin.sparkline, coin.change)}
          <span class="market-price">$${coin.price.toLocaleString()}</span>
          <span class="market-change ${getChangeClass(coin.change)}">${formatChange(coin.change)}</span>
        </div>
      </div>
    `
      )
      .join('');

    this.setContent(html);
  }
}

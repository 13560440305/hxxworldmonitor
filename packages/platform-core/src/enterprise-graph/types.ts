/** Supported equity markets — each maps to a dedicated executor ingest handler. */
export type EnterpriseGraphMarketId = 'us' | 'hk' | 'eu' | 'cn';

export interface EnterpriseGraphMarket {
  id: EnterpriseGraphMarketId;
  name: string;
  currency: string;
  /** Map region keys aligned with frontend `regionSelect` values. */
  regionKeys: string[];
  /** Job handler key executed by platform:executor for this market's data source. */
  sourceHandlerKey: string;
  /** Human-readable data source label (for admin / debugging). */
  sourceLabel: string;
  status: 'active' | 'stub';
}

export interface EnterpriseGraphCompany {
  symbol: string;
  name: string;
  display: string;
  market: EnterpriseGraphMarketId;
  regions: string[];
  sector?: string;
  price?: number | null;
  change?: number | null;
}

export interface EnterpriseGraphNode {
  id: string;
  symbol: string;
  name: string;
  entityType: 'company' | 'news_item' | 'sector';
  market?: EnterpriseGraphMarketId;
  props?: Record<string, unknown>;
}

export interface EnterpriseGraphEdge {
  from: string;
  to: string;
  relationType: string;
  props?: Record<string, unknown>;
}

export interface EnterpriseGraphResponse {
  center: EnterpriseGraphNode;
  nodes: EnterpriseGraphNode[];
  edges: EnterpriseGraphEdge[];
  market: EnterpriseGraphMarketId;
  source: 'kg' | 'catalog';
  depth: number;
}

export interface EnterpriseGraphIngestResult {
  market: EnterpriseGraphMarketId;
  status: 'stub' | 'ok' | 'error';
  message: string;
  entitiesUpserted?: number;
  edgesUpserted?: number;
}

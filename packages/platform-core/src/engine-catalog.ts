/** Built-in acquisition engines — base_url + api_key stored in DB; paths stay in ingest plugin code. */

export type EngineType = 'crawl' | 'browser' | 'custom';

export interface EngineDefinition {
  slug: string;
  displayName: string;
  engineType: EngineType;
  defaultBaseUrl: string;
  sortOrder: number;
  envApiKey?: string;
  envBaseUrl?: string;
  apiKeyOptional?: boolean;
  defaultRemarks?: string;
}

export const ENGINE_CATALOG: EngineDefinition[] = [
  {
    slug: 'firecrawl',
    displayName: 'Firecrawl',
    engineType: 'crawl',
    defaultBaseUrl: 'https://api.firecrawl.dev',
    sortOrder: 10,
    envApiKey: 'FIRECRAWL_API_KEY',
    envBaseUrl: 'FIRECRAWL_API_URL',
    defaultRemarks: '网页采集引擎（Firecrawl）。供 platform:executor 披露/图谱流水线调用；具体抓取 URL 与解析逻辑写在 ingest 插件代码中。',
  },
];

export const ENGINE_TYPE_LABELS: Record<EngineType, string> = {
  crawl: '网页采集',
  browser: '浏览器自动化',
  custom: '自定义',
};

export function getEngineDefinition(slug: string): EngineDefinition | undefined {
  return ENGINE_CATALOG.find((e) => e.slug === slug);
}

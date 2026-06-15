/** Built-in third-party providers — only base_url + api_key are stored in DB; paths stay in code. */

export type IntegrationProviderCategory =
  | 'platform'
  | 'ai'
  | 'market'
  | 'energy'
  | 'geo'
  | 'military'
  | 'aviation'
  | 'cyber'
  | 'relay';

export interface IntegrationProviderDefinition {
  slug: string;
  displayName: string;
  category: IntegrationProviderCategory;
  /** Default API root; admin may override in DB. Specific paths are hardcoded in handlers. */
  defaultBaseUrl: string;
  sortOrder: number;
  /** Fallback when DB api_key is empty */
  envApiKey?: string;
  /** Fallback when DB base_url equals default and env is set */
  envBaseUrl?: string;
  /** Default LLM model (OpenAI-compatible providers only) */
  defaultModel?: string;
  /** Env fallback for model name */
  envModel?: string;
  /** Local / self-hosted endpoints may work without an API key */
  apiKeyOptional?: boolean;
  /** Admin list hint — seeded into remarks when empty; users may override in /admin */
  defaultRemarks?: string;
}

export const INTEGRATION_PROVIDER_CATALOG: IntegrationProviderDefinition[] = [
  {
    slug: 'hxxbot',
    displayName: 'HXXBOT',
    category: 'platform',
    defaultBaseUrl: 'https://www.hxxbot.com/api',
    sortOrder: 10,
    envApiKey: 'HXXBOT_API_KEY',
    envBaseUrl: 'HXXBOT_API_URL',
    defaultRemarks: 'HXXBOT 开放平台。Base URL 填 https://www.hxxbot.com/api（与 hxxnote AI邮件 相同）。订阅发信走 builtin.email_send。',
  },
  {
    slug: 'groq',
    displayName: 'Groq',
    category: 'ai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
    sortOrder: 20,
    envApiKey: 'GROQ_API_KEY',
    defaultRemarks: '美国 Groq Inc.，云端 LLM 推理（OpenAI 兼容）。用于 AI 摘要。',
  },
  {
    slug: 'openrouter',
    displayName: 'OpenRouter',
    category: 'ai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    sortOrder: 30,
    envApiKey: 'OPENROUTER_API_KEY',
    defaultRemarks: 'OpenRouter（美国），聚合多家 LLM 的路由网关。用于 AI 摘要备选。',
  },
  {
    slug: 'ollama',
    displayName: 'OpenAI 兼容 LLM',
    category: 'ai',
    defaultBaseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.1:8b',
    sortOrder: 40,
    envBaseUrl: 'OLLAMA_API_URL',
    envApiKey: 'OLLAMA_API_KEY',
    envModel: 'OLLAMA_MODEL',
    apiKeyOptional: true,
    defaultRemarks: '本地/自托管 OpenAI 兼容端点（如 Ollama、LM Studio）。默认本机，无公网厂商。',
  },
  {
    slug: 'finnhub',
    displayName: 'Finnhub',
    category: 'market',
    defaultBaseUrl: 'https://finnhub.io/api/v1',
    sortOrder: 50,
    envApiKey: 'FINNHUB_API_KEY',
    defaultRemarks: '美国 Finnhub Inc. · 全球股票、外汇、加密货币行情与公司基本面。',
  },
  {
    slug: 'fred',
    displayName: 'FRED',
    category: 'market',
    defaultBaseUrl: 'https://api.stlouisfed.org/fred',
    sortOrder: 60,
    envApiKey: 'FRED_API_KEY',
    defaultRemarks: '美国圣路易斯联邦储备银行（Fed）· FRED 宏观经济学时间序列数据库。',
  },
  {
    slug: 'eia',
    displayName: 'EIA',
    category: 'energy',
    defaultBaseUrl: 'https://api.eia.gov/v2',
    sortOrder: 70,
    envApiKey: 'EIA_API_KEY',
    defaultRemarks: '美国能源信息署（U.S. EIA）· 石油、天然气、电力等能源官方统计。',
  },
  {
    slug: 'wto',
    displayName: 'WTO',
    category: 'market',
    defaultBaseUrl: 'https://api.wto.org/api',
    sortOrder: 80,
    envApiKey: 'WTO_API_KEY',
    defaultRemarks: '瑞士日内瓦 · 世界贸易组织（WTO）国际贸易与关税数据。',
  },
  {
    slug: 'acled',
    displayName: 'ACLED',
    category: 'geo',
    defaultBaseUrl: 'https://api.acleddata.com',
    sortOrder: 90,
    envApiKey: 'ACLED_ACCESS_TOKEN',
    defaultRemarks: 'ACLED（美/英）· 全球武装冲突、抗议与政治暴力事件数据库。',
  },
  {
    slug: 'cloudflare',
    displayName: 'Cloudflare Radar',
    category: 'geo',
    defaultBaseUrl: 'https://api.cloudflare.com/client/v4',
    sortOrder: 100,
    envApiKey: 'CLOUDFLARE_API_TOKEN',
    defaultRemarks: '美国 Cloudflare · Radar 互联网流量、中断与连通性监测。',
  },
  {
    slug: 'nasa_firms',
    displayName: 'NASA FIRMS',
    category: 'geo',
    defaultBaseUrl: 'https://firms.modaps.eosdis.nasa.gov/api',
    sortOrder: 110,
    envApiKey: 'NASA_FIRMS_API_KEY',
    defaultRemarks: '美国 NASA · FIRMS 全球野火/热点卫星遥感（MODIS/VIIRS）。',
  },
  {
    slug: 'wingbits',
    displayName: 'Wingbits',
    category: 'military',
    defaultBaseUrl: 'https://customer-api.wingbits.com/v1',
    sortOrder: 120,
    envApiKey: 'WINGBITS_API_KEY',
    defaultRemarks: 'Wingbits（欧洲）· ADS-B 军机与航班追踪 API。',
  },
  {
    slug: 'aviationstack',
    displayName: 'AviationStack',
    category: 'aviation',
    defaultBaseUrl: 'http://api.aviationstack.com/v1',
    sortOrder: 130,
    envApiKey: 'AVIATIONSTACK_API',
    defaultRemarks: 'AviationStack / APILayer · 全球商业航班实时与历史状态。',
  },
  {
    slug: 'icao',
    displayName: 'ICAO',
    category: 'aviation',
    defaultBaseUrl: 'https://applications.icao.int',
    sortOrder: 140,
    envApiKey: 'ICAO_API_KEY',
    defaultRemarks: '加拿大蒙特利尔 · 国际民航组织（ICAO）航空统计数据。',
  },
  {
    slug: 'urlhaus',
    displayName: 'URLhaus',
    category: 'cyber',
    defaultBaseUrl: 'https://urlhaus-api.abuse.ch/v1',
    sortOrder: 150,
    envApiKey: 'URLHAUS_AUTH_KEY',
    defaultRemarks: '瑞士 abuse.ch · URLhaus 恶意链接与 malware 分发情报。',
  },
  {
    slug: 'otx',
    displayName: 'AlienVault OTX',
    category: 'cyber',
    defaultBaseUrl: 'https://otx.alienvault.com/api/v1',
    sortOrder: 160,
    envApiKey: 'OTX_API_KEY',
    defaultRemarks: 'AT&T AlienVault OTX（美国）· 开源威胁情报与 IoC 社区。',
  },
  {
    slug: 'abuseipdb',
    displayName: 'AbuseIPDB',
    category: 'cyber',
    defaultBaseUrl: 'https://api.abuseipdb.com/api/v2',
    sortOrder: 170,
    envApiKey: 'ABUSEIPDB_API_KEY',
    defaultRemarks: 'AbuseIPDB（美国）· IP 地址滥用举报与信誉查询。',
  },
  {
    slug: 'relay',
    displayName: 'AIS / RSS Relay',
    category: 'relay',
    defaultBaseUrl: '',
    sortOrder: 180,
    envBaseUrl: 'WS_RELAY_URL',
    envApiKey: 'RELAY_SHARED_SECRET',
    defaultRemarks: '自托管 WebSocket 中继（本地 Docker 或 Railway）。AIS、OpenSky、RSS、Telegram 等聚合转发，非单一商业 API。',
  },
];

export function getProviderDefinition(slug: string): IntegrationProviderDefinition | undefined {
  return INTEGRATION_PROVIDER_CATALOG.find((p) => p.slug === slug);
}

export function isAiProviderSlug(slug: string): boolean {
  return getProviderDefinition(slug)?.category === 'ai';
}

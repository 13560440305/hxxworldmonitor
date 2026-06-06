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
  },
  {
    slug: 'groq',
    displayName: 'Groq',
    category: 'ai',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.1-8b-instant',
    sortOrder: 20,
    envApiKey: 'GROQ_API_KEY',
  },
  {
    slug: 'openrouter',
    displayName: 'OpenRouter',
    category: 'ai',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    sortOrder: 30,
    envApiKey: 'OPENROUTER_API_KEY',
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
  },
  {
    slug: 'finnhub',
    displayName: 'Finnhub',
    category: 'market',
    defaultBaseUrl: 'https://finnhub.io/api/v1',
    sortOrder: 50,
    envApiKey: 'FINNHUB_API_KEY',
  },
  {
    slug: 'fred',
    displayName: 'FRED',
    category: 'market',
    defaultBaseUrl: 'https://api.stlouisfed.org/fred',
    sortOrder: 60,
    envApiKey: 'FRED_API_KEY',
  },
  {
    slug: 'eia',
    displayName: 'EIA',
    category: 'energy',
    defaultBaseUrl: 'https://api.eia.gov/v2',
    sortOrder: 70,
    envApiKey: 'EIA_API_KEY',
  },
  {
    slug: 'wto',
    displayName: 'WTO',
    category: 'market',
    defaultBaseUrl: 'https://api.wto.org/api',
    sortOrder: 80,
    envApiKey: 'WTO_API_KEY',
  },
  {
    slug: 'acled',
    displayName: 'ACLED',
    category: 'geo',
    defaultBaseUrl: 'https://api.acleddata.com',
    sortOrder: 90,
    envApiKey: 'ACLED_ACCESS_TOKEN',
  },
  {
    slug: 'cloudflare',
    displayName: 'Cloudflare Radar',
    category: 'geo',
    defaultBaseUrl: 'https://api.cloudflare.com/client/v4',
    sortOrder: 100,
    envApiKey: 'CLOUDFLARE_API_TOKEN',
  },
  {
    slug: 'nasa_firms',
    displayName: 'NASA FIRMS',
    category: 'geo',
    defaultBaseUrl: 'https://firms.modaps.eosdis.nasa.gov/api',
    sortOrder: 110,
    envApiKey: 'NASA_FIRMS_API_KEY',
  },
  {
    slug: 'wingbits',
    displayName: 'Wingbits',
    category: 'military',
    defaultBaseUrl: 'https://customer-api.wingbits.com/v1',
    sortOrder: 120,
    envApiKey: 'WINGBITS_API_KEY',
  },
  {
    slug: 'aviationstack',
    displayName: 'AviationStack',
    category: 'aviation',
    defaultBaseUrl: 'http://api.aviationstack.com/v1',
    sortOrder: 130,
    envApiKey: 'AVIATIONSTACK_API',
  },
  {
    slug: 'icao',
    displayName: 'ICAO',
    category: 'aviation',
    defaultBaseUrl: 'https://applications.icao.int',
    sortOrder: 140,
    envApiKey: 'ICAO_API_KEY',
  },
  {
    slug: 'urlhaus',
    displayName: 'URLhaus',
    category: 'cyber',
    defaultBaseUrl: 'https://urlhaus-api.abuse.ch/v1',
    sortOrder: 150,
    envApiKey: 'URLHAUS_AUTH_KEY',
  },
  {
    slug: 'otx',
    displayName: 'AlienVault OTX',
    category: 'cyber',
    defaultBaseUrl: 'https://otx.alienvault.com/api/v1',
    sortOrder: 160,
    envApiKey: 'OTX_API_KEY',
  },
  {
    slug: 'abuseipdb',
    displayName: 'AbuseIPDB',
    category: 'cyber',
    defaultBaseUrl: 'https://api.abuseipdb.com/api/v2',
    sortOrder: 170,
    envApiKey: 'ABUSEIPDB_API_KEY',
  },
  {
    slug: 'relay',
    displayName: 'AIS / RSS Relay',
    category: 'relay',
    defaultBaseUrl: '',
    sortOrder: 180,
    envBaseUrl: 'WS_RELAY_URL',
    envApiKey: 'RELAY_SHARED_SECRET',
  },
];

export function getProviderDefinition(slug: string): IntegrationProviderDefinition | undefined {
  return INTEGRATION_PROVIDER_CATALOG.find((p) => p.slug === slug);
}

export function isAiProviderSlug(slug: string): boolean {
  return getProviderDefinition(slug)?.category === 'ai';
}

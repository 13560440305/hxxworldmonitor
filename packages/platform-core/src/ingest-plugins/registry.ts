import type { IngestPlugin, IngestPluginMeta } from './types.js';
import { pluginHandlerKey } from './types.js';
import { cninfoDisclosurePlugin } from './cninfo-disclosure.js';
import { disclosureRelationExtractPlugin } from './disclosure-relation-extract.js';
import { rssIngestFastPlugin } from './rss-ingest-fast.js';
import { rssIngestFullPlugin } from './rss-ingest-full.js';
import { coldTierArchivePlugin } from './cold-tier-archive.js';
import { embeddingBatchPlugin } from './embedding-batch.js';
import { stockNewsIngestPlugin } from './stock-news-ingest.js';
import { earningsIngestPlugin } from './earnings-ingest.js';
import { knowledgeGraphBuildPlugin } from './knowledge-graph-build.js';
import { enterpriseGraphUsPlugin } from './enterprise-graph-us.js';
import { enterpriseGraphHkPlugin } from './enterprise-graph-hk.js';
import { enterpriseGraphEuPlugin } from './enterprise-graph-eu.js';

const ALL_PLUGINS: IngestPlugin[] = [
  rssIngestFastPlugin,
  rssIngestFullPlugin,
  coldTierArchivePlugin,
  embeddingBatchPlugin,
  stockNewsIngestPlugin,
  earningsIngestPlugin,
  knowledgeGraphBuildPlugin,
  enterpriseGraphUsPlugin,
  enterpriseGraphHkPlugin,
  enterpriseGraphEuPlugin,
  cninfoDisclosurePlugin,
  disclosureRelationExtractPlugin,
];

const plugins = new Map<string, IngestPlugin>();
const byHandlerKey = new Map<string, IngestPlugin>();

function register(plugin: IngestPlugin): void {
  plugins.set(plugin.key, plugin);
  byHandlerKey.set(pluginHandlerKey(plugin), plugin);
}

for (const p of ALL_PLUGINS) {
  register(p);
}

export function registerIngestPlugin(plugin: IngestPlugin): void {
  register(plugin);
}

export function getIngestPlugin(key: string): IngestPlugin | undefined {
  return plugins.get(key);
}

export function getIngestPluginByHandlerKey(handlerKey: string): IngestPlugin | undefined {
  return byHandlerKey.get(handlerKey);
}

export function listIngestPlugins(): IngestPluginMeta[] {
  return [...plugins.values()].map((p) => ({
    key: p.key,
    handlerKey: pluginHandlerKey(p),
    displayName: p.displayName,
    sourceSlug: p.sourceSlug,
    requiresBinding: p.requiresBinding,
    tier: p.tier,
  }));
}

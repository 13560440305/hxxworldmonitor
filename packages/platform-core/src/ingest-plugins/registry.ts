import type { IngestPlugin, IngestPluginMeta } from './types.js';
import { cninfoDisclosurePlugin } from './cninfo-disclosure.js';

const plugins = new Map<string, IngestPlugin>();

function register(plugin: IngestPlugin): void {
  plugins.set(plugin.key, plugin);
}

register(cninfoDisclosurePlugin);

export function registerIngestPlugin(plugin: IngestPlugin): void {
  register(plugin);
}

export function getIngestPlugin(key: string): IngestPlugin | undefined {
  return plugins.get(key);
}

export function listIngestPlugins(): IngestPluginMeta[] {
  return [...plugins.values()].map(({ key, displayName, sourceSlug, tier }) => ({
    key,
    displayName,
    sourceSlug,
    tier,
  }));
}

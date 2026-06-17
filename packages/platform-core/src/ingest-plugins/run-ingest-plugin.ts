import { resolveIngestBinding } from '../ingest-bindings-repository.js';
import type { JobContext } from '../jobs/types.js';
import { getIngestPlugin, getIngestPluginByHandlerKey } from './registry.js';
import type { IngestResult } from './types.js';

export async function runIngestPlugin(
  pluginKey: string,
  ctx: JobContext,
  sourceSlug?: string,
): Promise<IngestResult> {
  const plugin = getIngestPlugin(pluginKey);
  if (!plugin) {
    return {
      status: 'error',
      message: `Ingest plugin not registered: ${pluginKey}`,
    };
  }

  if (!plugin.requiresBinding) {
    return plugin.run(ctx);
  }

  const slug = sourceSlug ?? plugin.sourceSlug;
  if (!slug) {
    return {
      status: 'error',
      message: `Plugin ${pluginKey} requires sourceSlug binding`,
    };
  }

  const binding = await resolveIngestBinding(slug);
  if (!binding.enabled) {
    return {
      status: 'stub',
      message: `采集绑定已禁用: ${binding.sourceSlug}`,
    };
  }

  if (binding.ingestPluginKey !== pluginKey) {
    return {
      status: 'error',
      message: `Binding plugin mismatch: expected ${pluginKey}, got ${binding.ingestPluginKey}`,
    };
  }

  return plugin.run(ctx, {
    binding,
    source: binding.source,
    engine: binding.engine,
  });
}

export async function runIngestPluginForHandler(
  handlerKey: string,
  ctx: JobContext,
): Promise<IngestResult> {
  const plugin = getIngestPluginByHandlerKey(handlerKey);
  if (!plugin) {
    return {
      status: 'error',
      message: `No ingest plugin for handler: ${handlerKey}`,
    };
  }
  return runIngestPlugin(plugin.key, ctx);
}

import { resolveIngestBinding } from '../ingest-bindings-repository.js';
import type { JobContext } from '../jobs/types.js';
import { getIngestPlugin } from './registry.js';
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

  const binding = await resolveIngestBinding(sourceSlug ?? plugin.sourceSlug);
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

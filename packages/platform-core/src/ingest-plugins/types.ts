import type { JobContext } from '../jobs/types.js';
import type { ResolvedEngine } from '../engines-repository.js';
import type { ResolvedIntegrationProvider } from '../integration-providers-repository.js';
import type { ResolvedIngestBinding } from '../ingest-bindings-repository.js';

export interface IngestResult {
  status?: 'ok' | 'stub' | 'error';
  message?: string;
  market?: string;
  entitiesUpserted?: number;
  edgesUpserted?: number;
  [key: string]: unknown;
}

export interface IngestPluginDeps {
  binding: ResolvedIngestBinding;
  source: ResolvedIntegrationProvider | null;
  engine: ResolvedEngine | null;
}

export interface IngestPluginMeta {
  /** Stable plugin id (DB ingest_plugin_key, registry key). */
  key: string;
  /** Job handler_key that dispatches to this plugin. Defaults to key. */
  handlerKey?: string;
  displayName: string;
  tier: 'batch' | 'heavy';
  /** integration_providers slug — required when requiresBinding is true. */
  sourceSlug?: string;
  /** Resolve data_source_ingest_bindings + engine credentials before run. */
  requiresBinding?: boolean;
}

export interface IngestPlugin extends IngestPluginMeta {
  run(ctx: JobContext, deps?: IngestPluginDeps): Promise<IngestResult>;
}

export function pluginHandlerKey(plugin: IngestPluginMeta): string {
  return plugin.handlerKey ?? plugin.key;
}

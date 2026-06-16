import type { JobContext } from '../jobs/types.js';
import type { ResolvedEngine } from '../engines-repository.js';
import type { ResolvedIntegrationProvider } from '../integration-providers-repository.js';
import type { ResolvedIngestBinding } from '../ingest-bindings-repository.js';

export interface IngestResult {
  market?: string;
  status: 'ok' | 'stub' | 'error';
  message?: string;
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
  key: string;
  displayName: string;
  sourceSlug: string;
  tier: 'batch' | 'heavy';
}

export interface IngestPlugin extends IngestPluginMeta {
  run(ctx: JobContext, deps: IngestPluginDeps): Promise<IngestResult>;
}

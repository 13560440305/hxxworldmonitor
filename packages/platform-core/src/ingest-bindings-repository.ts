import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import { assertEngineExists, ensureEngineSeeds, getEngineCached, type ResolvedEngine } from './engines-repository.js';
import { ensureIntegrationProviderSeeds } from './integration-providers-repository.js';
import type { ResolvedIntegrationProvider } from './integration-providers-repository.js';
import { listIngestPlugins } from './ingest-plugins/registry.js';

export interface IngestBindingDefinition {
  sourceSlug: string;
  engineSlug: string;
  ingestPluginKey: string;
}

/** Built-in source ↔ engine ↔ plugin mappings seeded into DB. */
export const INGEST_BINDING_CATALOG: IngestBindingDefinition[] = [
  {
    sourceSlug: 'cninfo',
    engineSlug: 'firecrawl',
    ingestPluginKey: 'cninfo-disclosure',
  },
];

export interface IngestBindingRow {
  workspace_id: string;
  source_slug: string;
  engine_slug: string | null;
  ingest_plugin_key: string;
  config_json: Record<string, unknown>;
  enabled: boolean;
}

export interface IngestBindingPublic {
  sourceSlug: string;
  engineSlug: string | null;
  ingestPluginKey: string;
  ingestPluginDisplayName: string;
  enabled: boolean;
}

export interface ResolvedIngestBinding {
  sourceSlug: string;
  engineSlug: string | null;
  ingestPluginKey: string;
  enabled: boolean;
  source: ResolvedIntegrationProvider | null;
  engine: ResolvedEngine | null;
}

function catalogDef(sourceSlug: string): IngestBindingDefinition | undefined {
  return INGEST_BINDING_CATALOG.find((b) => b.sourceSlug === sourceSlug);
}

export async function ensureIngestBindingSeeds(workspaceId?: string): Promise<number> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureIntegrationProviderSeeds(ws);
  await ensureEngineSeeds(ws);
  let inserted = 0;
  for (const b of INGEST_BINDING_CATALOG) {
    const res = await query(
      `INSERT INTO data_source_ingest_bindings
         (workspace_id, source_slug, engine_slug, ingest_plugin_key, enabled)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (workspace_id, source_slug) DO NOTHING`,
      [ws, b.sourceSlug, b.engineSlug, b.ingestPluginKey],
    );
    inserted += res.rowCount ?? 0;
  }
  return inserted;
}

export async function listIngestBindingsPublic(workspaceId?: string): Promise<IngestBindingPublic[]> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureIngestBindingSeeds(ws);
  const res = await query<IngestBindingRow>(
    `SELECT workspace_id, source_slug, engine_slug, ingest_plugin_key, config_json, enabled
     FROM data_source_ingest_bindings WHERE workspace_id = $1
     ORDER BY source_slug ASC`,
    [ws],
  );
  const plugins = listIngestPlugins();
  const pluginNames = new Map(plugins.map((p) => [p.key, p.displayName]));
  return res.rows.map((row) => ({
    sourceSlug: row.source_slug,
    engineSlug: row.engine_slug,
    ingestPluginKey: row.ingest_plugin_key,
    ingestPluginDisplayName: pluginNames.get(row.ingest_plugin_key) ?? row.ingest_plugin_key,
    enabled: row.enabled,
  }));
}

export async function getIngestBindingForSource(
  sourceSlug: string,
  workspaceId?: string,
): Promise<IngestBindingPublic | null> {
  const list = await listIngestBindingsPublic(workspaceId);
  return list.find((b) => b.sourceSlug === sourceSlug) ?? null;
}

export async function resolveIngestBinding(
  sourceSlug: string,
  workspaceId?: string,
): Promise<ResolvedIngestBinding> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureIngestBindingSeeds(ws);

  const res = await query<IngestBindingRow>(
    `SELECT workspace_id, source_slug, engine_slug, ingest_plugin_key, config_json, enabled
     FROM data_source_ingest_bindings WHERE workspace_id = $1 AND source_slug = $2`,
    [ws, sourceSlug],
  );
  const row = res.rows[0];
  const def = catalogDef(sourceSlug);
  const engineSlug = row?.engine_slug ?? def?.engineSlug ?? null;
  const ingestPluginKey = row?.ingest_plugin_key ?? def?.ingestPluginKey ?? '';
  const enabled = row?.enabled ?? true;

  const { getIntegrationProviderCached } = await import('./integration-providers-repository.js');
  const source = await getIntegrationProviderCached(sourceSlug, ws);
  const engine = engineSlug ? await getEngineCached(engineSlug, ws) : null;

  return {
    sourceSlug,
    engineSlug,
    ingestPluginKey,
    enabled,
    source,
    engine,
  };
}

export async function updateIngestBinding(
  sourceSlug: string,
  patch: {
    engineSlug?: string | null;
    enabled?: boolean;
  },
  workspaceId?: string,
): Promise<IngestBindingPublic | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  await ensureIngestBindingSeeds(ws);

  const existing = await query<IngestBindingRow>(
    `SELECT workspace_id, source_slug, engine_slug, ingest_plugin_key, config_json, enabled
     FROM data_source_ingest_bindings WHERE workspace_id = $1 AND source_slug = $2`,
    [ws, sourceSlug],
  );
  const row = existing.rows[0];
  if (!row) return null;

  let engineSlug = row.engine_slug;
  if (patch.engineSlug !== undefined) {
    engineSlug = patch.engineSlug?.trim() || null;
  }
  if (engineSlug) {
    await assertEngineExists(engineSlug, ws);
  }

  const enabled = patch.enabled ?? row.enabled;

  await query(
    `UPDATE data_source_ingest_bindings SET
       engine_slug = $3,
       enabled = $4,
       updated_at = NOW()
     WHERE workspace_id = $1 AND source_slug = $2`,
    [ws, sourceSlug, engineSlug, enabled],
  );

  return getIngestBindingForSource(sourceSlug, ws);
}

export async function upsertIngestBindingForSource(
  sourceSlug: string,
  input: {
    engineSlug?: string | null;
    ingestPluginKey: string;
    enabled?: boolean;
  },
  workspaceId?: string,
): Promise<void> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  if (input.engineSlug) {
    await assertEngineExists(input.engineSlug, ws);
  }
  await query(
    `INSERT INTO data_source_ingest_bindings
       (workspace_id, source_slug, engine_slug, ingest_plugin_key, enabled)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, source_slug) DO UPDATE SET
       engine_slug = COALESCE(EXCLUDED.engine_slug, data_source_ingest_bindings.engine_slug),
       ingest_plugin_key = EXCLUDED.ingest_plugin_key,
       enabled = EXCLUDED.enabled,
       updated_at = NOW()`,
    [ws, sourceSlug, input.engineSlug ?? null, input.ingestPluginKey, input.enabled !== false],
  );
}

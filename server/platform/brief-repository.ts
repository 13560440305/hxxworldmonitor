import { getDefaultWorkspaceId, query } from '../_shared/db.js';
import type { BriefSourceRef } from './brief-sources.js';

export interface BriefRow {
  id: string;
  workspace_id: string;
  brief_type: string;
  scope_key: string;
  title: string | null;
  body: string;
  source_refs_json: unknown;
  generated_at: Date;
}

const briefColumns = `id, workspace_id, brief_type, scope_key, title, body, source_refs_json, generated_at`;

export async function saveBrief(opts: {
  workspaceId?: string;
  briefType: string;
  scopeKey: string;
  title?: string;
  body: string;
  sourceRefs?: BriefSourceRef[];
}): Promise<BriefRow> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const sourceRefsJson = JSON.stringify(opts.sourceRefs ?? []);
  const res = await query<BriefRow>(
    `INSERT INTO briefs (workspace_id, brief_type, scope_key, title, body, source_refs_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING ${briefColumns}`,
    [workspaceId, opts.briefType, opts.scopeKey, opts.title ?? null, opts.body, sourceRefsJson],
  );
  return res.rows[0]!;
}

export async function getLatestBrief(opts: {
  workspaceId?: string;
  briefType: string;
  scopeKey: string;
}): Promise<BriefRow | null> {
  const workspaceId = opts.workspaceId ?? getDefaultWorkspaceId();
  const res = await query<BriefRow>(
    `SELECT ${briefColumns}
     FROM briefs
     WHERE workspace_id = $1 AND brief_type = $2 AND scope_key = $3
     ORDER BY generated_at DESC
     LIMIT 1`,
    [workspaceId, opts.briefType, opts.scopeKey],
  );
  return res.rows[0] ?? null;
}

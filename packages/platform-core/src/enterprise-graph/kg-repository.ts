import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import type { EnterpriseGraphEdge, EnterpriseGraphNode } from './types.js';

interface KgEntityRow {
  id: string;
  entity_type: string;
  external_key: string;
  name: string;
  props_json: Record<string, unknown>;
}

interface KgEdgeRow {
  from_entity_id: string;
  to_entity_id: string;
  relation_type: string;
  props_json: Record<string, unknown>;
  from_key: string;
  from_type: string;
  from_name: string;
  to_key: string;
  to_type: string;
  to_name: string;
}

export async function findKgCompanyBySymbol(
  symbol: string,
  workspaceId?: string,
): Promise<KgEntityRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const res = await query<KgEntityRow>(
    `SELECT id, entity_type, external_key, name, props_json
     FROM kg_entities
     WHERE workspace_id = $1 AND entity_type = 'company' AND upper(external_key) = upper($2)
     LIMIT 1`,
    [ws, symbol],
  );
  return res.rows[0] ?? null;
}

export async function listKgCompanies(opts: {
  workspaceId?: string;
  limit?: number;
}): Promise<KgEntityRow[]> {
  const ws = opts.workspaceId ?? getDefaultWorkspaceId();
  const limit = opts.limit ?? 100;
  const res = await query<KgEntityRow>(
    `SELECT id, entity_type, external_key, name, props_json
     FROM kg_entities
     WHERE workspace_id = $1 AND entity_type = 'company'
     ORDER BY updated_at DESC
     LIMIT $2`,
    [ws, limit],
  );
  return res.rows;
}

export async function getKgNeighborGraph(
  companyEntityId: string,
  _depth: number,
  workspaceId?: string,
): Promise<{ nodes: EnterpriseGraphNode[]; edges: EnterpriseGraphEdge[] }> {
  const ws = workspaceId ?? getDefaultWorkspaceId();

  const res = await query<KgEdgeRow>(
    `SELECT
       ed.from_entity_id,
       ed.to_entity_id,
       ed.relation_type,
       ed.props_json,
       fe.external_key AS from_key,
       fe.entity_type AS from_type,
       fe.name AS from_name,
       te.external_key AS to_key,
       te.entity_type AS to_type,
       te.name AS to_name
     FROM kg_edges ed
     JOIN kg_entities fe ON fe.id = ed.from_entity_id
     JOIN kg_entities te ON te.id = ed.to_entity_id
     WHERE ed.workspace_id = $1
       AND (ed.from_entity_id = $2 OR ed.to_entity_id = $2)`,
    [ws, companyEntityId],
  );

  const nodeMap = new Map<string, EnterpriseGraphNode>();
  const edges: EnterpriseGraphEdge[] = [];

  for (const row of res.rows) {
    const fromNode: EnterpriseGraphNode = {
      id: row.from_key,
      symbol: row.from_type === 'company' ? row.from_key : row.from_key,
      name: row.from_name,
      entityType: row.from_type as EnterpriseGraphNode['entityType'],
      props: row.props_json,
    };
    const toNode: EnterpriseGraphNode = {
      id: row.to_key,
      symbol: row.to_type === 'company' ? row.to_key : row.to_key,
      name: row.to_name,
      entityType: row.to_type as EnterpriseGraphNode['entityType'],
      props: row.props_json,
    };
    nodeMap.set(fromNode.id, fromNode);
    nodeMap.set(toNode.id, toNode);
    edges.push({
      from: fromNode.id,
      to: toNode.id,
      relationType: row.relation_type,
    });
  }

  return { nodes: [...nodeMap.values()], edges };
}

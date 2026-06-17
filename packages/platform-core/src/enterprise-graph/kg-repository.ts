import { getDefaultWorkspaceId, query } from '@hxxworldmonitor/shared/db.js';
import { companyExternalKey } from './geo.js';
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

function normalizeSymbol(symbol: string): string {
  const digits = symbol.replace(/\D/g, '');
  if (digits.length >= 4 && digits.length <= 6) return digits.padStart(6, '0');
  return symbol.trim();
}

export async function findKgCompanyBySymbol(
  symbol: string,
  market?: string,
  workspaceId?: string,
): Promise<KgEntityRow | null> {
  const ws = workspaceId ?? getDefaultWorkspaceId();
  const sym = normalizeSymbol(symbol);

  const exact = await query<KgEntityRow>(
    `SELECT id, entity_type, external_key, name, props_json
     FROM kg_entities
     WHERE workspace_id = $1 AND entity_type = 'company' AND upper(external_key) = upper($2)
     LIMIT 1`,
    [ws, sym],
  );
  if (exact.rows[0]) return exact.rows[0];

  const suffix = `:${sym}`;
  let sql = `
    SELECT id, entity_type, external_key, name, props_json
    FROM kg_entities
    WHERE workspace_id = $1 AND entity_type = 'company'
      AND (external_key LIKE $2 OR props_json->>'symbol' = $3)`;
  const params: unknown[] = [ws, `%${suffix}`, sym];
  if (market) {
    const patternIdx = params.length + 1;
    params.push(`${market}:%:${sym}`);
    const marketIdx = params.length + 1;
    params.push(market);
    sql += ` AND (external_key LIKE $${patternIdx} OR props_json->>'market' = $${marketIdx})`;
  }
  sql += ' ORDER BY updated_at DESC LIMIT 1';

  const byMarket = await query<KgEntityRow>(sql, params);
  return byMarket.rows[0] ?? null;
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

function entityToNode(row: {
  external_key: string;
  entity_type: string;
  name: string;
  props_json: Record<string, unknown>;
}): EnterpriseGraphNode {
  const entityType = row.entity_type as EnterpriseGraphNode['entityType'];
  const props = row.props_json ?? {};
  const market = typeof props.market === 'string' ? props.market : undefined;
  let symbol = row.external_key;
  if (entityType === 'company' && row.external_key.includes(':')) {
    const parts = row.external_key.split(':');
    symbol = parts[parts.length - 1] ?? row.external_key;
  } else if (entityType === 'filing') {
    symbol = row.name.slice(0, 16) || 'filing';
  }
  return {
    id: row.external_key,
    symbol,
    name: row.name,
    entityType,
    market: market as EnterpriseGraphNode['market'],
    props,
  };
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
       fe.props_json AS from_props,
       te.external_key AS to_key,
       te.entity_type AS to_type,
       te.name AS to_name,
       te.props_json AS to_props
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
    const fromNode = entityToNode({
      external_key: row.from_key,
      entity_type: row.from_type,
      name: row.from_name,
      props_json: (row as { from_props?: Record<string, unknown> }).from_props ?? row.props_json,
    });
    const toNode = entityToNode({
      external_key: row.to_key,
      entity_type: row.to_type,
      name: row.to_name,
      props_json: (row as { to_props?: Record<string, unknown> }).to_props ?? row.props_json,
    });
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

export { companyExternalKey };

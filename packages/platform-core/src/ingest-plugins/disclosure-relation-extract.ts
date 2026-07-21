import { getDefaultWorkspaceId } from '@hxxworldmonitor/shared/db.js';
import { runDisclosureRelationExtractBatch } from '../enterprise-graph/cninfo/pipeline.js';
import type { IngestPlugin } from './types.js';

export const disclosureRelationExtractPlugin: IngestPlugin = {
  key: 'disclosure-relation-extract',
  handlerKey: 'disclosure-relation-extract',
  displayName: '披露正文关系抽取（规则/可选LLM）',
  tier: 'heavy',
  async run(ctx) {
    const symbols = Array.isArray(ctx.payload.symbols)
      ? ctx.payload.symbols.map(String)
      : undefined;
    const limit = typeof ctx.payload.limit === 'number' ? ctx.payload.limit : 100;
    const useLlm = ctx.payload.useLlm === true;
    const force = ctx.payload.force === true;
    const workspaceId =
      typeof ctx.payload.workspaceId === 'string'
        ? ctx.payload.workspaceId
        : getDefaultWorkspaceId();

    const result = await runDisclosureRelationExtractBatch({
      workspaceId,
      symbols,
      limit,
      useLlm,
      force,
      signal: ctx.signal,
    });

    return {
      ...result,
      message: `relation extract (${result.method}): scanned=${result.scanned} relations=${result.relationsExtracted} edges=${result.edgesUpserted}`,
    };
  },
};

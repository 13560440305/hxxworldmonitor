import { isHxxbotConfigured } from '@hxxworldmonitor/shared/hxxbot-config.js';
import { runQaSession } from '../../hxxbot-qa.js';
import {
  extractDisclosureRelations,
  type DisclosureRelationType,
  type ExtractedRelation,
} from './relation-extract.js';

const ALLOWED_TYPES = new Set<DisclosureRelationType>([
  'subsidiary',
  'shareholder',
  'related_party',
  'guarantee',
  'controller',
]);

function parseLlmRelations(answer: string): ExtractedRelation[] {
  const start = answer.indexOf('[');
  const end = answer.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(answer.slice(start, end + 1)) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: ExtractedRelation[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const relationType = String(row.relationType ?? row.type ?? '').trim() as DisclosureRelationType;
      const name = String(row.name ?? '').replace(/\s+/g, '').trim();
      if (!ALLOWED_TYPES.has(relationType) || name.length < 2 || name.length > 60) continue;
      out.push({
        relationType,
        name,
        role: typeof row.role === 'string' ? row.role : undefined,
        evidence: typeof row.evidence === 'string' ? row.evidence.slice(0, 120) : 'llm',
        confidence: Math.min(0.95, Math.max(0.5, Number(row.confidence ?? 0.75))),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function mergeRelations(base: ExtractedRelation[], extra: ExtractedRelation[]): ExtractedRelation[] {
  const map = new Map<string, ExtractedRelation>();
  for (const rel of [...base, ...extra]) {
    const key = `${rel.relationType}::${rel.name}`;
    const prev = map.get(key);
    if (!prev || rel.confidence > prev.confidence) map.set(key, rel);
  }
  return [...map.values()].slice(0, 40);
}

/**
 * Rule extract + optional HXXBOT QA enrichment.
 * LLM is best-effort: failures fall back to rules only.
 */
export async function extractDisclosureRelationsHybrid(opts: {
  plainText: string;
  companyName?: string;
  useLlm?: boolean;
}): Promise<{ relations: ExtractedRelation[]; method: 'rule' | 'rule+llm' }> {
  const rules = extractDisclosureRelations(opts.plainText);
  if (!opts.useLlm || !isHxxbotConfigured()) {
    return { relations: rules, method: 'rule' };
  }

  const snippet = opts.plainText.slice(0, 6000);
  const company = opts.companyName ?? '本公司';
  try {
    const qa = await runQaSession({
      messages: [
        {
          role: 'system',
          content:
            '你是中国A股公告信息抽取助手。只输出 JSON 数组，不要 markdown。每项字段：relationType,name,role,evidence,confidence。relationType 只能是 subsidiary|shareholder|controller|related_party|guarantee。name 为对手方全称。',
        },
        {
          role: 'user',
          content: `上市公司：${company}\n从下列公告正文抽取关系（最多 15 条）：\n${snippet}`,
        },
      ],
    });
    const llmRels = parseLlmRelations(qa.answer).map((r) => ({
      ...r,
      evidence: r.evidence === 'llm' ? 'llm' : r.evidence,
      // mark slightly lower floor for llm-only hits
      confidence: Math.min(r.confidence, 0.9),
    }));
    return { relations: mergeRelations(rules, llmRels), method: 'rule+llm' };
  } catch {
    return { relations: rules, method: 'rule' };
  }
}

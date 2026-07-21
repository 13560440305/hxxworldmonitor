/**
 * Rule-based relation extraction from CN disclosure plain text (Phase 2 MVP).
 * Patterns target common A-share announcement phrasing; not a substitute for LLM NER.
 */

export type DisclosureRelationType =
  | 'subsidiary'
  | 'shareholder'
  | 'related_party'
  | 'guarantee'
  | 'controller';

export interface ExtractedRelation {
  relationType: DisclosureRelationType;
  /** Counterparty display name (company / person / org). */
  name: string;
  /** Optional role hint from the matched pattern. */
  role?: string;
  /** Snippet that triggered the match (for props/debug). */
  evidence: string;
  confidence: number;
}

const COMPANY_NAME =
  '[\\u4e00-\\u9fffA-Za-z0-9（）()·．.\\-]{2,40}(?:股份有限公司|有限责任公司|有限公司|集团有限公司|集团股份有限公司|事务所|基金|合伙企业|监督管理委员会|委员会|人民政府|管理局)';

const PERSON_NAME = '[\\u4e00-\\u9fff]{2,4}(?![\\u4e00-\\u9fff])';

const PARTY_NAME = `(?:${COMPANY_NAME}|${PERSON_NAME})`;

interface PatternRule {
  relationType: DisclosureRelationType;
  role?: string;
  confidence: number;
  /** Must capture group 1 = counterparty name. */
  regex: RegExp;
}

const RULES: PatternRule[] = [
  {
    relationType: 'subsidiary',
    role: '全资子公司',
    confidence: 0.85,
    regex: new RegExp(`全资子公司[「『"“]?(${COMPANY_NAME})[」』"”]?`, 'g'),
  },
  {
    relationType: 'subsidiary',
    role: '控股子公司',
    confidence: 0.8,
    regex: new RegExp(`控股子公司[「『"“]?(${COMPANY_NAME})[」』"”]?`, 'g'),
  },
  {
    relationType: 'subsidiary',
    role: '子公司',
    confidence: 0.7,
    regex: new RegExp(`(?:本公司|公司)之子公司[「『"“]?(${COMPANY_NAME})[」』"”]?`, 'g'),
  },
  {
    relationType: 'shareholder',
    role: '控股股东',
    confidence: 0.85,
    regex: new RegExp(`控股股东[为是]?[「『"“]?(${PARTY_NAME})[」』"”]?`, 'g'),
  },
  {
    relationType: 'controller',
    role: '实际控制人',
    confidence: 0.85,
    regex: new RegExp(`实际控制人[为是]?[「『"“]?(${PARTY_NAME})[」』"”]?`, 'g'),
  },
  {
    relationType: 'shareholder',
    role: '第一大股东',
    confidence: 0.75,
    regex: new RegExp(`第[一1]大股东[为是]?[「『"“]?(${PARTY_NAME})[」』"”]?`, 'g'),
  },
  {
    relationType: 'related_party',
    role: '关联方',
    confidence: 0.7,
    regex: new RegExp(`关联方[「『"“]?(${COMPANY_NAME})[」』"”]?`, 'g'),
  },
  {
    relationType: 'related_party',
    role: '关联交易',
    confidence: 0.65,
    regex: new RegExp(`与[「『"“]?(${COMPANY_NAME})[」』"”]?之间?(?:发生|进行)?关联交易`, 'g'),
  },
  {
    relationType: 'guarantee',
    role: '对外担保',
    confidence: 0.8,
    regex: new RegExp(`(?:为|向)[「『"“]?(${COMPANY_NAME})[」』"”]?(?:提供|作出)?担保`, 'g'),
  },
  {
    relationType: 'guarantee',
    role: '担保',
    confidence: 0.7,
    regex: new RegExp(`对[「『"“]?(${COMPANY_NAME})[」』"”]?的担保`, 'g'),
  },
];

const NOISE_NAMES = new Set([
  '本公司',
  '该公司',
  '有限公司',
  '股份有限公司',
  '控股股东',
  '实际控制人',
  '关联方',
]);

function normalizeName(raw: string): string | null {
  let name = raw
    .replace(/[「」『』""“”]/g, '')
    .replace(/\s+/g, '')
    .trim();
  if (name.length < 2 || name.length > 60) return null;
  if (NOISE_NAMES.has(name)) return null;
  if (/^(公司|企业|集团)$/.test(name)) return null;
  return name;
}

/**
 * Extract counterparty relations from disclosure plain text.
 * Dedupes by (relationType, name); keeps highest confidence.
 */
export function extractDisclosureRelations(
  plainText: string,
  opts?: { maxRelations?: number },
): ExtractedRelation[] {
  if (!plainText || plainText.trim().length < 20) return [];

  const maxRelations = opts?.maxRelations ?? 40;
  // Limit scan window for very long PDFs (first ~80k chars usually cover key sections).
  const text = plainText.slice(0, 80_000);
  const best = new Map<string, ExtractedRelation>();

  for (const rule of RULES) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(text)) !== null) {
      const name = normalizeName(match[1] ?? '');
      if (!name) continue;
      const evidence = text.slice(Math.max(0, match.index - 4), match.index + match[0].length + 4).trim();
      const key = `${rule.relationType}::${name}`;
      const candidate: ExtractedRelation = {
        relationType: rule.relationType,
        name,
        role: rule.role,
        evidence: evidence.slice(0, 120),
        confidence: rule.confidence,
      };
      const prev = best.get(key);
      if (!prev || candidate.confidence > prev.confidence) {
        best.set(key, candidate);
      }
      if (best.size >= maxRelations * 2) break;
    }
  }

  return [...best.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, maxRelations);
}

export function orgExternalKey(name: string, market = 'cn'): string {
  const normalized = name.replace(/\s+/g, '').slice(0, 80);
  return `org:${market}:${normalized}`;
}

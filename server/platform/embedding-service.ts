import { pipeline } from '@xenova/transformers';
import {
  applyTransformersEnv,
  huggingFaceUnreachableHint,
} from '../_shared/transformers-env.js';

declare const process: { env: Record<string, string | undefined> };

applyTransformersEnv();

const MODEL_ID = process.env.PLATFORM_EMBED_MODEL ?? 'Xenova/all-MiniLM-L6-v2';
const EMBED_DIM = 384;

type EmbedPipeline = Awaited<ReturnType<typeof pipeline>>;

let embedder: EmbedPipeline | null = null;
let loadPromise: Promise<EmbedPipeline> | null = null;

async function getEmbedder(): Promise<EmbedPipeline> {
  if (embedder) return embedder;
  if (!loadPromise) {
    loadPromise = pipeline('feature-extraction', MODEL_ID)
      .then((p) => {
        embedder = p;
        return embedder;
      })
      .catch((err) => {
        loadPromise = null;
        const cause = err instanceof Error ? err.message : String(err);
        const hint = huggingFaceUnreachableHint();
        throw new Error(`${cause}\n\n${hint}`);
      });
  }
  return loadPromise;
}

export function embeddingModelId(): string {
  return MODEL_ID.replace(/^Xenova\//, '');
}

export function embeddingDimensions(): number {
  return EMBED_DIM;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const pipe = await getEmbedder();
  const out: number[][] = [];

  for (const text of texts) {
    const safe = text.trim().slice(0, 512) || 'empty';
    const result = await pipe(safe, { pooling: 'mean', normalize: true }) as { data: Float32Array };
    out.push(Array.from(result.data));
  }
  return out;
}

export function vectorToPgLiteral(values: number[]): string {
  return `[${values.map((v) => Number(v).toFixed(8)).join(',')}]`;
}

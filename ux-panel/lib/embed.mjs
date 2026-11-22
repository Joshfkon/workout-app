/**
 * Embedding providers for SSR and friction clustering.
 *
 *   local  (default) — BAAI/bge-small-en-v1.5 via transformers.js, run on
 *                      this machine. Free, offline after a one-time ~130 MB
 *                      model download, deterministic. Chosen over
 *                      all-MiniLM-L6-v2 and all-mpnet-base-v2 because it
 *                      spread hand-written test answers across the Likert
 *                      scale most clearly (see README "Embedding choice").
 *   openai           — text-embedding-3-small, the model Maier et al. used.
 *                      Needs OPENAI_API_KEY; costs ~$0.02 per million tokens.
 *
 * The repo has no embeddings provider today (Anthropic has no embeddings
 * endpoint; the `openai` SDK here is pointed at xAI for coaching), which is
 * why local is the default. Scores from different providers are NOT
 * comparable: the run record stores the provider and the report refuses to
 * compare across providers.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const PROVIDERS = {
  local: { id: 'local:Xenova/bge-small-en-v1.5', model: 'Xenova/bge-small-en-v1.5', pooling: 'cls' },
  openai: { id: 'openai:text-embedding-3-small', model: 'text-embedding-3-small' },
};

async function localEmbedder(model, pooling) {
  const { pipeline } = await import('@huggingface/transformers');
  const extract = await pipeline('feature-extraction', model, { dtype: 'fp32' });
  return async (texts) => {
    const out = await extract(texts, { pooling, normalize: true });
    return out.tolist();
  };
}

async function openaiEmbedder(model) {
  if (!process.env.OPENAI_API_KEY) throw new Error('--embed=openai needs OPENAI_API_KEY');
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1' });
  return async (texts) => {
    const res = await client.embeddings.create({ model, input: texts });
    return res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  };
}

/**
 * An embedder with an on-disk cache keyed by provider + text, so re-scoring
 * a run (or re-embedding the anchors) costs nothing.
 */
export async function createEmbedder({ provider = 'local', cacheDir }) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new Error(`unknown embedding provider "${provider}" (local | openai)`);
  const raw = provider === 'openai' ? await openaiEmbedder(spec.model) : await localEmbedder(spec.model, spec.pooling);
  const cacheFile = cacheDir ? path.join(cacheDir, `embeddings-${provider}.json`) : null;
  let cache = {};
  if (cacheFile) {
    await mkdir(cacheDir, { recursive: true });
    try {
      cache = JSON.parse(await readFile(cacheFile, 'utf8'));
    } catch {
      cache = {};
    }
  }
  const key = (t) => createHash('sha1').update(t).digest('hex');
  return {
    id: spec.id,
    async embed(texts) {
      const missing = [...new Set(texts.filter((t) => !cache[key(t)]))];
      for (let i = 0; i < missing.length; i += 64) {
        const batch = missing.slice(i, i + 64);
        const vecs = await raw(batch);
        batch.forEach((t, j) => (cache[key(t)] = vecs[j].map((v) => +v.toFixed(6))));
      }
      if (missing.length && cacheFile) await writeFile(cacheFile, JSON.stringify(cache));
      return texts.map((t) => cache[key(t)]);
    },
  };
}

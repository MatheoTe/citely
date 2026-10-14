import { getEnv, type Env } from "../config/env";
import { EMBEDDING_DIMENSIONS } from "../db/schema";
import { LocalHashEmbeddingProvider } from "./embeddings/local-hash";
import type { EmbeddingProvider } from "./embeddings/types";
import { VoyageEmbeddingProvider } from "./embeddings/voyage";
import { AnthropicFaithfulnessJudge, AnthropicLlmProvider } from "./llm/anthropic";
import { OfflineLlmProvider } from "./llm/offline";
import type { FaithfulnessJudge, LlmProvider } from "./llm/types";
import { VoyageReranker, type Reranker } from "./rerank";

export interface Providers {
  llm: LlmProvider;
  embeddings: EmbeddingProvider;
  reranker: Reranker | null;
  judge: FaithfulnessJudge | null;
}

export interface ProviderMode {
  llm: string;
  embeddings: string;
  reranker: string | null;
  offline: boolean;
  /** Public demo: offline on purpose, not for lack of keys. */
  demo: boolean;
}

function pick<T extends string>(setting: "auto" | T, hasKey: boolean, real: T, fallback: T): T {
  if (setting === "auto") return hasKey ? real : fallback;
  return setting;
}

/** Resolve providers from configuration. Explicitly requesting a real provider without its key is a config error. */
export function resolveProviders(env: Env = getEnv()): Providers {
  // The public demo never spends money: keys in the environment are ignored unless explicitly allowed.
  if (env.DEMO_MODE && !env.DEMO_ALLOW_LIVE) {
    return { llm: new OfflineLlmProvider(), embeddings: new LocalHashEmbeddingProvider(EMBEDDING_DIMENSIONS), reranker: null, judge: null };
  }
  const llmChoice = pick(env.CITELY_LLM_PROVIDER, !!env.ANTHROPIC_API_KEY, "anthropic", "offline");
  const embChoice = pick(env.CITELY_EMBEDDINGS_PROVIDER, !!env.VOYAGE_API_KEY, "voyage", "local");
  const rerankChoice = pick(env.CITELY_RERANKER, !!env.VOYAGE_API_KEY, "voyage", "none");

  if (llmChoice === "anthropic" && !env.ANTHROPIC_API_KEY) throw new Error("CITELY_LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY");
  if ((embChoice === "voyage" || rerankChoice === "voyage") && !env.VOYAGE_API_KEY) {
    throw new Error("Voyage embeddings/reranking require VOYAGE_API_KEY");
  }

  const llm: LlmProvider =
    llmChoice === "anthropic"
      ? new AnthropicLlmProvider({
          apiKey: env.ANTHROPIC_API_KEY!,
          answerModel: env.CITELY_ANSWER_MODEL,
          fastModel: env.CITELY_FAST_MODEL,
          effort: env.CITELY_ANSWER_EFFORT,
        })
      : new OfflineLlmProvider();

  const embeddings: EmbeddingProvider =
    embChoice === "voyage"
      ? new VoyageEmbeddingProvider(env.VOYAGE_API_KEY!, env.CITELY_VOYAGE_EMBED_MODEL, EMBEDDING_DIMENSIONS)
      : new LocalHashEmbeddingProvider(EMBEDDING_DIMENSIONS);

  const reranker = rerankChoice === "voyage" ? new VoyageReranker(env.VOYAGE_API_KEY!, env.CITELY_VOYAGE_RERANK_MODEL) : null;
  const judge = env.ANTHROPIC_API_KEY ? new AnthropicFaithfulnessJudge(env.ANTHROPIC_API_KEY, env.CITELY_FAST_MODEL) : null;

  return { llm, embeddings, reranker, judge };
}

export function describeProviders(p: Providers, env: Env = getEnv()): ProviderMode {
  return {
    demo: env.DEMO_MODE,
    llm: p.llm.name === "anthropic" ? p.llm.answerModel : "offline (extractive)",
    embeddings: p.embeddings.model,
    reranker: p.reranker?.model ?? null,
    offline: p.llm.name === "offline" && p.embeddings.kind === "local",
  };
}

let cached: Providers | undefined;
export function getProviders(): Providers {
  cached ??= resolveProviders();
  return cached;
}

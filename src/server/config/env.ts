import { z } from "zod";

/**
 * Runtime configuration, validated once and cached.
 *
 * Every provider has an "auto" mode: if the matching API key is present the
 * real provider is used, otherwise Citely falls back to a deterministic local
 * implementation. That is what lets the app, the test suite and CI run with no
 * secrets at all.
 */
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("postgres://citely:citely@localhost:5432/citely"),

  ANTHROPIC_API_KEY: optionalSecret,
  VOYAGE_API_KEY: optionalSecret,

  CITELY_LLM_PROVIDER: z.enum(["auto", "anthropic", "offline"]).default("auto"),
  CITELY_EMBEDDINGS_PROVIDER: z.enum(["auto", "voyage", "local"]).default("auto"),
  CITELY_RERANKER: z.enum(["auto", "voyage", "none"]).default("auto"),

  CITELY_ANSWER_MODEL: z.string().default("claude-sonnet-5-5"),
  CITELY_FAST_MODEL: z.string().default("claude-haiku-4-5-20251001"),
  CITELY_ANSWER_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  CITELY_VOYAGE_EMBED_MODEL: z.string().default("voyage-4"),
  CITELY_VOYAGE_RERANK_MODEL: z.string().default("rerank-3"),

  CITELY_CHUNK_TOKENS: z.coerce.number().int().min(64).max(2048).default(256),
  CITELY_CHUNK_OVERLAP: z.coerce.number().int().min(0).max(512).default(48),
  CITELY_RETRIEVAL_K: z.coerce.number().int().min(1).max(20).default(6),

  CITELY_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(20),
  CITELY_MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(10),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Invalid environment configuration: ${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Test hook: forget the cached env so a test can mutate process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

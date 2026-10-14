import { z } from "zod";

/**
 * Runtime configuration, validated once and cached.
 *
 * Every provider has an "auto" mode: if the matching API key is present the
 * real provider is used, otherwise Citevia falls back to a deterministic local
 * implementation. That is what lets the app, the test suite and CI run with no
 * secrets at all.
 */
const optionalSecret = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const flag = z
  .string()
  .trim()
  .optional()
  .transform((v) => v === "1" || v?.toLowerCase() === "true");

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

  /**
   * Public demo mode: offline providers (no paid calls) unless DEMO_ALLOW_LIVE,
   * a tighter upload cap, protected sample documents and a resettable corpus.
   */
  DEMO_MODE: flag,
  DEMO_ALLOW_LIVE: flag,
  /** Shared secret for /api/demo/reset; the endpoint is disabled without it. */
  DEMO_RESET_TOKEN: optionalSecret,
  /** Set by Vercel for cron invocations (sent as `Authorization: Bearer …`). */
  CRON_SECRET: optionalSecret,
  DEMO_MAX_UPLOAD_MB: z.coerce.number().positive().max(50).default(2),
  /** Upper bound on visitor uploads kept between resets. */
  DEMO_MAX_UPLOADS: z.coerce.number().int().min(1).default(30),
  /** Uploads per IP per hour. */
  DEMO_UPLOADS_PER_HOUR: z.coerce.number().int().min(1).default(10),
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

/** Upload size limit in bytes: the demo cap wins when it is the smaller one. */
export function maxUploadBytes(env: Env = getEnv()): number {
  const mb = env.DEMO_MODE ? Math.min(env.DEMO_MAX_UPLOAD_MB, env.CITELY_MAX_UPLOAD_MB) : env.CITELY_MAX_UPLOAD_MB;
  return Math.round(mb * 1024 * 1024);
}

/** Test hook: forget the cached env so a test can mutate process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

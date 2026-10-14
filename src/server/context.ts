import { getEnv } from "./config/env";
import { getDb } from "./db/client";
import { TokenBucketRateLimiter, type RateLimiter } from "./http/rate-limit";
import type { IngestDeps } from "./ingest/pipeline";
import { getProviders } from "./providers";

/** Composition root for request handlers: wires config, DB and providers once per process. */
export async function getIngestDeps(): Promise<IngestDeps> {
  const env = getEnv();
  return {
    db: await getDb(),
    embeddings: getProviders().embeddings,
    chunkOptions: { targetTokens: env.CITELY_CHUNK_TOKENS, overlapTokens: env.CITELY_CHUNK_OVERLAP },
  };
}

const globalForLimiter = globalThis as unknown as { __citelyAskLimiter?: RateLimiter; __citelyUploadLimiter?: RateLimiter };

export function getAskRateLimiter(): RateLimiter {
  globalForLimiter.__citelyAskLimiter ??= new TokenBucketRateLimiter(getEnv().CITELY_RATE_LIMIT_PER_MINUTE);
  return globalForLimiter.__citelyAskLimiter;
}

/** Demo only: uploads per client IP per hour (same single-instance caveat as the ask limiter). */
export function getUploadRateLimiter(): RateLimiter {
  globalForLimiter.__citelyUploadLimiter ??= new TokenBucketRateLimiter(getEnv().DEMO_UPLOADS_PER_HOUR, 60 * 60_000);
  return globalForLimiter.__citelyUploadLimiter;
}

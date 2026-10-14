import { describe, expect, it } from "vitest";
import { getEnv, maxUploadBytes, resetEnvCache, type Env } from "@/server/config/env";
import { isResetAuthorized } from "@/server/demo/auth";
import { describeProviders, resolveProviders } from "@/server/providers";

const MB = 1024 * 1024;
// Placeholder keys: nothing here may reach a real provider.
const withKeys = (overrides: Partial<Env> = {}): Env => ({
  ...getEnv(),
  ANTHROPIC_API_KEY: "test-anthropic-key",
  VOYAGE_API_KEY: "test-voyage-key",
  CITELY_LLM_PROVIDER: "auto",
  CITELY_EMBEDDINGS_PROVIDER: "auto",
  CITELY_RERANKER: "auto",
  ...overrides,
});

describe("demo mode — providers", () => {
  it("forces offline providers even when API keys are present", () => {
    const env = withKeys({ DEMO_MODE: true, DEMO_ALLOW_LIVE: false });
    const providers = resolveProviders(env);
    expect(providers.llm.name).toBe("offline");
    expect(providers.embeddings.kind).toBe("local");
    expect(providers.reranker).toBeNull();
    expect(providers.judge).toBeNull();
    expect(describeProviders(providers, env)).toMatchObject({ offline: true, demo: true });
  });

  it("also overrides an explicit provider choice", () => {
    const providers = resolveProviders(withKeys({ DEMO_MODE: true, CITELY_LLM_PROVIDER: "anthropic", CITELY_RERANKER: "voyage" }));
    expect(providers.llm.name).toBe("offline");
    expect(providers.reranker).toBeNull();
  });

  it("uses the configured providers when DEMO_ALLOW_LIVE is set", () => {
    const providers = resolveProviders(withKeys({ DEMO_MODE: true, DEMO_ALLOW_LIVE: true }));
    expect(providers.llm.name).toBe("anthropic");
  });

  it("parses DEMO_MODE from the environment as 1/true", () => {
    const saved = { ...process.env };
    try {
      for (const [raw, expected] of [["1", true], ["true", true], ["0", false], ["", false]] as const) {
        process.env.DEMO_MODE = raw;
        // a fresh parse, not the cached one
        const { DEMO_MODE } = resolveEnvFresh();
        expect(DEMO_MODE).toBe(expected);
      }
    } finally {
      process.env = saved;
      resolveEnvFresh();
    }
  });
});

describe("demo mode — upload cap", () => {
  it("caps uploads at DEMO_MAX_UPLOAD_MB (2 MB by default)", () => {
    expect(maxUploadBytes({ ...getEnv(), DEMO_MODE: true })).toBe(2 * MB);
    expect(maxUploadBytes({ ...getEnv(), DEMO_MODE: true, DEMO_MAX_UPLOAD_MB: 1 })).toBe(1 * MB);
  });

  it("never raises the regular limit and leaves it alone outside the demo", () => {
    expect(maxUploadBytes({ ...getEnv(), DEMO_MODE: true, CITELY_MAX_UPLOAD_MB: 1, DEMO_MAX_UPLOAD_MB: 5 })).toBe(1 * MB);
    expect(maxUploadBytes({ ...getEnv(), DEMO_MODE: false, CITELY_MAX_UPLOAD_MB: 10 })).toBe(10 * MB);
  });
});

describe("demo mode — reset token", () => {
  const env = { DEMO_RESET_TOKEN: "reset-secret", CRON_SECRET: "cron-secret" };
  const headers = (h: Record<string, string>) => new Headers(h);

  it("accepts the reset token in its header or as a bearer token, and the cron secret", () => {
    expect(isResetAuthorized(headers({ "x-demo-reset-token": "reset-secret" }), env)).toBe(true);
    expect(isResetAuthorized(headers({ authorization: "Bearer reset-secret" }), env)).toBe(true);
    expect(isResetAuthorized(headers({ authorization: "Bearer cron-secret" }), env)).toBe(true);
  });

  it("rejects missing, wrong or prefix-matching tokens", () => {
    expect(isResetAuthorized(headers({}), env)).toBe(false);
    expect(isResetAuthorized(headers({ "x-demo-reset-token": "nope" }), env)).toBe(false);
    expect(isResetAuthorized(headers({ "x-demo-reset-token": "reset-secre" }), env)).toBe(false);
    expect(isResetAuthorized(headers({ authorization: "reset-secret" }), env)).toBe(false);
  });

  it("stays closed when no secret is configured", () => {
    const none = { DEMO_RESET_TOKEN: undefined, CRON_SECRET: undefined };
    expect(isResetAuthorized(headers({ "x-demo-reset-token": "" }), none)).toBe(false);
    expect(isResetAuthorized(headers({ authorization: "Bearer undefined" }), none)).toBe(false);
  });
});

function resolveEnvFresh(): Env {
  resetEnvCache();
  return getEnv();
}

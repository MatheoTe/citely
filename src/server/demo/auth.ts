import { timingSafeEqual } from "node:crypto";
import type { Env } from "../config/env";

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Who may reset the demo: a caller presenting DEMO_RESET_TOKEN (in the
 * `x-demo-reset-token` header or as a bearer token), or Vercel Cron, which
 * sends `Authorization: Bearer $CRON_SECRET`. With no secret configured the
 * endpoint stays closed.
 */
export function isResetAuthorized(headers: Headers, env: Pick<Env, "DEMO_RESET_TOKEN" | "CRON_SECRET">): boolean {
  const secrets = [env.DEMO_RESET_TOKEN, env.CRON_SECRET].filter((s): s is string => !!s);
  if (secrets.length === 0) return false;
  const bearer = headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const presented = [headers.get("x-demo-reset-token")?.trim(), bearer].filter((s): s is string => !!s);
  return presented.some((p) => secrets.some((s) => safeEqual(p, s)));
}

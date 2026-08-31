import "server-only";

/**
 * Lazy, dependency-free env accessor.
 *
 * Lazy on purpose: touching one variable must never throw over an unrelated
 * one that happens to be unset in this environment, and a module-load-time
 * validation would take the whole app down at import time in a preview build
 * where only some vars are provisioned.
 *
 * NEXT_PUBLIC_* names are load-bearing — Next inlines them into the client
 * bundle only when referenced by that literal name, so they are read as
 * `process.env.NEXT_PUBLIC_...` literals below rather than via a computed key.
 */

export type EnvKey =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "NEXT_PUBLIC_SITE_URL";

const readers: Record<EnvKey, () => string | undefined> = {
  NEXT_PUBLIC_SUPABASE_URL: () => process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: () => process.env.NEXT_PUBLIC_SITE_URL,
};

const cache = new Map<EnvKey, string>();

/** Reads a required env var, throwing a clear, actionable error if missing. */
export function requireEnv(key: EnvKey): string {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  const value = readers[key]()?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${key}. ` +
        `Add it to .env.local (development) or the deployment's environment (production). ` +
        `See .env.example for the full list.`,
    );
  }
  cache.set(key, value);
  return value;
}

/** Reads an optional env var, returning undefined rather than throwing. */
export function optionalEnv(key: EnvKey): string | undefined {
  const value = readers[key]();
  return value && value.trim() ? value.trim() : undefined;
}

type Env = Record<EnvKey, string>;

/**
 * `env.NEXT_PUBLIC_SUPABASE_URL` — validated on first access, then cached.
 * Prefer this in server modules; use optionalEnv() where absence is legal.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return requireEnv(prop as EnvKey);
  },
});

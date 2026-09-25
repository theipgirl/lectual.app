import "server-only";
import { z } from "zod";

/**
 * Every env var lectual.app reads, validated lazily per field. Ported from
 * lectual/src/lib/env.ts and trimmed to what this frontend uses; add a var
 * here before reading it anywhere else.
 */
const fieldSchemas = {
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Magic-link redirect base, used only when a request carries no origin.
  SITE_URL: z.string().optional(),
  // Approval queue (lawmatics-mcp). Optional: unset reads as "unconfigured",
  // never as an empty queue — see src/lib/queue/load.ts.
  QUEUE_API_URL: z.string().optional(),
  DASHBOARD_API_TOKEN: z.string().optional(),
  // AI. ANTHROPIC_API_KEY wins over the gateway key when both are set.
  ANTHROPIC_API_KEY: z.string().optional(),
  VERCEL_AI_GATEWAY_KEY: z.string().optional(),
  // Mailbox OAuth (step 3). Optional until that step lands.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  MS_OAUTH_CLIENT_ID: z.string().optional(),
  MS_OAUTH_CLIENT_SECRET: z.string().optional(),
  // 32-byte key (base64) for AES-256-GCM encryption of mailbox tokens.
  MAILBOX_TOKEN_KEY: z.string().optional(),
  // Shared secret Vercel Cron sends to /api/cron/* (steps 4–5).
  CRON_SECRET: z.string().optional(),
} as const;

type FieldSchemas = typeof fieldSchemas;
type Env = { [K in keyof FieldSchemas]: z.infer<FieldSchemas[K]> };

const cache = {} as Partial<Env>;

function getField<K extends keyof FieldSchemas>(key: K): Env[K] {
  if (!(key in cache)) {
    cache[key] = fieldSchemas[key].parse(process.env[key]) as Env[K];
  }
  return cache[key] as Env[K];
}

/**
 * Per-field lazy validation — touching one env var never throws over an
 * unrelated one that happens to be unset in this environment.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    return getField(prop as keyof FieldSchemas);
  },
});

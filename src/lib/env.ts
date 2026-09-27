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
  // Voice notes: optional Whisper transcription. Unset = notes save untranscribed.
  OPENAI_API_KEY: z.string().optional(),
  VERCEL_AI_GATEWAY_KEY: z.string().optional(),
  // Model for the in-app agents (src/lib/ai/claude.ts). Unset = claude-opus-5.
  AGENT_MODEL: z.string().optional(),
  // Mailbox OAuth (step 3). Optional until that step lands.
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  MS_OAUTH_CLIENT_ID: z.string().optional(),
  MS_OAUTH_CLIENT_SECRET: z.string().optional(),
  // 32-byte key (base64) for AES-256-GCM encryption of mailbox tokens.
  MAILBOX_TOKEN_KEY: z.string().optional(),
  // Shared secret Vercel Cron sends to /api/cron/* (steps 4–5).
  CRON_SECRET: z.string().optional(),
  // Public intake (/i/<slug>): salts the anonymous funnel session hash and
  // signs the render stamp. Optional: unset = sessions are not hashed (null),
  // stamps are unsigned. Never reuse another secret here.
  INTAKE_EVENT_SALT: z.string().optional(),
  // LawPay (AffiniPay) partner OAuth app — docs/lawpay-setup.md. All optional:
  // unset = "Connect LawPay" is disabled with an explanation, and payments are
  // recorded manually. The firm signs in to ITS OWN LawPay account; there is
  // no deployment-wide LawPay secret key anywhere. Tokens are sealed with
  // MAILBOX_TOKEN_KEY under their own HKDF context.
  LAWPAY_OAUTH_CLIENT_ID: z.string().optional(),
  LAWPAY_OAUTH_CLIENT_SECRET: z.string().optional(),
  // Override only if 8am says so. Default https://secure.lawpay.com/oauth/authorize.
  LAWPAY_OAUTH_AUTHORIZE_URL: z.string().optional(),
  // Must match the partner app's registered redirect exactly. Unset = derived
  // from the request origin: <origin>/api/lawpay/callback/.
  LAWPAY_OAUTH_REDIRECT_URI: z.string().optional(),
  // Gateway/API host. Default https://api.8am.com.
  LAWPAY_API_BASE: z.string().optional(),
  // "test" (default) or "live". Which half of a merchant's credentials this
  // deployment charges with. Anything but the exact string "live" is test.
  LAWPAY_MODE: z.string().optional(),
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

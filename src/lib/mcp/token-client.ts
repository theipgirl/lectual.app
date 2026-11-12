import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { env } from "@/lib/env";

/**
 * Turn a Claude connector request's `Authorization: Bearer <token>` into a database client that acts
 * as that person, under RLS. The ANON key only, never the service role: the token is what carries
 * the person, and the custom access-token hook's `active_org_id` claim is what RLS keys on.
 *
 * Order matters: the token is first VERIFIED by asking Supabase (`auth.getUser(token)`, which works
 * with either signing-key setup); only then is its payload decoded to read `active_org_id`. A token
 * Supabase rejects is never decoded or trusted.
 *
 * About 33 helpers call `supabase.auth.getUser()` with no argument (it reads a cookie session, which a
 * header-only client does not have), resolveFirmSession among them, so the client's `auth.getUser`
 * is wrapped to default its argument to this token.
 */

const BEARER = /^Bearer\s+([A-Za-z0-9_.~+/=-]{20,8192})$/i;

export function bearerToken(header: string | null | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = BEARER.exec(header.trim());
  return match ? match[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `active_org_id` claim of a token that was ALREADY verified. Null when absent or malformed. */
export function activeOrgIdOf(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    const org = payload.active_org_id;
    return typeof org === "string" && UUID.test(org) ? org : null;
  } catch {
    return null;
  }
}

type GetUser = SupabaseClient<Database>["auth"]["getUser"];

/** Make `auth.getUser()` with no argument verify `token` instead of looking for a cookie session. */
export function withTokenGetUser<C extends { auth: { getUser: GetUser } }>(client: C, token: string): C {
  const original = client.auth.getUser.bind(client.auth) as GetUser;
  const wrapped = ((jwt?: string) => original(jwt ?? token)) as GetUser;
  client.auth.getUser = wrapped;
  return client;
}

export type VerifiedCaller = { client: SupabaseClient<Database>; userId: string; orgId: string };

export type TokenClientFactory = (token: string) => SupabaseClient<Database>;

/** The real factory: anon key, the token on every request, no session storage, no refresh. */
export const tokenClient: TokenClientFactory = (token) =>
  createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

/**
 * The caller behind an Authorization header, or null (no header, a malformed one, a token Supabase
 * rejects, or one with no firm claim). Any throw is null.
 */
export async function verifyBearer(header: string | null | undefined, factory: TokenClientFactory = tokenClient): Promise<VerifiedCaller | null> {
  const token = bearerToken(header);
  if (!token) return null;
  try {
    const client = factory(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data?.user?.id) return null;
    const orgId = activeOrgIdOf(token);
    if (!orgId) return null;
    return { client: withTokenGetUser(client, token), userId: data.user.id, orgId };
  } catch {
    return null;
  }
}

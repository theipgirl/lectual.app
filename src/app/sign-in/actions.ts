"use server";

import { getScopedClient } from "@/lib/db/scoped-client";
import { getSiteOrigin } from "@/lib/site-origin";

export type LoginState = { ok?: boolean; error?: string };

/**
 * Sends a Supabase magic link. There is no email allowlist here — anyone can
 * request a link, but that only authenticates them; whether they can see
 * anything is decided downstream by crm_org_member + RLS (src/app/(firm)/
 * layout.tsx renders "No firm access yet" for an authenticated non-member).
 * Fail-closed happens at the data layer, not the login form.
 */
export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const nextParam = String(formData.get("next") ?? "/dashboard");
  const next =
    nextParam.startsWith("/") && !nextParam.startsWith("//") && nextParam !== "/"
      ? nextParam
      : "/dashboard";

  if (!email) return { error: "Enter your email." };

  const origin = await getSiteOrigin();

  const supabase = await getScopedClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback/?next=${encodeURIComponent(next)}` },
  });
  if (error) return { error: `Could not send the link: ${error.message}` };
  return { ok: true };
}

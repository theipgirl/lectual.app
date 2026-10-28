"use server";

import { safeNext } from "@/lib/auth/safe-next";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getSiteOrigin } from "@/lib/site-origin";
import { SIGN_IN_GENERIC } from "@/lib/ui/words";

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
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!email) return { error: "Enter your email." };

  const origin = await getSiteOrigin();

  const supabase = await getScopedClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback/?next=${encodeURIComponent(next)}` },
  });
  if (error) {
    // The provider's text can carry the address or internal detail, so it is not shown.
    console.error("[sign-in] the magic link could not be sent:", error.status ?? "unknown status");
    return { error: SIGN_IN_GENERIC };
  }
  return { ok: true };
}

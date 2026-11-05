"use server";

import { safeNext } from "@/lib/auth/safe-next";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getSiteOrigin } from "@/lib/site-origin";
import { magicLinkLimiter } from "@/lib/auth/magic-link-limit";
import { redirect } from "next/navigation";
import { normalizeSignInCode } from "@/lib/auth/sign-in-errors";
import { SIGN_IN_CODE_BAD, SIGN_IN_CODE_FORMAT, SIGN_IN_GENERIC, SIGN_IN_WAIT } from "@/lib/ui/words";

export type LoginState = { ok?: boolean; error?: string; email?: string };

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

  if (!magicLinkLimiter.take(email)) return { error: SIGN_IN_WAIT };

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
  return { ok: true, email };
}

export type CodeState = { error?: string };

/**
 * Signs in with the 6-digit code from the same email as the link. A mail scanner that opens the
 * link (Microsoft Safe Links does) spends the link but not the code, so this always works for the
 * person holding the newest email. The code only works when the firm's Magic Link email template
 * includes {{ .Token }}. Session cookies are written by the scoped client; then on to the app.
 */
export async function verifySignInCode(_prev: CodeState, formData: FormData): Promise<CodeState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = normalizeSignInCode(formData.get("code"));
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!email) return { error: SIGN_IN_CODE_BAD };
  if (!token) return { error: SIGN_IN_CODE_FORMAT };
  const supabase = await getScopedClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    console.error("[sign-in] a sign-in code was refused:", error.status ?? "unknown status");
    return { error: SIGN_IN_CODE_BAD };
  }
  redirect(next);
}

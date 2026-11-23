"use server";

import { redirect } from "next/navigation";
import { parseConfirmLink } from "@/lib/auth/sign-in-errors";
import { safeNext } from "@/lib/auth/safe-next";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * The person pressed Sign in on /auth/confirm/. Only this POST spends the one-time token, so a mail
 * scanner that opens the emailed link (a GET) uses nothing up. A bad or spent token goes back to
 * /sign-in/ with the expired-link sentence; the provider's text is never shown.
 */
export async function confirmSignIn(formData: FormData): Promise<void> {
  const next = safeNext(String(formData.get("next") ?? ""));
  const link = parseConfirmLink(formData.get("token_hash"), formData.get("type"));
  const back = `/sign-in/?error=otp_expired${next !== "/dashboard/" ? `&next=${encodeURIComponent(next)}` : ""}`;
  if (!link) redirect(back);
  const supabase = await getScopedClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
  if (error) {
    console.error("[sign-in] a confirm link was refused:", error.status ?? "unknown status");
    redirect(back);
  }
  redirect(next);
}

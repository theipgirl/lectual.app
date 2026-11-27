import type { Metadata } from "next";
import { parseConfirmLink } from "@/lib/auth/sign-in-errors";
import { safeNext } from "@/lib/auth/safe-next";
import { SIGN_IN_CONFIRM_BODY, SIGN_IN_CONFIRM_BUTTON, SIGN_IN_CONFIRM_TITLE, SIGN_IN_EXPIRED } from "@/lib/ui/words";
import { confirmSignIn } from "./actions";
import SignInShell from "@/app/sign-in/SignInShell";

export const metadata: Metadata = { title: "Sign in — Lectual", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where the sign-in email's link lands (Magic Link template: {{ .SiteURL }}/auth/confirm/?token_hash=
 * {{ .TokenHash }}&type=email). Loading this page spends nothing: the token is used only when the
 * person presses Sign in (a POST), so a link-scanning mail filter (Check Point Harmony, Microsoft
 * Safe Links) that opens the link first no longer burns it.
 */
export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const { token_hash, type, next } = await searchParams;
  const link = parseConfirmLink(token_hash, type);
  return (
    <SignInShell>
      <h1 className="lx-si-h1">{SIGN_IN_CONFIRM_TITLE}</h1>
      {link ? (
        <form action={confirmSignIn} className="lx-si-form">
          <p className="lx-si-sub">{SIGN_IN_CONFIRM_BODY}</p>
          <input type="hidden" name="token_hash" value={link.tokenHash} />
          <input type="hidden" name="type" value={link.type} />
          <input type="hidden" name="next" value={safeNext(next)} />
          <button type="submit" className="lx-si-btn lx-si-btn-pri">
            {SIGN_IN_CONFIRM_BUTTON}
          </button>
        </form>
      ) : (
        <p role="alert" className="lx-si-alert">
          {SIGN_IN_EXPIRED}{" "}
          <a href="/sign-in/">Get a new link</a>
        </p>
      )}
    </SignInShell>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/safe-next";
import LoginForm from "./LoginForm";
import HashErrorNotice from "./HashErrorNotice";
import { signInErrorMessage } from "@/lib/auth/sign-in-errors";
import { SIGN_IN_INVITED_HELP, SIGN_IN_NOT_INVITED } from "@/lib/ui/words";
import SignInShell from "./SignInShell";

export const metadata: Metadata = { title: "Sign in — Lectual" };

const safeNextOf = safeNext;

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; code?: string; error?: string }>;
}) {
  const { next, code, error } = await searchParams;
  const safeNext = safeNextOf(next);

  // A magic-link code should land on /auth/callback/, but Supabase falls back to
  // the project's Site URL whenever the requested redirect isn't allowlisted.
  // Forward it rather than dropping it: the code is single-use, and a silent
  // drop burns the link and reads as "nothing happened".
  if (code) {
    redirect(`/auth/callback/?code=${encodeURIComponent(code)}&next=${encodeURIComponent(safeNext)}`);
  }

  return (
    <SignInShell>
      <h1 className="lx-si-h1">Sign in to your firm</h1>
      <p className="lx-si-sub">{SIGN_IN_INVITED_HELP}</p>
      {error && (
        <p role="alert" className="lx-si-alert">
          {signInErrorMessage(error)}
        </p>
      )}
      <HashErrorNotice serverError={Boolean(error)} />
      <LoginForm next={safeNext} />
      <p className="lx-si-quiet">{SIGN_IN_NOT_INVITED}</p>
    </SignInShell>
  );
}

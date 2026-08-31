// MIRRORED FROM theipgirl/lectual:src/app/sign-in/page.tsx — keep in sync, do not edit locally
// (Styling is this app's own design tokens; the code-forwarding behaviour is the mirror.)
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Sign in — Lectual" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; code?: string; error?: string }>;
}) {
  const { next, code, error } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  // A magic-link code should land on /auth/callback/, but Supabase falls back to
  // the project's Site URL whenever the requested redirect isn't allowlisted —
  // and this project's Site URL belongs to the other app. Forward it rather than
  // dropping it on the floor: the code is single-use, so a silent drop burns the
  // link and reads as "nothing happened".
  if (code) {
    redirect(
      `/auth/callback/?code=${encodeURIComponent(code)}&next=${encodeURIComponent(safeNext)}`,
    );
  }

  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="grid w-full max-w-sm gap-4 rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--shadow)]">
        <div>
          <p className="mb-1.5 font-mono text-xs uppercase tracking-[0.08em] text-[var(--muted)]">
            Lectual
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)]">
            Sign in to your docket
          </h1>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-[var(--r-sm)] border border-[var(--overdue-border)] bg-[var(--overdue-bg)] px-3 py-2.5 text-sm text-[var(--overdue)]"
          >
            {error} — sign-in links are single-use and expire, so request a fresh one below.
          </p>
        )}
        <LoginForm next={safeNext} />
        <p className="text-xs text-[var(--muted)]">
          Lectual is software, not a law firm, and does not provide legal advice.
        </p>
      </div>
    </main>
  );
}

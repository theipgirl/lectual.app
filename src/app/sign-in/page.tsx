import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";

export const metadata: Metadata = { title: "Sign in — Lectual" };

function safeNextOf(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && next !== "/" ? next : "/dashboard/";
}

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
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="lx-card" style={{ width: "100%", maxWidth: 420, padding: 32, display: "grid", gap: 18 }}>
        <div>
          <div className="lx-label">Lectual</div>
          <h1 className="lx-h1" style={{ fontSize: 34 }}>
            Sign in to your firm
          </h1>
        </div>
        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.5,
              color: "var(--wine)",
              background: "rgba(142,39,51,.07)",
              border: "1px solid rgba(142,39,51,.3)",
              borderRadius: 9,
              padding: "10px 12px",
            }}
          >
            {error} — sign-in links are single-use and expire, so request a fresh one below.
          </p>
        )}
        <LoginForm next={safeNext} />
        <p className="lx-note" style={{ margin: 0, fontSize: 12 }}>
          {NOT_A_LAW_FIRM_DISCLAIMER}
        </p>
      </div>
    </main>
  );
}

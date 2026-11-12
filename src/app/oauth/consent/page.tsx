import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { evaluateConsent, refusalSentence } from "@/lib/mcp/consent";
import { DECISION_PATH } from "@/lib/mcp/consent-rules";
import {
  CONSENT_ALLOW,
  CONSENT_DENY,
  CONSENT_OTHER_FIRM,
  CONSENT_POINTS,
  CONSENT_TITLE,
  consentQuestion,
} from "@/lib/ui/words";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";

export const metadata: Metadata = { title: "Connect Claude — Lectual", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where Supabase's OAuth server sends a person to approve Claude (authorization path
 * `/oauth/consent`). It shows; it is not the gate: `POST /api/oauth/decision/` gathers every fact
 * again before approving. Signed out goes to the normal sign-in and comes back here.
 */
export default async function ConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string | string[]; failed?: string }>;
}) {
  const { authorization_id, failed } = await searchParams;
  const outcome = await evaluateConsent(typeof authorization_id === "string" ? authorization_id : null);

  if (outcome.kind === "sign-in") redirect(outcome.to);
  if (outcome.kind === "redirect") redirect(outcome.url);

  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="lx-card" style={{ width: "100%", maxWidth: 480, padding: 32, display: "grid", gap: 18 }}>
        <div>
          <div className="lx-label">Lectual</div>
          <h1 className="lx-h1" style={{ fontSize: 34 }}>
            {CONSENT_TITLE}
          </h1>
        </div>
        {outcome.kind === "refuse" ? (
          <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--wine)" }}>
            {refusalSentence(outcome.reason)}
          </p>
        ) : (
          <>
            {failed === "1" && (
              <p role="alert" style={{ margin: 0, fontSize: 14, color: "var(--wine)" }}>
                {refusalSentence("failed")}
              </p>
            )}
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{consentQuestion(outcome.firmName, outcome.you)}</p>
            <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6, fontSize: 14 }}>
              {CONSENT_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <p className="lx-note" style={{ margin: 0, fontSize: 13 }}>
              {CONSENT_OTHER_FIRM}
            </p>
            <form method="post" action={DECISION_PATH} style={{ display: "flex", gap: 12 }}>
              <input type="hidden" name="authorization_id" value={outcome.authorizationId} />
              <button type="submit" name="decision" value="allow" className="lx-btn lx-btn-pri" style={{ height: 42, flex: 1 }}>
                {CONSENT_ALLOW}
              </button>
              <button type="submit" name="decision" value="deny" className="lx-btn" style={{ height: 42, flex: 1 }}>
                {CONSENT_DENY}
              </button>
            </form>
          </>
        )}
        <p className="lx-note" style={{ margin: 0, fontSize: 12 }}>
          {NOT_A_LAW_FIRM_DISCLAIMER}
        </p>
      </div>
    </main>
  );
}

import { notFound } from "next/navigation";
import { readPublicRequest } from "@/lib/intake-forms/public";
import { IntakeDisclaimer, IntakeNotice } from "../../i/[slug]/_components/IntakeShell";
import { RequestForm } from "./_components/RequestForm";
import "../../i/intake-public.css";

/**
 * `/r/<token>` — the firm's intake questions, sent to an existing client from
 * a matter ("Send intake questions"). No login; the 32-byte token is the key,
 * and only a request still `sent` opens. The answers file on the request and
 * as a note on the matter's timeline. Nothing is emailed by Lectual: the firm
 * copied this link and sent it themselves.
 */
export const dynamic = "force-dynamic";

export default async function IntakeRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await readPublicRequest(token);
  if (r.status === "not_found") notFound();
  if (r.status !== "ok") {
    return (
      <IntakeNotice
        title="We can't load these questions right now"
        body="Your link is fine. Something on our side isn't responding. Please try again in a few minutes. Nothing has been sent."
      />
    );
  }
  const { handle } = r;
  return (
    <div className="ipub" data-theme="light">
      <div className="ipub-frame">
        <header className="ipub-head">
          <div className="ipub-firm">{handle.firmName}</div>
          <h1 className="ipub-headline">A few questions about your matter</h1>
          <p className="ipub-small">Your answers go to {handle.firmName} and are filed on your matter. Answer what you can.</p>
        </header>
        <RequestForm token={token} questions={handle.questions.map((q) => ({ id: q.id, text: q.text, required: q.required }))} />
      </div>
      <IntakeDisclaimer firmName={handle.firmName} existingClient />
    </div>
  );
}

import type { Metadata } from "next";
import { resolveFirmSession } from "@/lib/firm/session";
import { aiConfigured } from "@/lib/ai/claude";
import { hubTracks, parseHubProgress } from "@/lib/onboarding/hub";
import { pickHubRecordsAction } from "@/lib/onboarding/hub-actions";
import { FlowList } from "@/components/onboarding/FlowList";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Getting started") };

export const dynamic = "force-dynamic";

/**
 * Guided walkthroughs over the real screens. Every member can open it: what a
 * person is offered depends on their role and the firm's modules, and a list
 * that could not be read says so rather than looking empty. It reads only; the
 * flows it starts write nothing but the person's own progress flag.
 */
export default async function GettingStartedPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") return null; // the layout already handled this

  const modules = session.org.modules;
  const tracks = hubTracks({ role: session.role, modules, aiConfigured: aiConfigured() });
  const progress = parseHubProgress(session.user.user_metadata);
  const picks = await pickHubRecordsAction();

  return (
    <div>
      <div className="lx-page-head">
        <div>
          <div className="lx-label">Help</div>
          <h1 className="lx-h1">Getting started</h1>
          <p className="lx-sub">Short guided tours of the real screens. A guide only points things out; it never changes anything for you.</p>
        </div>
      </div>
      {tracks.length === 0 ? (
        <p className="lx-note" role="status">
          There are no guides to show for your account yet.
        </p>
      ) : (
        <FlowList tracks={tracks} doneIds={progress.done} picks={picks} modulesUnreadable={modules === null} />
      )}
    </div>
  );
}

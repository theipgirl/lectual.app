import type { Metadata } from "next";
import { resolveFirmSession } from "@/lib/firm/session";
import { aiConfigured } from "@/lib/ai/claude";
import { hubTracks, parseHubProgress } from "@/lib/onboarding/hub";
import { pickHubRecordsAction } from "@/lib/onboarding/hub-actions";
import { FlowList } from "@/components/onboarding/FlowList";
import { SendFeedbackButton } from "@/components/feedback/SendFeedbackButton";
import { pageTitle } from "@/lib/ui/page-title";
import { EmptyState, PageHeader } from "@/components/ui";
import { YourSetupView } from "@/components/setup/TeamAccounts";
import { loadYourSetup } from "@/lib/setup/first-users-load";

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
  const yourSetup = await loadYourSetup({ id: session.user.id, role: session.role }, modules);

  return (
    <div>
      <PageHeader title="Getting started" sub={<>Short guided tours of the real screens. A guide only points things out; it never changes anything for you.</>} />
      <YourSetupView items={yourSetup} />
      {tracks.length === 0 ? (
        <EmptyState variant="line">There are no guides to show for your account yet.</EmptyState>
      ) : (
        <FlowList tracks={tracks} doneIds={progress.done} picks={picks} modulesUnreadable={modules === null} />
      )}
      <footer className="lx-note" style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span>Something not working, or missing a guide?</span>
        <SendFeedbackButton />
      </footer>
    </div>
  );
}

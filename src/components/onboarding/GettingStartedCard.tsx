import Link from "next/link";
import { resolveFirmSession } from "@/lib/firm/session";
import { aiConfigured } from "@/lib/ai/claude";
import { HUB_PATH, hubTracks, overallCount, parseHubProgress, shouldShowHubCard } from "@/lib/onboarding/hub";
import { HideHubCard } from "./HideHubCard";
import "./hub.css";

/**
 * "Getting started · N of M done" on Today. It reads its own state, so a failed
 * read here can never blank Today: it still offers the link, without a count,
 * rather than a count it could not work out. Gone once every guide the person
 * can see is done, or once they hide it.
 */
export async function GettingStartedCard() {
  let heading = "Getting started";
  let hideable = false;
  try {
    const session = await resolveFirmSession();
    if (session.kind !== "ok") return null;
    const tracks = hubTracks({ role: session.role, modules: session.org.modules, aiConfigured: aiConfigured() });
    const progress = parseHubProgress(session.user.user_metadata);
    if (!shouldShowHubCard(tracks, progress)) return null;
    const { done, total } = overallCount(tracks, progress.done);
    heading = `Getting started · ${done} of ${total} done`;
    hideable = true;
  } catch {
    // Unreadable: show the link with no count.
  }
  return (
    <section className="lx-card gs-card" aria-labelledby="getting-started-h">
      <div className="gs-card-main">
        <h2 id="getting-started-h" className="lx-h2" style={{ margin: 0 }}>
          {heading}
        </h2>
        <p className="lx-sub" style={{ margin: 0 }}>
          Short guided tours of the screens you use.
        </p>
      </div>
      <div className="gs-card-actions">
        <Link href={HUB_PATH} className="lx-btn lx-btn-pri lx-btn-sm">
          Open
        </Link>
        {hideable && <HideHubCard />}
      </div>
    </section>
  );
}

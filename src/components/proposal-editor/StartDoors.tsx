import Link from "next/link";
import { ConsultRows } from "@/components/proposal-list/ConsultsStrip";
import { START_DOORS } from "@/lib/proposal-editor/vocabulary";
import { copilotHref, startDoors, type ConsultDoorState } from "@/lib/proposals/start-screen";
import "@/app/dashboard/proposals/proposals.css";

const MEETINGS_SETUP = "/dashboard/settings/integrations/meetings/";

/**
 * New proposal's start screen: three equally weighted doors, each with a title, one sentence and one action.
 * Each is drawn only when its own feature is on. Nothing here writes, sends or queues anything.
 */
export function StartDoors({
  canWrite,
  aiOn,
  consults,
  canDraft,
  draftNote,
  leads,
}: {
  canWrite: boolean;
  aiOn: boolean;
  consults: ConsultDoorState;
  canDraft: boolean;
  draftNote: string | null;
  leads?: { id: string; label: string }[] | null;
}) {
  const doors = startDoors({ canWrite, aiOn });
  return (
    <div className="pe-doors" data-doors={doors.length}>
      {doors.includes("consult") && (
        <section className="lx-card pe-door" aria-labelledby="door-consult" data-door="consult">
          <h2 className="pe-h" id="door-consult">
            {START_DOORS.consult.title}
          </h2>
          <p className="lx-note pe-hint">{START_DOORS.consult.body}</p>
          {consults.kind === "not-connected" ? (
            <p role="status" className="lx-note">
              {START_DOORS.consult.notReady} <Link href={MEETINGS_SETUP}>{START_DOORS.consult.connect}</Link>
            </p>
          ) : consults.kind === "unavailable" ? (
            <p role="status" className="lx-note">
              {START_DOORS.consult.couldntLoad}
            </p>
          ) : (
            <ConsultRows meetings={consults.data.meetings} canDraft={canDraft} draftNote={draftNote} leads={leads} />
          )}
        </section>
      )}
      {doors.includes("copilot") && (
        <section className="lx-card pe-door" aria-labelledby="door-copilot" data-door="copilot">
          <h2 className="pe-h" id="door-copilot">
            {START_DOORS.copilot.title}
          </h2>
          <p className="lx-note pe-hint">{START_DOORS.copilot.body}</p>
          <div className="pe-door-action">
            <a href={copilotHref(null)} className="lx-btn lx-btn-sec">
              {START_DOORS.copilot.action}
            </a>
          </div>
        </section>
      )}
      {doors.includes("scratch") && (
        <section className="lx-card pe-door" aria-labelledby="door-scratch" data-door="scratch">
          <h2 className="pe-h" id="door-scratch">
            {START_DOORS.scratch.title}
          </h2>
          <p className="lx-note pe-hint">{START_DOORS.scratch.body}</p>
          <div className="pe-door-action">
            <Link href="/dashboard/proposals/new/?door=scratch" className="lx-btn lx-btn-sec">
              {START_DOORS.scratch.action}
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}

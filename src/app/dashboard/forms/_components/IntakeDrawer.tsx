import Link from "next/link";
import { intakeDetail } from "@/lib/intake-forms/performance";
import type { loadIntakeSubmission } from "@/lib/intake-forms/load-performance";
import type { DrawerSteps } from "@/lib/intake-forms/load-steps";
import type { Load } from "@/lib/intake-forms/load-results";
import { stoppedAtLabel } from "@/lib/intake-forms/step-funnel";
import { IntakeStatusForm } from "./IntakeStatusForm";

/**
 * The Performance tab's pieces that the Results tab shares: the three-state
 * warning, the badge tones, and the person drawer. Moved out of
 * IntakePerformance.tsx unchanged so both tabs open the same drawer.
 */

export const FIT_TONE: Record<string, string> = { fit: "ok", non_fit: "risk", unscored: "mute", hot: "risk", warm: "warn", cold: "mute" };
export const STATUS_TONE: Record<string, string> = {
  new: "ox",
  referred: "sand",
  consult_booked: "warn",
  engaged: "ok",
  rejected: "risk",
  stopped: "mute",
};

export function Unreadable({ what, unconfigured, migration = "0079" }: { what: string; unconfigured: boolean; migration?: string }) {
  return (
    <div className="lx-banner lx-banner-warn" role="status">
      {unconfigured
        ? `${what} aren't set up in this environment (lectual migration ${migration}). Nothing is broken; it needs the migration.`
        : `${what} couldn't be loaded. This is a problem reaching the database, not an empty result. Try again shortly.`}
    </div>
  );
}

export function IntakeDrawer({
  tz,
  detail,
  closeHref,
  canChangeStatus,
  leadHref = null,
  steps = null,
  stepQuestions = {},
}: {
  detail: Awaited<ReturnType<typeof loadIntakeSubmission>>;
  tz: string;
  closeHref: string;
  canChangeStatus: boolean;
  /** The person's lead page, when the caller knows it (the Results tab does; Performance's drawer is unchanged). */
  leadHref?: string | null;
  /** Where an unfinished person stopped and their answers so far (Sprint 10); null for a finished person. */
  steps?: Load<DrawerSteps> | null;
  /** Question texts by id, to label the saved answers. */
  stepQuestions?: Record<string, string>;
}) {
  const d = detail.status === "ok" && detail.value ? intakeDetail(detail.value, tz) : null;
  return (
    <div className="ifm-drawer-wrap">
      <Link href={closeHref} scroll={false} className="ifm-drawer-scrim" aria-label="Close" />
      <aside className="ifm-drawer" aria-label="Intake">
        <div className="ifm-drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="ifm-drawer-name">{d ? d.name : "Intake"}</div>
            {d?.sub && <div className="ifm-help">{d.sub}</div>}
          </div>
          <Link href={closeHref} scroll={false} className="ifm-icon-btn" aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </Link>
        </div>
        <div className="ifm-drawer-body">
          {detail.status !== "ok" ? (
            <Unreadable what="This intake" unconfigured={detail.status === "unconfigured"} />
          ) : !d ? (
            <p className="ifm-help">That intake isn&apos;t in your firm, or it was removed.</p>
          ) : (
            <>
              <div className="ifm-drawer-badges">
                <span className={`ifm-badge ${FIT_TONE[d.fitKey] ?? "mute"}`}>{d.fit}</span>
                <span className={`ifm-badge ${STATUS_TONE[d.statusKey] ?? "mute"}`}>{d.status}</span>
                <span className="ifm-badge sand">{d.modeLine}</span>
              </div>
              {leadHref && (
                <p className="ifm-help" style={{ margin: 0 }}>
                  <Link href={leadHref}>Open the lead</Link>
                </p>
              )}
              {steps && <DrawerStepsNote steps={steps} questions={stepQuestions} />}
              <div className="ifm-note">
                <div className="ifm-caps">Screening note</div>
                <div>{d.why}</div>
              </div>
              {canChangeStatus && <IntakeStatusForm key={`${d.id}:${d.statusKey}`} id={d.id} status={d.statusKey} />}
              <dl className="ifm-answers">
                {d.answers.map((a, i) => (
                  <div key={i}>
                    <dt>{a.q}</dt>
                    <dd>{a.a}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/**
 * Where this person stopped, and the answers they had given when they left
 * (saved as they went, never submitted). Said in words in every state: a read
 * that failed is not "nothing saved", and a person from before step recording
 * is "not recorded".
 */
function DrawerStepsNote({ steps, questions }: { steps: Load<DrawerSteps>; questions: Record<string, string> }) {
  if (steps.status === "unavailable") {
    return (
      <div className="ifm-note ifm-stepnote">
        <div className="ifm-caps">Where they stopped</div>
        <div>{"Couldn't load step data. This is a problem reaching the database, not an empty result."}</div>
      </div>
    );
  }
  if (steps.status === "unconfigured") {
    return (
      <div className="ifm-note ifm-stepnote">
        <div className="ifm-caps">Where they stopped</div>
        <div>not recorded</div>
      </div>
    );
  }
  const label = stoppedAtLabel(steps.value.reading);
  const progress = steps.value.progress ? Object.entries(steps.value.progress) : [];
  return (
    <>
      {label && (
        <div className="ifm-note ifm-stepnote">
          <div className="ifm-caps">Where they stopped</div>
          <div>{label}</div>
        </div>
      )}
      {progress.length > 0 && (
        <div className="ifm-note ifm-stepnote">
          <div className="ifm-caps">Answers so far (not submitted)</div>
          <dl className="ifm-answers">
            {progress.map(([id, text]) => (
              <div key={id}>
                <dt>{questions[id] ?? "Question"}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </>
  );
}

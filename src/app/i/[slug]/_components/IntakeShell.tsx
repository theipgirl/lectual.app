import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";

/**
 * The not-a-law-firm line every state of a public intake carries — the live
 * intake renders it inside its own frame (PublicIntake), and the not-found and
 * unavailable states render it here. The wording is the app's one constant.
 */
export function IntakeDisclaimer({ firmName, existingClient = false }: { firmName?: string; existingClient?: boolean }) {
  const firm = firmName ?? "the firm named on this page";
  return (
    <p className="ipub-upl">
      {NOT_A_LAW_FIRM_DISCLAIMER}{" "}
      {existingClient
        ? `Lectual provides the software these questions are presented in; ${firm} reads your answers.`
        : `Lectual provides the software this intake runs on; ${firm} reviews what you send and decides whether it can help.`}
    </p>
  );
}

/** A message in place of the intake: not found, or not reachable. */
export function IntakeNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="ipub" data-theme="light">
      <div className="ipub-frame ipub-notice">
        <h1 className="ipub-headline">{title}</h1>
        <p className="ipub-small" style={{ fontSize: 14 }}>
          {body}
        </p>
        <IntakeDisclaimer />
      </div>
    </div>
  );
}

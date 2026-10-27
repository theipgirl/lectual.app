import type { ReactNode } from "react";
import { moreOptionsSummary } from "@/lib/proposal-editor/more-options";

/**
 * The shape of the proposal builder (Sprint 28 C), shared by New proposal and the editor:
 * three numbered steps, the one button that finishes them, then ONE closed "More options"
 * section for everything else. It opens by itself when something inside it needs fixing.
 * No field is removed: whatever used to be on the page is in a step or in More options.
 */

const STEP_TITLES = ["Who", "Brand names and classes", "Package and pay link"] as const;

export function BuilderLayout({
  who,
  names,
  packageStep,
  create,
  more,
  changed,
  moreOpen,
}: {
  who: ReactNode;
  names: ReactNode;
  packageStep: ReactNode;
  /** The button (or buttons) that finish the three steps. */
  create: ReactNode;
  /** Everything else. */
  more: ReactNode;
  /** Fields that differ from the firm's defaults. */
  changed: number;
  moreOpen: boolean;
}) {
  const steps = [who, names, packageStep];
  return (
    <div className="pe-builder">
      <ol className="pe-build-steps">
        {steps.map((body, i) => (
          <li key={i} className="pe-build-step" data-step={i + 1}>
            <h2 className="pe-build-step-h">
              <span className="pe-build-step-n" aria-hidden="true">
                {i + 1}
              </span>
              <span>
                <span className="pe-sr">Step {i + 1}: </span>
                {STEP_TITLES[i]}
              </span>
            </h2>
            {body}
          </li>
        ))}
      </ol>
      <div className="pe-create">{create}</div>
      <details className="pe-more" open={moreOpen ? true : undefined}>
        <summary className="pe-more-sum">{moreOptionsSummary(changed)}</summary>
        <div className="pe-more-body">{more}</div>
      </details>
    </div>
  );
}

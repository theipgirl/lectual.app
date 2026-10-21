import type { AskedQuestion } from "@/lib/intake-forms/assessment-asked";

/**
 * The assessment's Back / Skip / Next row (hook-free, so it is checked with a
 * static render). A card question that is a single choice goes on with its tap,
 * so it has no Next. The firm's own single-choice questions are drawn as radios
 * that only SELECT on a keyboard's arrow keys, so they get Next (or "See my
 * results" on the last one) to confirm, like every other question.
 */
export function AssessmentNav(props: {
  step: number;
  lastStep: boolean;
  current: Pick<AskedQuestion, "type" | "required" | "extra">;
  pending: boolean;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
}) {
  const { step, lastStep, current, pending, onBack, onSkip, onNext } = props;
  return (
    <div className="ipub-asm-nav">
      {step > 0 && (
        <button type="button" className="ipub-link" onClick={onBack} disabled={pending}>
          Back
        </button>
      )}
      <span style={{ flex: 1 }} />
      {!current.required && (
        <button type="button" className="ipub-link" onClick={onSkip} disabled={pending}>
          Skip
        </button>
      )}
      {(current.type !== "single" || current.extra) && (
        <button type="button" className="ipub-submit" onClick={onNext} disabled={pending}>
          {!lastStep ? "Next" : pending ? "Sending…" : "See my results"}
        </button>
      )}
      {pending && current.type === "single" && !current.extra && <span className="ipub-small">Scoring…</span>}
    </div>
  );
}

import { STEP_NAMES } from "@/lib/loe/client-words";

/**
 * The four steps of a proposal that carries an engagement letter: Choose, Your details, Engagement letter, Pay.
 * A step the client has passed is a button back to it; the one they are on is marked `aria-current="step"`; later steps are
 * not offered until reached. After signing the bar stands on Pay and nothing goes back (the signature is recorded).
 */
export function LoeStepBar({ current, onGo, locked }: { current: 1 | 2 | 3 | 4; onGo?: (step: 1 | 2 | 3) => void; locked?: boolean }) {
  return (
    <nav className="cp-steps" id="cp-steps" aria-label="Steps">
      <ol>
        {STEP_NAMES.map((name, i) => {
          const n = (i + 1) as 1 | 2 | 3 | 4;
          const state = n === current ? "current" : n < current ? "done" : "todo";
          const canGo = !locked && n < current && n <= 3 && !!onGo;
          return (
            <li key={name} className={`cp-step cp-step-${state}`} aria-current={n === current ? "step" : undefined}>
              {canGo ? (
                <button type="button" className="cp-step-btn" onClick={() => onGo?.(n as 1 | 2 | 3)}>
                  <span className="cp-step-n" aria-hidden="true">
                    {n}
                  </span>
                  <span>{name}</span>
                </button>
              ) : (
                <span className="cp-step-btn">
                  <span className="cp-step-n" aria-hidden="true">
                    {n}
                  </span>
                  <span>{name}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

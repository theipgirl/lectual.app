"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FOCUSABLE_SELECTOR } from "@/lib/copilot/launcher";
import { markTourSeenAction } from "@/lib/onboarding/actions";
import {
  closeTour,
  clampIndex,
  focusRestoreTarget,
  hasVisibleModal,
  measureTarget,
  placePopover,
  readGuard,
  shouldOpenOnLoad,
  stepTour,
  tourKeyAction,
  type Placement,
  type Size,
} from "@/lib/onboarding/engine";
import { SHOW_TOUR_EVENT, tourSelector, tourSteps, type TourOutcome, type TourStep } from "@/lib/onboarding/tour";
import "./tour.css";

const FALLBACK_SIZE: Size = { width: 340, height: 220 };

type ViewProps = {
  steps: TourStep[];
  index: number;
  placement: Placement;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onLink: () => void;
  popRef?: React.Ref<HTMLDivElement>;
  nextRef?: React.Ref<HTMLButtonElement>;
  /** Wording for the last step's button and the skip button. The first-sign-in tour keeps its own. */
  finishLabel?: string;
  skipLabel?: string;
};

/** The dialog itself. Presentational, so it renders the same on the server as in the browser. */
export function TourView({ steps, index, placement, onNext, onBack, onSkip, onLink, popRef, nextRef, finishLabel = "Done", skipLabel = "Skip tour" }: ViewProps) {
  const titleId = useId();
  const step = steps[clampIndex(index, steps.length)];
  if (!step) return null;
  const last = index >= steps.length - 1;
  const centered = placement.mode === "center";
  const popStyle = placement.mode === "spot" ? { top: placement.popover.top, left: placement.popover.left } : undefined;

  return (
    <div className="ot-root">
      <div className={`ot-backdrop${centered ? " is-centered" : ""}`} />
      {placement.mode === "spot" && (
        <div
          className="ot-spot"
          aria-hidden="true"
          style={{ top: placement.cutout.top, left: placement.cutout.left, width: placement.cutout.width, height: placement.cutout.height }}
        />
      )}
      <div
        ref={popRef}
        className={`lx-card ot-pop${centered ? " is-centered" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={popStyle}
      >
        <div className="lx-label" style={{ fontSize: 11 }}>
          {`Step ${index + 1} of ${steps.length}`}
        </div>
        <h2 id={titleId} className="ot-title">
          {step.title}
        </h2>
        <p className="ot-body">{step.body}</p>
        {step.link && (
          <a className="ot-link" href={step.link.href} onClick={onLink}>
            {step.link.label}
          </a>
        )}
        <ol className="ot-dots" aria-hidden="true">
          {steps.map((s, i) => (
            <li key={s.id} className="ot-dot" aria-current={i === index ? "step" : undefined} />
          ))}
        </ol>
        <div className="ot-actions">
          {index > 0 && (
            <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={onBack}>
              Back
            </button>
          )}
          <button ref={nextRef} type="button" className="lx-btn lx-btn-pri lx-btn-sm" onClick={onNext}>
            {last ? finishLabel : "Next"}
          </button>
          <span className="ot-spacer" />
          {!last && (
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={onSkip}>
              {skipLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Props = {
  /** The server's answer: this person has not seen the tour at the current version (and is a member of the firm). */
  open: boolean;
  role: string;
  navSlugs: string[];
  firmName: string;
  aiConfigured: boolean;
};

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The first-sign-in tour: a spotlight on real parts of the screen, with a
 * centered card whenever a target is missing, hidden, off-screen or the window
 * is narrow. Closing is optimistic: the tour goes away at once and the outcome
 * is saved after, and a failed save never traps or alerts anyone.
 */
export function OnboardingTour({ open, role, navSlugs, firmName, aiConfigured }: Props) {
  const steps = useMemo(
    () => tourSteps({ role, navItems: navSlugs.map((slug) => ({ slug })), aiConfigured, firmName }),
    [role, navSlugs, aiConfigured, firmName],
  );
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [placement, setPlacement] = useState<Placement>({ mode: "center" });
  const popRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const begin = useCallback(() => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setIndex(0);
    setActive(true);
  }, []);

  // Opens once on load when the server says so, no earlier close this session, and no modal is up.
  useEffect(() => {
    // Deferred a tick so the page (and any drawer it mounts) has settled before the modal check.
    const timer = window.setTimeout(() => {
      if (shouldOpenOnLoad({ open, guard: readGuard(sessionStore()), modalOpen: hasVisibleModal(document) })) begin();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, begin]);

  // "Show tips again" in the account menu: restart from step 1 whatever the flag says.
  useEffect(() => {
    window.addEventListener(SHOW_TOUR_EVENT, begin);
    return () => window.removeEventListener(SHOW_TOUR_EVENT, begin);
  }, [begin]);

  const step = steps[clampIndex(index, steps.length)];

  const finish = useCallback((outcome: TourOutcome) => {
    void closeTour({
      outcome,
      action: markTourSeenAction,
      storage: sessionStore(),
      onClosed: () => {
        setActive(false);
        focusRestoreTarget(returnTo.current)?.focus();
        returnTo.current = null;
      },
    });
  }, []);

  const go = useCallback(
    (action: "next" | "back" | "skip") => {
      const result = stepTour({ index, count: steps.length }, action);
      if (result.outcome) finish(result.outcome);
      else setIndex(result.index);
    },
    [index, steps.length, finish],
  );

  // Measure the step's target, and again whenever the window or any scroller moves.
  useEffect(() => {
    if (!active || !step) return;
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(tourSelector(step.target)) : null;
      const pop = popRef.current;
      const size = pop && pop.offsetWidth > 0 ? { width: pop.offsetWidth, height: pop.offsetHeight } : FALLBACK_SIZE;
      setPlacement(
        placePopover({ rect: el ? measureTarget(el) : null, viewport: { width: window.innerWidth, height: window.innerHeight }, size, side: step.side }),
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [active, step]);

  // Focus moves into the popover on every step.
  useEffect(() => {
    if (active) (nextRef.current ?? popRef.current)?.focus();
  }, [active, index]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const items = popRef.current ? Array.from(popRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
      const action = tourKeyAction(
        {
          key: e.key,
          shiftKey: e.shiftKey,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          altKey: e.altKey,
          inField: !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable),
        },
        { count: items.length, current: items.indexOf(document.activeElement as HTMLElement) },
      );
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action.kind === "focus") items[action.index]?.focus();
      else go(action.kind);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, go]);

  if (!active || !step) return null;

  return (
    <TourView
      steps={steps}
      index={index}
      placement={placement}
      popRef={popRef}
      nextRef={nextRef}
      onNext={() => go("next")}
      onBack={() => go("back")}
      onSkip={() => go("skip")}
      onLink={() => finish("skipped")}
    />
  );
}

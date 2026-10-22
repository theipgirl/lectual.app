"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FOCUSABLE_SELECTOR } from "@/lib/copilot/launcher";
import { markHubFlowAction, type HubSaveResult } from "@/lib/onboarding/hub-actions";
import { visibleFlows, type HubFlow } from "@/lib/onboarding/hub";
import {
  HUB_FLOW_KEY,
  HUB_RECORDS_KEY,
  HUB_START_EVENT,
  NO_RECORDS,
  advanceFlow,
  afterFinish,
  clearFlow,
  decodeRecords,
  leftFlowPage,
  readLocalDone,
  resumeFlow,
  stepView,
  storeState,
  toTourStep,
  writeLocalDone,
  type HubRecords,
  type RunnerAction,
} from "@/lib/onboarding/hub-runner";
import { focusRestoreTarget, hasVisibleModal, measureTarget, placePopover, tourKeyAction, type Placement, type Size } from "@/lib/onboarding/engine";
import { tourSelector } from "@/lib/onboarding/tour";
import { TourView } from "./OnboardingTour";
import "./tour.css";

const FALLBACK_SIZE: Size = { width: 340, height: 220 };
/** A page that has just loaded may not have drawn its target yet: look again for about a second before centering. */
const MEASURE_RETRIES = 8;
const MEASURE_EVERY_MS = 150;

type Props = {
  role: string;
  /** The firm's module list, or null when it could not be read (then no gated flow is offered). */
  modules: string[] | null;
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
 * Runs a Getting started flow over the real screens. Closed on load unless a
 * valid `flowId:index` is waiting in sessionStorage (so a reload or a move to the
 * next page resumes it). It reuses the first-sign-in tour's popover, spotlight and
 * focus handling and writes nothing but the finished-flow flag, optimistically.
 */
export function GettingStartedRunner({ role, modules, aiConfigured }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const flows = useMemo(() => visibleFlows({ role, modules, aiConfigured }), [role, modules, aiConfigured]);
  const [flow, setFlow] = useState<HubFlow | null>(null);
  const [index, setIndex] = useState(0);
  const [records, setRecords] = useState<HubRecords>(NO_RECORDS);
  const [placement, setPlacement] = useState<Placement>({ mode: "center" });
  const popRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const navigating = useRef(false);

  const view = useMemo(() => (flow ? stepView(flow.steps[index], records) : null), [flow, index, records]);

  // Picks up a flow waiting in storage: after a reload, a page change, or a Start on the Getting started page.
  const sync = useCallback(() => {
    const store = sessionStore();
    const raw = store?.getItem(HUB_FLOW_KEY) ?? null;
    const found = resumeFlow(raw, flows);
    if (found.kind === "none") {
      if (raw !== null) clearFlow(store);
      return;
    }
    if (hasVisibleModal(document)) return;
    const at = found.kind === "resume" ? found.index : 0;
    if (found.kind === "restart") storeState(store, `${found.flow.id}:0`);
    returnTo.current = document.activeElement as HTMLElement | null;
    setRecords(decodeRecords(store?.getItem(HUB_RECORDS_KEY)));
    setFlow(found.flow);
    setIndex(at);
  }, [flows]);

  useEffect(() => {
    if (flow) return;
    const timer = window.setTimeout(sync, 0);
    return () => window.clearTimeout(timer);
  }, [flow, pathname, sync]);

  useEffect(() => {
    window.addEventListener(HUB_START_EVENT, sync);
    return () => window.removeEventListener(HUB_START_EVENT, sync);
  }, [sync]);

  const close = useCallback(() => {
    clearFlow(sessionStore());
    navigating.current = false;
    setFlow(null);
    setIndex(0);
    focusRestoreTarget(returnTo.current)?.focus();
    returnTo.current = null;
  }, []);

  const finish = useCallback(
    async (flowId: string) => {
      close();
      let saved: HubSaveResult | null = null;
      try {
        saved = await markHubFlowAction(flowId, "done");
      } catch {
        // Kept locally below; nothing to show.
      }
      // A failed save keeps the check for this session and says nothing.
      if (!saved?.ok) {
        const store = sessionStore();
        writeLocalDone(store, afterFinish(readLocalDone(store), flowId, saved).done);
      }
    },
    [close],
  );

  const go = useCallback(
    (action: RunnerAction) => {
      if (!flow) return;
      const step = advanceFlow(flow, index, action, records, pathname);
      if (step.kind === "end") {
        if (step.markDone) void finish(step.markDone);
        else close();
        return;
      }
      setIndex(step.move.index);
      storeState(sessionStore(), step.move.state);
      if (step.move.navigate) {
        navigating.current = true;
        router.push(step.move.navigate);
      }
    },
    [flow, index, records, pathname, finish, close, router],
  );

  // Leaving the step's page by hand ends the flow (not done) instead of pointing at the wrong page.
  useEffect(() => {
    if (!flow || !view) return;
    const arriving = navigating.current;
    navigating.current = false;
    if (leftFlowPage(pathname, view, arriving)) close();
    // Only a change of page decides this; a change of step is the runner's own doing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Measure the step's target, again after the page settles and whenever the window or a scroller moves.
  useEffect(() => {
    if (!flow || !view) return;
    let tries = 0;
    let timer: number | undefined;
    let scrolled = false;
    const measure = () => {
      const el = view.target ? document.querySelector<HTMLElement>(tourSelector(view.target)) : null;
      if (el && !scrolled) {
        scrolled = true;
        el.scrollIntoView?.({ block: "center" });
      }
      const pop = popRef.current;
      const size = pop && pop.offsetWidth > 0 ? { width: pop.offsetWidth, height: pop.offsetHeight } : FALLBACK_SIZE;
      const next = placePopover({ rect: el ? measureTarget(el) : null, viewport: { width: window.innerWidth, height: window.innerHeight }, size, side: view.side });
      setPlacement(next);
      if (view.target && next.mode === "center" && tries < MEASURE_RETRIES) {
        tries += 1;
        timer = window.setTimeout(measure, MEASURE_EVERY_MS);
      }
    };
    measure();
    const again = () => {
      tries = MEASURE_RETRIES;
      measure();
    };
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, [flow, view, pathname]);

  useEffect(() => {
    if (flow) (nextRef.current ?? popRef.current)?.focus();
  }, [flow, index]);

  useEffect(() => {
    if (!flow) return;
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
  }, [flow, go]);

  if (!flow || !view) return null;

  return (
    <TourView
      steps={flow.steps.map((s, i) => toTourStep(i === index ? view : stepView(s, records)))}
      index={index}
      placement={view.centered ? { mode: "center" } : placement}
      popRef={popRef}
      nextRef={nextRef}
      finishLabel="Finish"
      skipLabel="Skip guide"
      onNext={() => go("next")}
      onBack={() => go("back")}
      onSkip={() => go("skip")}
      onLink={() => go("skip")}
    />
  );
}

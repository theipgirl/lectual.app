"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { resetHubProgressAction, pickHubRecordsAction, type HubRecordPicks } from "@/lib/onboarding/hub-actions";
import { mergeLocalDone, overallCount, recommendedFlow, stepReset, trackCounts, type HubFlow, type HubTrack, type RecordPick, type ResetState } from "@/lib/onboarding/hub";
import {
  HUB_LOCAL_DONE_KEY,
  HUB_START_EVENT,
  NO_RECORDS,
  flowNeedsRecords,
  readLocalDone,
  startFlow,
  storeStart,
  writeLocalDone,
  type HubRecords,
} from "@/lib/onboarding/hub-runner";
import "./hub.css";

type Props = {
  tracks: HubTrack[];
  /** Flow ids the server has recorded as finished. */
  doneIds: string[];
  /** What the page found when it looked for a lead and a matter, so it can say what a record step will do. */
  picks: HubRecordPicks;
  /** The module list could not be read: gated guides are hidden, and the page says so. */
  modulesUnreadable: boolean;
};

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const LOCAL_EVENT = "lectual:hub-local";

function subscribeLocal(onChange: () => void): () => void {
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => window.removeEventListener(LOCAL_EVENT, onChange);
}

const localSnapshot = (): string => sessionStore()?.getItem(HUB_LOCAL_DONE_KEY) ?? "[]";
const serverSnapshot = (): string => "[]";

function recordsFrom(picks: HubRecordPicks): HubRecords {
  const id = (p: RecordPick) => (p.status === "ok" ? p.id : null);
  return { lead: id(picks.lead), matter: id(picks.matter), failed: picks.lead.status === "unavailable" || picks.matter.status === "unavailable" };
}

/** A line under a flow that opens a lead or matter, when there is none to open or the list could not be read. */
export function recordNote(flow: HubFlow, picks: HubRecordPicks): string | null {
  const kinds = new Set(flow.steps.flatMap((s) => (s.record ? [s.record] : [])));
  const lines: string[] = [];
  for (const kind of kinds) {
    const pick = picks[kind];
    if (pick.status === "unavailable") lines.push(`Your ${kind}s couldn't be loaded, so the steps on a ${kind}'s page will be described instead.`);
    if (pick.status === "none") lines.push(`No ${kind} to open yet, so the steps on a ${kind}'s page will be described instead.`);
  }
  return lines.length ? lines.join(" ") : null;
}

/** The sections of the Getting started page: per-track counts, a check per flow, Start / Run again, and Reset progress. */
export function FlowList({ tracks, doneIds, picks, modulesUnreadable }: Props) {
  const router = useRouter();
  // Finished flows whose save failed earlier in this session still count here.
  const localRaw = useSyncExternalStore(subscribeLocal, localSnapshot, serverSnapshot);
  const [cleared, setCleared] = useState(false);
  const [reset, setReset] = useState<ResetState>("idle");
  const [starting, setStarting] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (reset === "confirming") confirmRef.current?.focus();
  }, [reset]);

  const local = readLocalDone({ getItem: () => localRaw, setItem: () => undefined, removeItem: () => undefined });
  const done = mergeLocalDone(cleared ? [] : doneIds, local);
  const counts = trackCounts(tracks, done);
  const total = overallCount(tracks, done);
  const recommended = recommendedFlow(tracks, done);

  async function start(flow: HubFlow) {
    setStarting(flow.id);
    let records: HubRecords = NO_RECORDS;
    if (flowNeedsRecords(flow)) {
      try {
        records = recordsFrom(await pickHubRecordsAction());
      } catch {
        records = { ...NO_RECORDS, failed: true };
      }
    }
    storeStart(sessionStore(), flow, records);
    const move = startFlow(flow, records, null);
    window.dispatchEvent(new Event(HUB_START_EVENT));
    if (move.navigate) router.push(move.navigate);
    setStarting(null);
  }

  async function onReset(event: "ask" | "confirm" | "cancel") {
    const next = stepReset(reset, event);
    setReset(next.state);
    if (!next.run) return;
    writeLocalDone(sessionStore(), []);
    window.dispatchEvent(new Event(LOCAL_EVENT));
    setCleared(true);
    try {
      await resetHubProgressAction();
    } catch {
      // Cleared for this session either way.
    }
    router.refresh();
  }

  return (
    <div className="gs-root">
      {modulesUnreadable && (
        <p className="lx-banner lx-banner-warn" role="status" style={{ margin: 0 }}>
          Some guides couldn&apos;t be checked, so they are hidden for now. Reload the page to try again.
        </p>
      )}
      <p className="lx-sub" style={{ margin: 0 }}>
        {`${total.done} of ${total.total} guides done`}
      </p>
      {tracks.map((track, i) => (
        <section key={track.id} className="lx-card gs-track" aria-labelledby={`gs-${track.id}`}>
          <header className="gs-track-head">
            <div>
              <h2 id={`gs-${track.id}`} className="lx-h2 gs-track-title">
                {track.title}
              </h2>
              <p className="lx-note" style={{ margin: 0 }}>
                {track.summary}
              </p>
            </div>
            <span className="lx-pill lx-pill-mute">{`${counts[i].done} of ${counts[i].total} done`}</span>
          </header>
          <ul className="gs-flows">
            {track.flows.map((flow) => {
              const finished = done.includes(flow.id);
              const note = recordNote(flow, picks);
              const isRecommended = recommended?.id === flow.id;
              return (
                <li key={flow.id} className="gs-flow">
                  <span className={`gs-check${finished ? " is-done" : ""}`} aria-hidden="true">
                    {finished ? "✓" : ""}
                  </span>
                  <div className="gs-flow-main">
                    <div className="gs-flow-title">
                      {flow.title}
                      {finished && <span className="gs-sr"> (done)</span>}
                      {isRecommended && <span className="lx-pill lx-pill-ok gs-rec">Start here</span>}
                    </div>
                    <div className="lx-note">{flow.summary}</div>
                    {note && <div className="lx-note gs-flow-note">{note}</div>}
                  </div>
                  <button
                    type="button"
                    className={`lx-btn lx-btn-sm ${isRecommended ? "lx-btn-pri" : "lx-btn-sec"}`}
                    onClick={() => void start(flow)}
                    disabled={starting !== null}
                    aria-label={`${finished ? "Run again" : "Start"}: ${flow.title}`}
                  >
                    {finished ? "Run again" : "Start"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="gs-reset">
        {reset === "idle" ? (
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => void onReset("ask")}>
            Reset progress
          </button>
        ) : (
          <div role="group" aria-label="Confirm reset" className="gs-confirm">
            <span className="lx-note">Clear every check and show the card on Today again?</span>
            <button ref={confirmRef} type="button" className="lx-btn lx-btn-pri lx-btn-sm" onClick={() => void onReset("confirm")}>
              Yes, reset
            </button>
            <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => void onReset("cancel")}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { Icon } from "@/components/ui/Icon";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { yesVerb } from "@/lib/ui/words";
import { resetHubProgressAction, pickHubRecordsAction, type HubRecordPicks } from "@/lib/onboarding/hub-actions";
import { mergeLocalDone, overallCount, recommendedFlow, trackCounts, type HubFlow, type HubTrack, type RecordPick } from "@/lib/onboarding/hub";
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
  const [starting, setStarting] = useState<string | null>(null);

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

  async function runReset() {
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
        <Notice tone="warn" role="status">
          Some guides couldn&apos;t be checked, so they are hidden for now. Reload the page to try again.
        </Notice>
      )}
      <p className="lx-sub">
        {`${total.done} of ${total.total} guides done`}
      </p>
      {tracks.map((track, i) => (
        <section key={track.id} className="lx-card gs-track" aria-labelledby={`gs-${track.id}`}>
          <header className="gs-track-head">
            <div>
              <h2 id={`gs-${track.id}`} className="lx-h2">
                {track.title}
              </h2>
              <p className="lx-note">
                {track.summary}
              </p>
            </div>
            <Pill tone="mute" num>{`${counts[i].done} of ${counts[i].total} done`}</Pill>
          </header>
          <ul className="gs-flows">
            {track.flows.map((flow) => {
              const finished = done.includes(flow.id);
              const note = recordNote(flow, picks);
              const isRecommended = recommended?.id === flow.id;
              return (
                <li key={flow.id} className="gs-flow">
                  <span className={`gs-check${finished ? " is-done" : ""}`} aria-hidden="true">
                    {finished ? <Icon name="check" size={14} /> : null}
                  </span>
                  <div className="gs-flow-main">
                    <div className="gs-flow-title">
                      {flow.title}
                      {finished && <span className="gs-sr"> (done)</span>}
                      {isRecommended && <span className="gs-rec"><Pill tone="ok">Start here</Pill></span>}
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
        <InlineConfirm
          label="Reset progress"
          question="Clear every check and show the card on Today again?"
          confirmLabel={yesVerb("reset")}
          className="lx-btn lx-btn-ghost lx-btn-sm"
          onConfirm={() => void runReset()}
        />
      </div>
    </div>
  );
}

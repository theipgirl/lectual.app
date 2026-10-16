"use client";

import { LANES, LANE_LABEL, type Lane, type LaneView } from "@/lib/leads/lane";
import Popover, { PopoverItem } from "./Popover";
import { TEMP_NONE, TEMP_PILL } from "./styles";

/**
 * The Lane cell and its menu (intake SOP Stage 2).
 *
 * A lane a PERSON set is a solid chip. A triage suggestion is a dashed chip
 * that says "Suggested" in words, with the reason under it — never the same
 * chip with a different shade, because "a routing suggestion once rendered as
 * an assignment status on the dashboard and read as fact". Choosing from the
 * menu sets the person's lane (recorded on the timeline, who and from → to);
 * "No lane" clears it, and the suggestion shows again.
 */
export default function LaneCell({
  leadName,
  lane,
  pending,
  onSet,
}: {
  leadName: string;
  lane: LaneView;
  pending: boolean;
  onSet: (lane: Lane | null) => void;
}) {
  const person = lane.lane;
  const suggested = lane.suggested;
  const title = person
    ? `Lane set by a person${suggested && suggested !== person ? ` (triage suggested ${LANE_LABEL[suggested]})` : ""}`
    : suggested
      ? `Suggested by triage, not a decision${lane.reason ? ` — ${lane.reason}` : ""}`
      : "No lane yet";

  return (
    <div style={{ minWidth: 0, display: "grid", gap: 2 }}>
      <Popover
        label={`${leadName}: ${title}. Set lane`}
        width={190}
        trigger={({ onClick, ref, ...aria }) => (
          <button
            {...aria}
            ref={ref}
            type="button"
            title={title}
            disabled={pending}
            onClick={onClick}
            data-testid="lane-cell"
            style={{
              ...(person ? TEMP_PILL[person] : suggested ? TEMP_PILL[suggested] : TEMP_NONE),
              ...(person
                ? { border: "1px solid currentColor", textTransform: "uppercase", letterSpacing: "0.06em" }
                : suggested
                  ? { border: "1px dashed currentColor", background: "transparent", fontStyle: "italic" }
                  : { border: "1px dashed var(--line)", background: "transparent", padding: "3px 7px", borderRadius: 5 }),
              justifySelf: "start",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.5,
              cursor: pending ? "progress" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {person ? LANE_LABEL[person] : suggested ? `Suggested: ${LANE_LABEL[suggested]}` : "Set lane"}
          </button>
        )}
      >
        {(close) => (
          <>
            {LANES.map((l) => (
              <PopoverItem
                key={l}
                checked={person === l}
                onSelect={() => {
                  close();
                  onSet(l);
                }}
              >
                {LANE_LABEL[l]}
                {suggested === l ? " · suggested" : ""}
              </PopoverItem>
            ))}
            <PopoverItem
              muted
              checked={false}
              onSelect={() => {
                close();
                onSet(null);
              }}
            >
              No lane{person ? " (clear)" : ""}
            </PopoverItem>
          </>
        )}
      </Popover>
      {!person && suggested && lane.reason && (
        <span
          style={{ fontSize: 10.5, color: "var(--mute)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          title={lane.reason}
        >
          {lane.reason}
        </span>
      )}
    </div>
  );
}

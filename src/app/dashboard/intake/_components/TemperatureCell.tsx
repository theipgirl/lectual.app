"use client";

import { LANES, LANE_LABEL, type Lane } from "@/lib/leads/lane";
import { temperatureLabel, temperatureTitle, type EffectiveTemperature } from "@/lib/intake/effective-temperature";
import Popover, { PopoverItem } from "./Popover";
import { TEMP_NONE, TEMP_PILL } from "./styles";

/**
 * The one Temperature cell: the chip and the menu that sets it (intake SOP
 * Stage 2).
 *
 * A temperature a PERSON set is a solid chip. A derived one is a dashed chip
 * that says "Suggested" in words, never the same chip in a different shade,
 * because "a routing suggestion once rendered as an assignment status on the
 * dashboard and read as fact". A lead with neither shows a dashed neutral
 * "Not routed". The tooltip is the reason, so the team can see why someone
 * went cold without asking anyone.
 *
 * Choosing Hot, Warm or Cold sets the person's lane (recorded on the timeline,
 * who and from → to); Clear removes it and the derived value shows again.
 */
export default function TemperatureCell({
  leadName,
  temperature,
  pending,
  onSet,
}: {
  leadName: string;
  temperature: EffectiveTemperature;
  pending: boolean;
  onSet: (lane: Lane | null) => void;
}) {
  const { value, source } = temperature;
  const title = temperatureTitle(temperature);
  const person = source === "person" && value !== null;

  return (
    <div style={{ minWidth: 0, display: "flex" }}>
      <Popover
        label={`${leadName}: ${temperatureLabel(temperature)}. ${title.replace("\n", ". ")}. Set temperature`}
        width={165}
        trigger={({ onClick, ref, ...aria }) => (
          <button
            {...aria}
            ref={ref}
            type="button"
            title={title}
            disabled={pending}
            onClick={onClick}
            data-testid="temperature-cell"
            style={{
              ...(value ? TEMP_PILL[value] : TEMP_NONE),
              ...(person
                ? { border: "1px solid currentColor", textTransform: "uppercase", letterSpacing: "0.06em" }
                : value
                  ? { border: "1px dashed currentColor", background: "transparent", fontStyle: "italic" }
                  : { border: "1px dashed var(--line)", background: "transparent", padding: "3px 7px", borderRadius: 5 }),
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              lineHeight: 1.5,
              cursor: pending ? "progress" : "pointer",
              opacity: pending ? 0.6 : 1,
            }}
          >
            {temperatureLabel(temperature)}
          </button>
        )}
      >
        {(close) => (
          <>
            {LANES.map((lane) => (
              <PopoverItem
                key={lane}
                checked={person && value === lane}
                onSelect={() => {
                  close();
                  onSet(lane);
                }}
              >
                {LANE_LABEL[lane]}
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
              Clear
            </PopoverItem>
          </>
        )}
      </Popover>
    </div>
  );
}

"use client";

import { LANES, LANE_LABEL, type Lane } from "@/lib/leads/lane";
import { NOT_RATED } from "@/lib/ui/words";
import { temperatureLabel, temperatureTitle, type EffectiveTemperature } from "@/lib/intake/effective-temperature";
import { temperaturePill } from "@/lib/intake/temperature-pill";
import Popover, { PopoverItem } from "./Popover";

/**
 * The one Temperature cell: ONE pill style and the menu that sets it (intake SOP Stage 2). A level a person set is the
 * filled pill ("Hot"); a level the system suggests is the same pill, lighter, with "suggested" in its title and accessible
 * name; no level draws nothing (the button is still there, and shows "Set" on hover and focus). Choosing Hot, Warm or Cold
 * sets the person's lane; Not rated clears it and the suggestion shows again.
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
  const pill = temperaturePill(temperature);
  const person = temperature.source === "person" && temperature.value !== null;
  const title = pill ? pill.title : "No temperature yet. Click to set one.";

  return (
    <Popover
      label={`${leadName}: ${pill ? pill.ariaLabel : NOT_RATED}. ${temperatureTitle(temperature).replace("\n", ". ")}. Set temperature`}
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
          className={`ix-temp${pill ? "" : " ix-temp-empty"}`}
          data-tone={pill?.tone}
          data-suggested={pill?.suggested ? "" : undefined}
          style={{ cursor: pending ? "progress" : "pointer", opacity: pending ? 0.6 : undefined }}
        >
          {pill ? pill.text : "Set"}
        </button>
      )}
    >
      {(close) => (
        <>
          {LANES.map((lane) => (
            <PopoverItem
              key={lane}
              checked={person && temperature.value === lane}
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
            {NOT_RATED}
          </PopoverItem>
        </>
      )}
    </Popover>
  );
}

export { temperatureLabel };

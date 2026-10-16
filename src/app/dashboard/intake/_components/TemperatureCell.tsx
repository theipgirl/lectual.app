"use client";

import type { Temperature, TemperatureResult } from "@/lib/intake";
import Popover, { PopoverItem } from "./Popover";
import { TEMP_NONE, TEMP_PILL } from "./styles";

const OPTIONS: Array<{ level: Temperature | null; label: string }> = [
  { level: "hot", label: "Hot" },
  { level: "warm", label: "Warm" },
  { level: "cold", label: "Cold" },
  { level: null, label: "Clear override" },
];

/**
 * The Temp chip and its override menu (§4.3), carried over from Phase 1 in the
 * canvas's tokens.
 *
 * The chip's tooltip is the DERIVATION REASON, not a restatement of the level:
 * the whole point of deriving temperature is that the team can see *why*
 * someone went cold without asking anyone. An overridden chip says so, so a
 * human opinion is never mistaken for the machine's.
 */
export default function TemperatureCell({
  leadName,
  temperature,
  pending,
  onSet,
}: {
  leadName: string;
  temperature: TemperatureResult;
  pending: boolean;
  onSet: (level: Temperature | null) => void;
}) {
  const style = TEMP_PILL[temperature.level] ?? TEMP_NONE;
  const title = temperature.overridden ? `Set by hand — ${temperature.reason}` : temperature.reason;

  return (
    <Popover
      label={`${leadName} is ${temperature.level}. ${title}. Change temperature`}
      width={165}
      trigger={({ onClick, ref, ...aria }) => (
        <button
          {...aria}
          ref={ref}
          type="button"
          title={title}
          disabled={pending}
          onClick={onClick}
          style={{
            ...style,
            border: `1px solid ${temperature.overridden ? "currentColor" : "transparent"}`,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            lineHeight: 1.5,
            cursor: pending ? "progress" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {temperature.level}
          {temperature.overridden ? " ·" : ""}
        </button>
      )}
    >
      {(close) => (
        <>
          {OPTIONS.map((option) => (
            <PopoverItem
              key={option.label}
              checked={temperature.overridden && option.level === temperature.level}
              muted={option.level === null}
              onSelect={() => {
                close();
                onSet(option.level);
              }}
            >
              {option.label}
            </PopoverItem>
          ))}
        </>
      )}
    </Popover>
  );
}

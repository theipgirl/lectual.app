"use client";

import type { Lane } from "@/lib/leads/lane";
import { temperatureLabel, type EffectiveTemperature } from "@/lib/intake/effective-temperature";
import { temperaturePill } from "@/lib/intake/temperature-pill";
import { temperatureControl, type TemperatureControl } from "@/lib/record-card/rules";
import { TempMenu } from "@/components/record-card/controls";

/**
 * The one Temperature cell (Sprint 10): a level a person set is a FILLED pill; a level Lectual only suggested is a quiet OUTLINED
 * pill with a "suggested" mark, and the menu starts with "Lectual suggests Warm · Accept". Choosing a level (or Accept) sets the
 * person's lane; Not rated clears it and the suggestion shows again. A role that can't set it (`canEdit` false) gets the pill as
 * plain text, with no menu. `control` may be passed in; otherwise it is worked out here from the temperature.
 */
export default function TemperatureCell({
  leadName,
  temperature,
  pending,
  onSet,
  canEdit = true,
  control,
}: {
  leadName: string;
  temperature: EffectiveTemperature;
  pending: boolean;
  onSet: (lane: Lane | null) => void;
  canEdit?: boolean;
  control?: TemperatureControl;
}) {
  // No hooks here, so a test can call the cell for its element tree.
  const base = control ?? temperatureControl(temperature, { canEdit });
  // The tooltip keeps the Leads page's own wording: "Suggested: Hot" and the reason, or the stale-lane activity hint.
  const title = temperaturePill(temperature)?.title;
  return TempMenu({ name: leadName, control: title && base.pill.value ? { ...base, pill: { ...base.pill, title } } : base, pending, onPick: onSet });
}

export { temperatureLabel };

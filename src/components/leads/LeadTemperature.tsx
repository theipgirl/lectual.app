import type { TemperatureResult } from "@/lib/intake/temperature";
import { LtnSuggestion } from "@/components/intake/LtnSuggestion";

const LEVEL_LABEL = { hot: "Hot", warm: "Warm", cold: "Cold" } as const;

/**
 * The lead page's temperature line: the same derivation the Intake board uses,
 * with its reason, and the Long-Term Nurture suggestion when the lead is
 * unbooked at day 10. Read-only; the lane and the stage are set elsewhere, by a person.
 */
export function LeadTemperature({ leadId, temperature }: { leadId: string; temperature: TemperatureResult }) {
  // The suggestion has its own line with a link, so the reason doesn't say it twice.
  const reason = temperature.suggestion ? temperature.reason.replace(/ · Long-Term Nurture suggested$/, "") : temperature.reason;
  return (
    <p className="lx-note" style={{ margin: 0, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
      <span>
        Temperature: <b>{LEVEL_LABEL[temperature.level]}</b>
        {temperature.overridden ? " (set by hand)" : ""} · {reason}
      </span>
      <LtnSuggestion suggestion={temperature.suggestion} leadId={leadId} target="sequences" />
    </p>
  );
}

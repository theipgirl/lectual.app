import { timeZoneOptions } from "./profile-rules";

/** The sign-off example: a name, a role and a phone number. No legal wording. */
export const SIGNOFF_PLACEHOLDER = "e.g. Rebecca Beliard, Attorney · RPB Law Firm · (555) 555-0100";

/**
 * A time zone as a person names it: "Eastern Time (New York)". The stored value stays the IANA id; this is
 * only the label. Falls back to the city alone when the runtime has no name for the zone.
 */
export function friendlyZoneLabel(zone: string): string {
  const city = (zone.split("/").at(-1) ?? zone).replaceAll("_", " ");
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(new Date(Date.UTC(2026, 0, 15)))
      .find((p) => p.type === "timeZoneName")?.value;
    if (name && !/^GMT|^UTC/.test(name)) return `${name} (${city})`;
  } catch {
    // Unknown to the runtime: the city alone is still a fair label.
  }
  return city;
}

export type ZoneOption = { value: string; label: string };

/** Every option the select offers: the value is the IANA id, the label is friendly. */
export function zoneOptions(zones: readonly string[] = timeZoneOptions()): ZoneOption[] {
  return zones.map((value) => ({ value, label: friendlyZoneLabel(value) }));
}

export type FirmFormValues = {
  displayName: string;
  timeZone: string;
  emailSignature: string;
  strategySessionUrl: string;
  discoveryCallUrl: string;
  nurtureSequenceId: string;
};

const norm = (v: string) => v.replaceAll("\r\n", "\n").trim();

/** Whether the form differs from what is saved. Surrounding whitespace and line-ending style are not a change. */
export function firmFormDirty(saved: FirmFormValues, current: FirmFormValues): boolean {
  return (Object.keys(saved) as (keyof FirmFormValues)[]).some((k) => norm(saved[k]) !== norm(current[k]));
}

export function firmFormValues(form: FormData): FirmFormValues {
  const get = (name: keyof FirmFormValues) => String(form.get(name) ?? "");
  return {
    displayName: get("displayName"),
    timeZone: get("timeZone"),
    emailSignature: get("emailSignature"),
    strategySessionUrl: get("strategySessionUrl"),
    discoveryCallUrl: get("discoveryCallUrl"),
    nurtureSequenceId: get("nurtureSequenceId"),
  };
}

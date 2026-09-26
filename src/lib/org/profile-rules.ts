/** Pure rules for the firm profile (lectual 0073's limits, checked before the database sees them). */

export type OrgProfile = {
  display_name: string | null;
  time_zone: string;
  email_signature: string | null;
  updated_at: string;
};

export type ProfileInput = { displayName: string; timeZone: string; emailSignature: string };

export const DEFAULT_TIME_ZONE = "America/New_York";

/** US zones first (the firms we serve today), then every zone the runtime knows. */
export function timeZoneOptions(): string[] {
  const us = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf("timeZone");
  } catch {
    all = [];
  }
  return [...us, ...all.filter((z) => !us.includes(z))];
}

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value.length > 0 && value.length <= 64;
  } catch {
    return false;
  }
}

export function checkProfileInput(
  input: ProfileInput,
): { ok: true; value: { display_name: string | null; time_zone: string; email_signature: string | null } } | { ok: false; reason: string } {
  const name = input.displayName.trim();
  const sig = input.emailSignature.replace(/\r\n/g, "\n").trim();
  const tz = input.timeZone.trim() || DEFAULT_TIME_ZONE;
  if (name.length > 120) return { ok: false, reason: "Keep the firm name under 120 characters." };
  if (!isTimeZone(tz)) return { ok: false, reason: "Choose a time zone from the list." };
  if (sig.length > 2000) return { ok: false, reason: "Keep the signature under 2,000 characters." };
  return { ok: true, value: { display_name: name || null, time_zone: tz, email_signature: sig || null } };
}

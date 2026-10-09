/** Pure rules for the firm profile (lectual 0078's limits, checked before the database sees them). */

export type OrgProfile = {
  display_name: string | null;
  time_zone: string;
  email_signature: string | null;
  updated_at: string;
  /** lectual 0085 — where each intake lane's next step points (SOP Stage 2). */
  strategy_session_url: string | null;
  discovery_call_url: string | null;
  nurture_sequence_id: string | null;
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

/**
 * A stored time zone made safe to hand to Intl: the value when the runtime
 * knows it, else the default. A bad value in the profile must never turn a
 * date label into a RangeError that takes the page down with it.
 */
export function resolveTimeZone(value: string | null | undefined): string {
  return value && isTimeZone(value) ? value : DEFAULT_TIME_ZONE;
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

/* ───────────── lane next steps (lectual 0085, intake SOP Stage 2) ───────────── */

export type LaneLinksInput = { strategySessionUrl: string; discoveryCallUrl: string; nurtureSequenceId: string };

export type LaneLinksValue = {
  strategy_session_url: string | null;
  discovery_call_url: string | null;
  nurture_sequence_id: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A booking link: blank → null, else an https URL with no spaces, at most 500
 * characters — the same rule 0085's CHECK enforces, checked first so the
 * firm gets a sentence instead of a constraint name. Staff open this link from
 * a lead's page, so nothing but https is ever stored.
 */
export function checkBookingUrl(raw: string, what: string): { ok: true; value: string | null } | { ok: false; reason: string } {
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  if (value.length > 500) return { ok: false, reason: `Keep the ${what} under 500 characters.` };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: `The ${what} isn't a web address. Paste the full link, starting with https://.` };
  }
  if (url.protocol !== "https:" || /\s/.test(value)) {
    return { ok: false, reason: `The ${what} must be an https:// link.` };
  }
  return { ok: true, value };
}

export function checkLaneLinksInput(input: LaneLinksInput): { ok: true; value: LaneLinksValue } | { ok: false; reason: string } {
  const strategy = checkBookingUrl(input.strategySessionUrl, "strategy-session link");
  if (!strategy.ok) return strategy;
  const discovery = checkBookingUrl(input.discoveryCallUrl, "discovery-call link");
  if (!discovery.ok) return discovery;
  const nurture = input.nurtureSequenceId.trim();
  if (nurture && !UUID.test(nurture)) return { ok: false, reason: "Choose the nurture campaign from the list." };
  return {
    ok: true,
    value: { strategy_session_url: strategy.value, discovery_call_url: discovery.value, nurture_sequence_id: nurture || null },
  };
}

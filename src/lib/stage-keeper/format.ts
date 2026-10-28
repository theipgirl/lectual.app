import { zonedParts } from "@/lib/calendar/grid";
import { MOVED_AUTOMATICALLY } from "@/lib/ui/words";
import type { MoveEvidence } from "./signals";

/**
 * The words for a Stage Keeper move: the board chip, its tooltip and the timeline sentence.
 * Pure. Dates are drawn in the firm's own zone from a fixed month table, never from the
 * runtime's locale data ("Sept" on one machine and "Sep" on another is a hydration mismatch).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const DEFAULT_ZONE = "UTC";

function safeParts(iso: string, timeZone: string): { date: string; time: string } | null {
  if (!Number.isFinite(Date.parse(iso))) return null;
  try {
    return zonedParts(iso, timeZone);
  } catch {
    return zonedParts(iso, DEFAULT_ZONE);
  }
}

/** "Oct 20" in the firm's zone, or null for an unusable date. */
export function monthDay(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string | null {
  if (!iso) return null;
  const parts = safeParts(iso, timeZone);
  if (!parts) return null;
  const [, month, day] = parts.date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}`;
}

/** "2:00 PM" in the firm's zone, or null for an unusable time. */
export function clockTime(iso: string | null | undefined, timeZone: string = DEFAULT_ZONE): string | null {
  if (!iso) return null;
  const parts = safeParts(iso, timeZone);
  if (!parts) return null;
  const [h, m] = parts.time.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** The civil date (YYYY-MM-DD) of an instant in the firm's zone: what "today" means. */
export function civilDay(iso: string, timeZone: string = DEFAULT_ZONE): string | null {
  return safeParts(iso, timeZone)?.date ?? null;
}

const MAIL_PHRASE: Record<string, string> = {
  "loe-invoice": "an LOE and invoice email",
  questionnaire: "a questionnaire email",
  "post-consult": "a post-consult email",
  welcome: "a welcome email",
};

const MAIL_NOUN: Record<string, string> = {
  "loe-invoice": "LOE and invoice email",
  questionnaire: "questionnaire email",
  "post-consult": "post-consult email",
  welcome: "welcome email",
};

/** "an LOE and invoice email was sent on Oct 20" / "a consult was booked for Oct 24 at 2:00 PM". */
export function reasonText(evidence: MoveEvidence | null, timeZone: string = DEFAULT_ZONE): string {
  if (!evidence) return "the record showed it had moved on";
  if (evidence.kind === "mail") {
    const day = monthDay(evidence.at, timeZone);
    return `${MAIL_PHRASE[evidence.type] ?? "an email"} was sent${day ? ` on ${day}` : ""}`;
  }
  if (evidence.kind === "calendar") {
    const day = monthDay(evidence.starts_at, timeZone);
    const time = clockTime(evidence.starts_at, timeZone);
    return `a consult was booked${day ? ` for ${day}${time ? ` at ${time}` : ""}` : ""}`;
  }
  if (evidence.kind === "meeting") {
    const day = monthDay(evidence.starts_at, timeZone);
    return `a ${evidence.provider === "fathom" ? "Fathom" : evidence.provider === "zoom" ? "Zoom" : "recorded"} consult was held${day ? ` on ${day}` : ""}`;
  }
  if (evidence.kind === "proposal") {
    const day = monthDay(evidence.at, timeZone);
    return `the proposal link ${evidence.status === "accepted" ? "was accepted by the client" : "was turned on"}${day ? ` on ${day}` : ""}`;
  }
  if (evidence.kind === "queue") {
    const day = monthDay(evidence.at, timeZone);
    return `the post-consult email was approved${day ? ` on ${day}` : ""}`;
  }
  const day = monthDay(evidence.at, timeZone);
  return `a payment was recorded${day ? ` on ${day}` : ""}`;
}

/** The tooltip on the chip: the evidence and nothing else. */
export function evidenceTooltip(evidence: MoveEvidence | null, timeZone: string = DEFAULT_ZONE): string {
  if (!evidence) return `${MOVED_AUTOMATICALLY}.`;
  if (evidence.kind === "mail") {
    const day = monthDay(evidence.at, timeZone);
    return `Evidence: ${MAIL_NOUN[evidence.type] ?? "email"} sent${day ? ` ${day}` : ""}.`;
  }
  if (evidence.kind === "calendar") {
    const day = monthDay(evidence.starts_at, timeZone);
    const time = clockTime(evidence.starts_at, timeZone);
    const when = day ? ` on ${day}${time ? ` at ${time}` : ""}` : "";
    return `Evidence: calendar event${evidence.title ? ` "${evidence.title}"` : ""}${when}.`;
  }
  if (evidence.kind === "meeting") {
    const day = monthDay(evidence.starts_at, timeZone);
    return `Evidence: ${evidence.provider === "fathom" ? "Fathom" : evidence.provider === "zoom" ? "Zoom" : "recorded"} meeting${evidence.title ? ` "${evidence.title}"` : ""}${day ? ` on ${day}` : ""}.`;
  }
  if (evidence.kind === "proposal") {
    const day = monthDay(evidence.at, timeZone);
    return `Evidence: proposal${evidence.version ? ` version ${evidence.version}` : ""} ${evidence.status === "accepted" ? "accepted" : "link live"}${day ? ` ${day}` : ""}.`;
  }
  if (evidence.kind === "queue") {
    const day = monthDay(evidence.at, timeZone);
    return `Evidence: post-consult email approved${day ? ` ${day}` : ""}.`;
  }
  const day = monthDay(evidence.at, timeZone);
  return `Evidence: payment recorded${day ? ` ${day}` : ""}.`;
}

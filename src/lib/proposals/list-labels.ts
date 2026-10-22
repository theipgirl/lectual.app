/**
 * The words in the proposals table's cells (spec B5, "Quotes & proposals" design): the
 * proposal title line, its sub-line, the Expires cell and the Last activity cell. Pure and
 * client-safe: every clock and time zone comes in as an argument.
 *
 * Fees are never summed here, and nothing is labelled "total".
 */

import type { ProposalDisplayKey } from "./display-status";
import { stepActivityLabel } from "./paid";

const upper = (s: string) => s.trim().toUpperCase();

/** "5 classes" / "1 class". */
export function classesLabel(n: number): string {
  return `${n} ${n === 1 ? "class" : "classes"}`;
}

/** "Trademark package — ONEFORME PILATES": the first two brand names, uppercased and joined with " & "; the bare title with none. */
export function proposalHeadline(title: string, brands: readonly string[]): string {
  const names = brands.map(upper).filter(Boolean).slice(0, 2);
  return names.length > 0 ? `${title} — ${names.join(" & ")}` : title;
}

/** A stable reference for a proposal: `pr-` and the first six characters of its family id, with the version once there is a second. */
export function proposalRef(familyId: string, version: number): string {
  const short = familyId.replace(/-/g, "").slice(0, 6).toLowerCase();
  return `pr-${short}${version > 1 ? ` · v${version}` : ""}`;
}

/**
 * The line under the title. Accepted: "<ref> · <PACKAGE> signed · <c> classes". Otherwise
 * "<ref> · <n> package(s) offered · <c> classes", or "no package offered" for none. "edited
 * from <PACKAGE>" follows when a number was changed from the package it started from.
 */
export function proposalSubline(input: {
  ref: string;
  key: ProposalDisplayKey;
  offeredCount: number;
  signedPackage: string | null;
  classCount: number;
  editedFrom: string | null;
}): string {
  const parts = [input.ref];
  if (input.key === "accepted" && input.signedPackage) parts.push(`${upper(input.signedPackage)} signed`);
  else parts.push(input.offeredCount === 0 ? "no package offered" : `${input.offeredCount} ${input.offeredCount === 1 ? "package" : "packages"} offered`);
  parts.push(classesLabel(input.classCount));
  if (input.editedFrom) parts.push(`edited from ${upper(input.editedFrom)}`);
  return parts.join(" · ");
}

/* ─────────────────────────── dates ──────────────────────────────────────── */

/** "Sep 4" for a civil date ("2026-09-04"), whatever zone the server runs in. */
export function monthDay(civil: string): string {
  const ms = Date.parse(`${civil}T12:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(ms));
}

/** "9 Sep" for an instant, in the firm's zone. Built from parts: en-GB would write "Sept". */
export function dayMonth(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${get("month")}`;
}

/**
 * The Expires cell: "Aug 28" for a Sent row or a Draft/Blocked row with a date; "Signed 9 Sep"
 * once accepted; "Expired Sep 4" for a derived expiry; "Not sent" for a Draft with no date;
 * "—" when there is none to show.
 */
export function expiresLabel(input: {
  key: ProposalDisplayKey;
  expiresOn: string | null;
  acceptedAt: string | null;
  tz: string;
}): string {
  const date = input.expiresOn ? monthDay(input.expiresOn) : "";
  switch (input.key) {
    case "accepted": {
      const signed = dayMonth(input.acceptedAt, input.tz);
      return signed ? `Signed ${signed}` : "—";
    }
    case "expired":
      return date ? `Expired ${date}` : "—";
    case "draft":
      return date || "Not sent";
    default:
      return date || "—";
  }
}

/** "just now", "6m ago", "3h ago", "2d ago", else a short date. The Last activity cell's compact form. */
export function compactAgo(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.round((now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86_400 * 14) return `${Math.floor(s / 86_400)}d ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(t));
}

/* ─────────────────────────── last activity ──────────────────────────────── */

/** The newest event on a proposal, as much of it as this cell reads. */
export type ActivityEvent = {
  type: string;
  actor: string;
  actor_user_id: string | null;
  created_at: string;
  /** Only set where the page read it (an accepted row's newest step event): lets "Edited" say what was done. */
  payload?: unknown;
};

export const AGENT_DRAFT_LINE = "Drafted by the intake agent from the consult";

const EVENT_VERB: Record<string, string> = {
  created: "Created",
  edited: "Edited",
  revised: "Revised",
  approved: "Approved",
  unapproved: "Approval removed",
  sent: "Sent",
  accepted: "Accepted",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
  viewed: "Opened by the client",
};

/**
 * One line for the Last activity cell, from what is known and never from a guess:
 *
 *   accepted          "Accepted by the client · 2d ago"
 *   expired           "Stored status still says sent"   (the stored status is `sent`; the date has passed)
 *   blocked           "No package offered yet", else the first thing blocking approval
 *   draft/sent/closed the newest event: "Edited 3h ago · Taylor", or the agent's own line
 *
 * When the events could not be read (`event: "unavailable"`) or a row has none, the line falls
 * back to `updated_at` ("Updated 3h ago"): a fact about the row, not a claim about who did what.
 * The name is dropped, never replaced by an id, when it is not known.
 */
export function lastActivityLine(input: {
  key: ProposalDisplayKey;
  source: string;
  updatedAt: string;
  acceptedAt: string | null;
  offeredCount: number;
  blockingIssue: string | null;
  event: ActivityEvent | null | "unavailable";
  names: ReadonlyMap<string, string>;
  now: number;
}): string {
  const updated = () => {
    const ago = compactAgo(input.updatedAt, input.now);
    return ago ? `Updated ${ago}` : "Updated";
  };
  switch (input.key) {
    case "accepted": {
      // After acceptance the only edits are Sprint 19 steps. A person's ("Marked paid") is the news; the
      // system's own notice and note are not, so the client's acceptance stays the headline until a person acts.
      const e = input.event && input.event !== "unavailable" && input.event.type === "edited" && input.event.actor === "staff" ? input.event : null;
      const step = e ? stepActivityLabel(e.payload) : null;
      if (e && step) return withWho(step, e, input);
      const ago = compactAgo(input.acceptedAt ?? input.updatedAt, input.now);
      return ago ? `Accepted by the client · ${ago}` : "Accepted by the client";
    }
    case "expired":
      return "Stored status still says sent";
    case "blocked":
      return input.offeredCount === 0 ? "No package offered yet" : (input.blockingIssue ?? "Needs fixing before it can be approved");
    default:
      break;
  }
  if (input.event === "unavailable") return updated();
  if (input.event === null) return input.source === "agent" ? AGENT_DRAFT_LINE : updated();
  const e = input.event;
  if (e.actor === "agent" || (input.source === "agent" && e.type === "created")) return AGENT_DRAFT_LINE;
  const verb = (e.type === "edited" ? stepActivityLabel(e.payload) : null) ?? EVENT_VERB[e.type] ?? "Updated";
  return withWho(verb, e, input);
}

/** "<what> 3h ago · Taylor": the name only for a teammate we can name, never an id. */
function withWho(what: string, e: ActivityEvent, input: { names: ReadonlyMap<string, string>; now: number }): string {
  const ago = compactAgo(e.created_at, input.now);
  const name = e.actor === "staff" && e.actor_user_id ? input.names.get(e.actor_user_id) : undefined;
  return `${what}${ago ? ` ${ago}` : ""}${name ? ` · ${name}` : ""}`;
}

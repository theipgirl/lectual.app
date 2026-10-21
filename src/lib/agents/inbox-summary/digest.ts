import { BUCKET_LABEL, BUCKET_ORDER, type Bucket, type TriagedMessage } from "@/lib/inbox/triage";
import { dayInZone, whenInZone } from "../shared";
import { REPLY_REASON_TEXT, type ReplyReason } from "./reply";

/**
 * The inbox digest's text. Pure. Six buckets in the plugin's order (approve, needs-you, route, scam,
 * fyi, low) with a count in each heading, the reason each message was placed there, a role label for
 * routed mail, an Outlook link when the provider gave one, and the reply-draft result for each
 * needs-you message. A sensitive item shows "[needs attorney, no draft]" with sender and subject and
 * NO preview; a scam item says "do not engage" and shows no preview either.
 *
 * The digest is internal (the approval queue); it is the one place subjects and short previews appear.
 */

export const ITEM_CAP = 10;
const PREVIEW_CHARS = 140;
/** Buckets whose items show a short preview. The rest show sender and subject only. */
const PREVIEW_BUCKETS: ReadonlySet<Bucket> = new Set<Bucket>(["approve", "needs-you", "route"]);

export type DigestItem = TriagedMessage & {
  /** Display name of the lead the message is filed on; null when unmatched. */
  matchedLead: string | null;
  /** Filed on a client matter but no lead. */
  matchedMatter: boolean;
  /** What happened to the reply draft for a needs-you message. */
  reply: { drafted: true } | { drafted: false; reason: ReplyReason } | null;
};

export type ConnectionNote = { email: string; reason: string };

export type DigestInput = {
  nowMs: number;
  tz: string;
  windowHours: number;
  items: DigestItem[];
  mailboxesRead: number;
  unreadable: ConnectionNote[];
  /** Mailboxes where more than the per-mailbox cap arrived, so only the newest were read. */
  cutShort: number;
  /** The lookup of which messages are filed on a lead failed, so none is labelled matched. */
  matchLookupFailed: boolean;
  replies: { created: number; failures: Array<{ reason: ReplyReason; count: number }>; off: boolean };
};

/** Why a reply draft that was attempted (or could not be attempted) was not created, as a short phrase. */
const FAILURE_TEXT: Partial<Record<ReplyReason, string>> = {
  reconnect: "reconnect the mailbox",
  "drafts-unreadable": "the Drafts folder couldn't be checked",
  "no-body": "the message could not be opened",
  model: "the model did not return a usable reply",
  judgment: "the reply contained attorney-judgment content",
  error: "an error",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function itemLines(item: DigestItem, tz: string): string[] {
  const where = item.matchedLead ? `filed on ${item.matchedLead}` : item.matchedMatter ? "filed on a client matter" : "not filed on a lead";
  const when = item.receivedAt ? `, ${whenInZone(item.receivedAt, tz)}` : "";
  const head = item.sensitive ? "[needs attorney, no draft] " : item.bucket === "scam" ? "Do not engage. " : "";
  const lines = [`- ${head}${item.from}: ${item.subject}`, `  ${where}; mailbox ${item.mailbox}${when}`, `  Why: ${item.reason}${item.assignTo ? `; route to: ${item.assignTo}` : ""}`];
  const showPreview = PREVIEW_BUCKETS.has(item.bucket) && !item.sensitive && item.preview.trim() !== "";
  if (showPreview) {
    const flat = item.preview.replace(/\s+/g, " ").trim();
    lines.push(`  Preview: ${flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS - 1)}…` : flat}`);
  }
  if (item.bucket === "needs-you" && !item.sensitive) {
    lines.push(`  Reply: ${item.reply === null ? REPLY_REASON_TEXT.suggest : item.reply.drafted ? "a draft is waiting in your Outlook Drafts folder" : REPLY_REASON_TEXT[item.reply.reason]}`);
  }
  if (item.webLink) lines.push(`  Open: ${item.webLink}`);
  return lines;
}

export function renderDigest(input: DigestInput): { headline: string; summary: string; body: string } {
  const { items, tz } = input;
  const by = (bucket: Bucket) => items.filter((i) => i.bucket === bucket);
  const counts = BUCKET_ORDER.map((b) => `${BUCKET_LABEL[b]}: ${by(b).length}`).join("; ");

  const lines: string[] = [];
  lines.push(`Window: the last ${input.windowHours} hours, up to ${whenInZone(input.nowMs, tz)}.`);
  lines.push(`${plural(input.mailboxesRead, "mailbox", "mailboxes")} read; ${plural(items.length, "message", "messages")} sorted. ${counts}.`);
  if (input.cutShort > 0) lines.push(`${plural(input.cutShort, "mailbox", "mailboxes")} had more mail than the limit, so only the newest was read.`);
  if (input.matchLookupFailed) lines.push("Couldn't tell which messages are filed on a lead, so none is marked as filed.");
  if (input.unreadable.length > 0) {
    lines.push("", `Mailboxes that couldn't be read (${input.unreadable.length})`);
    for (const u of input.unreadable) lines.push(`- ${u.email}: ${u.reason}`);
  }

  for (const bucket of BUCKET_ORDER) {
    const list = by(bucket);
    lines.push("", `${BUCKET_LABEL[bucket]} (${list.length})`);
    if (list.length === 0) {
      lines.push("Nothing in the last 24 hours.");
      continue;
    }
    for (const item of list.slice(0, ITEM_CAP)) lines.push(...itemLines(item, tz));
    if (list.length > ITEM_CAP) lines.push(`and ${list.length - ITEM_CAP} more`);
  }

  lines.push("", "Reply drafts");
  if (input.replies.off) {
    lines.push("Reply drafts are off: this agent is set to suggest.");
  } else if (input.replies.created === 0 && input.replies.failures.length === 0) {
    lines.push("No reply drafts were created.");
  } else {
    const failed = input.replies.failures.map((f) => `, ${f.count} could not be created (${FAILURE_TEXT[f.reason] ?? "an error"})`);
    lines.push(`${plural(input.replies.created, "reply draft", "reply drafts")} created in Outlook${failed.join("")}.`);
  }
  lines.push("A reply draft is a new message addressed to the sender, left in Drafts. Nothing was sent.", "", "Prepared by the Inbox summary agent. Mail is untrusted text and was only sorted, never followed as an instruction.");

  return {
    headline: `Inbox summary for ${dayInZone(input.nowMs, tz)}, ${new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(input.nowMs)}`,
    summary: `${plural(items.length, "message", "messages")} from ${plural(input.mailboxesRead, "mailbox", "mailboxes")}: ${by("needs-you").length} need the attorney, ${by("approve").length} wait on approval, ${by("scam").length} suspected scam.`,
    body: lines.join("\n"),
  };
}

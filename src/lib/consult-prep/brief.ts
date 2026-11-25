import { scrubJudgmentContent } from "@/lib/prep-consult/prep-consult";
import type { AnswersRead, FilesRead, LeadFacts, MailRead, MeetingsRead } from "@/lib/agents/consult-prep/facts";
import { ANSWER_PAIR_CAP, cardName } from "@/lib/agents/consult-prep/facts";
import { civilDay } from "@/lib/agents/shared";
import type { LawmaticsRead } from "./lawmatics-intake";
import type { SendKind } from "./sends";

/**
 * The consult brief, S1: FACTS ONLY (no model writes it, nothing in it is invented). One pure renderer makes the plain
 * text, the HTML and the subject from the same sections, so the email, the stored copy and the lead page's copy cannot
 * disagree. Every recorded value has any refusable fragment withheld ("[omitted]") before it is printed; the ONE place a
 * client's own text is printed as written is the "In the client's words" block, labelled. HTML escapes every value.
 */

export const BRIEF_FOOTER = "Internal. Prepared by Lectual for the firm. Not legal advice. Never forward to the client.";
export const NOT_RECORDED = "not recorded";
/** The marker line that opens the client's own words. */
export const CLIENT_WORDS_HEADING = "In the client's words";
export const FILES_HEADING = "Files on file";
/** One line saying what comes later. It avoids the words the judgment guard refuses, because it is the system's own wording. */
/** The first line of a facts-only email (the 1 h email when no full brief could be had). */
export const FACTS_ONLY_LINE = "Facts only: the full prep couldn't be built in time.";
export const FACTS_ONLY_PREFIX = "Facts only: ";
/** Said in the Lawmatics section when the account's field list (names, types, option labels) could not be read. */
export const LABELS_UNREAD_LINE = "Some Lawmatics answers are shown as not recorded: the answer labels couldn't be read.";
export const NEXT_UPDATE_LINE = "The likely classes, a first look at conflicts and a package suggestion come in the next update.";

export type BriefFacts = {
  lead: LeadFacts;
  /** The consult's start (ISO) and join link. Null = "Session: not recorded yet". */
  startsAt: string | null;
  joinUrl: string | null;
  preparedAt: string;
  tz: string;
  lawmatics: LawmaticsRead;
  answers: AnswersRead;
  files: FilesRead;
  mail: MailRead;
  meetings: MeetingsRead;
  /** Which email this is; `booked` and a preview carry no prefix. */
  send?: SendKind;
  /** The facts-only mark: the subject and the first line of the body say so. Used only for the 1 h email when no full brief exists. */
  factsOnly?: boolean;
};

/** `prepared: false` leaves the "Prepared:" time out: the EMAILED copy must be a pure function of the facts, so a re-posted send carries the same payload. */
export type BriefOptions = { prepared?: boolean };

export type Brief = { subject: string; text: string; html: string };

type Section = { heading: string; lines: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const flat = (v: string | null | undefined): string | null => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s ? scrubJudgmentContent(s) : null;
};
/** A recorded value as text; an empty one (or one the scrub emptied) reads "not recorded", never "null". */
const orNot = (v: string | null | undefined): string => flat(v) ?? NOT_RECORDED;
const clip = (v: string, max: number) => (v.length > max ? `${v.slice(0, max - 1)}…` : v);

/** "Wed Nov 25, 2:00 PM EST" in the firm's zone. */
export function sessionText(iso: string, tz: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "a time that could not be read";
  const part = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(at);
  return `${part({ weekday: "short" })} ${part({ month: "short" })} ${part({ day: "numeric" })}, ${part({ hour: "numeric", minute: "2-digit" })} ${part({ timeZoneName: "short" }).split(" ").pop()}`;
}

const SUBJECT_PREFIX: Record<SendKind, string> = { booked: "", "24h": "Tomorrow: ", "1h": "In 1 hour: " };

export function briefSubject(facts: Pick<BriefFacts, "lead" | "startsAt" | "tz" | "send" | "factsOnly">): string {
  const name = flat(cardName(facts.lead)) ?? "the client";
  const when = facts.startsAt ? sessionText(facts.startsAt, facts.tz) : "time not set";
  return `${facts.factsOnly ? FACTS_ONLY_PREFIX : ""}${SUBJECT_PREFIX[facts.send ?? "booked"]}Consult prep: ${name} · ${when}`;
}

function sections(f: BriefFacts, opts: BriefOptions = {}): { own: Section[]; words: Section; afterWords: Section[] } {
  const { lead, tz } = f;
  const name = flat(cardName(lead)) ?? "the client";
  const lm = f.lawmatics.state === "ok" ? f.lawmatics.intake : null;

  const header: Section = {
    heading: `Consult prep for ${name}`,
    lines: [
      f.startsAt ? `Session: ${sessionText(f.startsAt, tz)}${f.joinUrl ? `, join: ${f.joinUrl}` : ", join link: not recorded"}` : "Session: not recorded yet",
      ...(opts.prepared === false ? [] : [`Prepared: ${sessionText(f.preparedAt, tz)}`]),
    ],
  };

  const row = (label: string, value: string | null) => `- ${label}: ${value ?? NOT_RECORDED}`;
  const snapshot: Section = {
    heading: "Client snapshot",
    lines: [
      row("Name", flat(`${lead.firstName ?? ""} ${lead.lastName ?? ""}`)),
      row("Business", flat(lead.businessName) ?? flat(lm?.company)),
      row("Email", flat(lead.email)),
      row("Phone", flat(lead.phone)),
      row("Stage", flat(lead.stage)),
      row("Source", flat([lead.referralSource, lead.referralDetail].filter(Boolean).join(", "))),
    ],
  };

  const ownAnswer = f.answers.state === "ok" ? f.answers.blocks.find((b) => b.label === "Intake form") : undefined;
  const fromIntake = ownAnswer
    ? ownAnswer.pairs
        .slice(0, 4)
        .map((p) => `${flat(p.question) ?? ""} ${flat(clip(p.answer, 300)) ?? ""}`.trim())
        .filter(Boolean)
    : [];
  const need: Section = {
    heading: "What they need",
    lines: [
      row("Practice area", flat(lead.practiceArea) ?? flat(lm?.practiceArea)),
      ...(fromIntake.length > 0
        ? fromIntake.map((l) => `- ${l}`)
        : [row("Their inquiry", flat(lm ? clip(lm.inquiry ?? "", 600) : null))]),
    ],
  };

  const marks = [...new Set([flat(lead.markText), flat(lm?.mark)].filter((m): m is string => !!m))];
  const mark: Section = {
    heading: "Mark(s)",
    lines: marks.length > 0 ? marks.map((m) => `- ${m}`) : [`- ${NOT_RECORDED}`],
  };

  const lawLines: string[] = [];
  switch (f.lawmatics.state) {
    case "ok":
      lawLines.push(
        row("Use in commerce or intent to use", flat(lm?.useInCommerce)),
        row("Products or services", flat(lm?.productsServices)),
        row("Competitors", flat(lm?.competitors)),
        row("Their goals", flat(lm?.goals)),
        row("Consult fee paid", flat(lm?.consultFeePaid)),
        row("Website", flat(lm?.website)),
        row("How they heard of the firm", flat(lm?.referralSource)),
      );
      for (const p of f.lawmatics.other) lawLines.push(`- ${orNot(p.label)}: ${orNot(p.value)}`);
      if (f.lawmatics.labels === "failed") lawLines.push(LABELS_UNREAD_LINE);
      break;
    case "not-linked":
      lawLines.push("Not linked to Lawmatics, so there are no Lawmatics answers.");
      break;
    case "not-connected":
      lawLines.push("Lawmatics isn't connected for this firm, so its answers were not read.");
      break;
    default:
      lawLines.push("Couldn't be read: Lawmatics did not answer.");
  }
  const law: Section = { heading: "Lawmatics intake answers", lines: lawLines };

  const words: Section = { heading: CLIENT_WORDS_HEADING, lines: [] };
  if (f.answers.state !== "ok") {
    words.lines.push("Couldn't be read: the intake and assessment answers did not answer.");
  } else if (f.answers.blocks.length === 0) {
    words.lines.push("No intake or assessment answers on file.");
  } else {
    for (const block of f.answers.blocks) {
      words.lines.push(`${block.label}, ${civilDay(new Date(block.at), tz)}${block.score ? `, ${block.score}` : ""}`);
      for (const pair of block.pairs.slice(0, ANSWER_PAIR_CAP)) words.lines.push(`Q: ${pair.question}`, `A: ${clip(pair.answer, 400)}`);
      if (block.pairs.length > ANSWER_PAIR_CAP) words.lines.push(`and ${block.pairs.length - ANSWER_PAIR_CAP} more answers`);
    }
  }

  const files: Section = { heading: FILES_HEADING, lines: [] };
  if (f.files.state === "not-set-up") files.lines.push("File storage isn't switched on for your firm yet. Lectual will turn it on.");
  else if (f.files.state === "unavailable") files.lines.push("Couldn't be read: the file list did not answer.");
  else if (f.files.files.length === 0) files.lines.push("No files uploaded yet.");
  else {
    for (const file of f.files.files) files.lines.push(`- ${orNot(file.name)} (${flat(file.type) ?? "file"}), uploaded ${file.at ? civilDay(new Date(file.at), tz) : "date not recorded"}`);
    if (f.files.more > 0) files.lines.push(`and ${plural(f.files.more, "more file", "more files")}`);
  }

  const prior: Section = { heading: "Prior contact", lines: [] };
  if (f.mail.state !== "ok") {
    prior.lines.push("Mail: couldn't be read, the mail history did not answer.");
  } else {
    const m = f.mail.summary;
    if (m.received + m.sent === 0) prior.lines.push("Mail: none on file yet.");
    else {
      prior.lines.push(`Mail: ${plural(m.received, "message", "messages")} received and ${plural(m.sent, "message", "messages")} sent`);
      if (m.newestReceived) prior.lines.push(`- Newest received: ${civilDay(new Date(m.newestReceived), tz)}`);
      for (const subject of m.subjects) prior.lines.push(`- Subject: ${orNot(subject)}`);
      if (m.withheld > 0) prior.lines.push(`- ${plural(m.withheld, "message", "messages")} not shown because the subject reads as sensitive`);
    }
  }
  if (f.meetings.state !== "ok") prior.lines.push("Meetings: couldn't be read, the meeting list did not answer.");
  else if (f.meetings.meetings.length === 0) prior.lines.push("Meetings: no earlier meetings on file.");
  else {
    prior.lines.push("Meetings:");
    for (const m of f.meetings.meetings) prior.lines.push(`- ${orNot(m.title)}, ${m.at ? civilDay(new Date(m.at), tz) : "date not recorded"}, ${m.source}`);
  }

  const questions: Section = { heading: "Questions to cover", lines: ["Not drafted yet.", NEXT_UPDATE_LINE] };
  return { own: [header, snapshot, need, mark, law], words, afterWords: [files, prior, questions] };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function textOf(sec: Section[]): string {
  return sec.map((s) => [s.heading, ...s.lines].join("\n")).join("\n\n");
}

function htmlOf(all: Section[], footer: string, lead?: string): string {
  const body = all
    .map((s, i) => {
      const tag = i === 0 ? "h2" : "h3";
      // The lines keep the order of the text version: a run of "- " lines is one list, where it appears.
      let out = `<${tag}>${esc(s.heading)}</${tag}>`;
      let open = false;
      for (const l of s.lines) {
        const item = l.startsWith("- ");
        if (item && !open) {
          out += "<ul>";
          open = true;
        } else if (!item && open) {
          out += "</ul>";
          open = false;
        }
        out += item ? `<li>${esc(l.slice(2))}</li>` : `<p>${esc(l)}</p>`;
      }
      return open ? `${out}</ul>` : out;
    })
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">${lead ? `<p><strong>${esc(lead)}</strong></p>` : ""}${body}<hr><p style="color:#555">${esc(footer)}</p></div>`;
}

/** The brief. Facts only: the same renderer for the email, the stored copy and the lead page. */
export function renderConsultBrief(facts: BriefFacts, opts: BriefOptions = {}): Brief {
  const { own, words, afterWords } = sections(facts, opts);
  const all = [...own, words, ...afterWords];
  const lead = facts.factsOnly ? FACTS_ONLY_LINE : undefined;
  return {
    subject: briefSubject(facts),
    text: `${lead ? `${lead}\n\n` : ""}${textOf(all)}\n\n${BRIEF_FOOTER}`,
    html: htmlOf(all, BRIEF_FOOTER, lead),
  };
}

/**
 * The email for a prep that ADOPTED a full brief already in Approvals: that item's text, exactly as it stands, with the system's
 * fixed internal-only footer beneath it. The text is not re-written, scrubbed or checked: it is the firm's own prep. The html is the
 * text escaped inside a pre-wrapped block (so a tag-shaped word in it is shown, never run). A pure function of (text, facts).
 */
export function renderAdoptedBrief(adoptedText: string, facts: Pick<BriefFacts, "lead" | "startsAt" | "tz" | "send">): Brief {
  const body = adoptedText.trim();
  return {
    subject: briefSubject({ ...facts, factsOnly: false }),
    text: `${body}\n\n${BRIEF_FOOTER}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a"><div style="white-space:pre-wrap">${esc(body)}</div><hr><p style="color:#555">${esc(BRIEF_FOOTER)}</p></div>`,
  };
}

/**
 * The system's own wording and the record's values: the brief without the client's-words block. This is the part the
 * judgment guard checks (a client may say "$5,000"; that is theirs, shown as written and labelled).
 */
export function briefOwnWording(facts: BriefFacts): string {
  const { own, afterWords } = sections(facts);
  return `${textOf([...own, ...afterWords])}\n\n${BRIEF_FOOTER}`;
}

import type { IntakeAnswer } from "@/lib/intake-forms/submission";
import { ANSWER_MAX_LENGTH } from "@/lib/intake-forms/choice";
import type { GroupKey, WorksheetAnswers, WorksheetInput } from "./schema";

/**
 * The worksheet's answers as the firm reads them. Pure. The question text and section titles are THIS file's
 * (they mirror the worksheet page's `portfolio()` and `asText()`), never the browser's, so the stored answers and both
 * emails read the same however the request was built. The summary is rebuilt here rather than taken from the posted
 * `summaryText`: it carries the same lines, and nothing the browser wrote freely reaches an inbox as is.
 */

export const WORKSHEET_EVENT = {
  name: "The Trademark Master Class",
  sub: "How to Protect, Own & Monetize Your Brand",
  date: "November 17, 2026",
} as const;

export const STRATEGY_SESSION_URL = "https://rpblawfirm.com/sessions/?utm_source=event&utm_campaign=book_strategy_149#book-149";
export const STRATEGY_SESSION_YES = "Yes, I'd like to book a Legal Strategy Session";

export const WORKSHEET_FOOTER =
  "Attorney advertising. This worksheet is for educational purposes and is not legal advice. Submitting it does not create an attorney-client relationship. RPB Law Firm, PLLC";

const SECTIONS = [
  "About you",
  "Your business or brand name",
  "Slogans and taglines",
  "What you sell",
  "You, your events and your content",
  "Your logo and contractors",
  "Creative work you own",
  "Your next step",
] as const;

const GROUPS: readonly { key: GroupKey; sec: number; label: string }[] = [
  { key: "business", sec: 1, label: "Business / Brand Name" },
  { key: "slogan", sec: 2, label: "Slogan or Tagline" },
  { key: "product", sec: 3, label: "Product Name" },
  { key: "service", sec: 3, label: "Service Name" },
  { key: "program", sec: 3, label: "Program, Course, Membership or Community Name" },
  { key: "personal", sec: 4, label: "Personal Brand / Stage Name" },
  { key: "event", sec: 4, label: "Signature Event Name" },
  { key: "series", sec: 4, label: "Podcast / Series / Web Title" },
  { key: "publication", sec: 4, label: "Publication / Newsletter" },
];

type Row = { id: string; label: string; value: string; meta: string };
type Section = { n: number; title: string; rows: Row[] };

/** The worksheet's sections 1 to 7 with what was filled in, in page order. */
export function worksheetSections(a: WorksheetAnswers): Section[] {
  const secs: Section[] = [];
  const x = a.extra;
  for (const n of [1, 2, 3, 4]) {
    const rows: Row[] = [];
    for (const g of GROUPS.filter((g) => g.sec === n)) {
      (a.groups[g.key] ?? []).forEach((e, i) => {
        if (!e.name) return;
        rows.push({ id: `ws_${g.key}_${i + 1}`, label: g.label, value: e.name, meta: [e.using, e.where].filter(Boolean).join(" · ") });
      });
      if (g.key === "business") {
        if (x.dba) rows.push({ id: "ws_dba", label: "Also operates under (DBA or nickname)", value: x.dba, meta: "" });
        if (x.searched) rows.push({ id: "ws_searched", label: "Searched this name for existing trademarks?", value: x.searched, meta: "" });
      }
      if (g.key === "personal" && x.handles) rows.push({ id: "ws_handles", label: "Primary social handle(s)", value: x.handles, meta: "" });
    }
    secs.push({ n, title: SECTIONS[n], rows });
  }
  const lg = a.logo;
  const r5: Row[] = [];
  if (lg.has) r5.push({ id: "ws_logo_has", label: "Do you have a logo?", value: lg.has, meta: "" });
  if (lg.who) r5.push({ id: "ws_logo_who", label: "Who designed it?", value: lg.who, meta: "" });
  if (lg.contractors.length) r5.push({ id: "ws_contractors", label: "Independent contractors hired", value: lg.contractors.join("; "), meta: "" });
  if (lg.agreement) {
    r5.push({ id: "ws_logo_agree", label: "Contractor agreements include work-for-hire AND copyright assignment?", value: lg.agreement, meta: "" });
  }
  secs.push({ n: 5, title: SECTIONS[5], rows: r5 });
  const cr = a.creativeWork;
  const r6: Row[] = [];
  if (cr.written) r6.push({ id: "ws_cr_written", label: "Written and course content", value: cr.written, meta: "" });
  if (cr.visual) r6.push({ id: "ws_cr_visual", label: "Visual, audio and video content", value: cr.visual, meta: "" });
  if (cr.registered) r6.push({ id: "ws_cr_reg", label: "Registered with the U.S. Copyright Office?", value: cr.registered, meta: "" });
  secs.push({ n: 6, title: SECTIONS[6], rows: r6 });
  const r7: Row[] = [];
  if (a.nextStep.priority) r7.push({ id: "ws_priority", label: "Matters most right now", value: a.nextStep.priority, meta: "" });
  if (a.nextStep.talk) r7.push({ id: "ws_talk", label: "Talk with our team about protecting it?", value: a.nextStep.talk, meta: "" });
  secs.push({ n: 7, title: SECTIONS[7], rows: r7 });
  return secs;
}

/** The submission's `answers`: one row per filled-in line, the question text from this file. */
export function worksheetIntakeAnswers(input: WorksheetInput): IntakeAnswer[] {
  const out: IntakeAnswer[] = [];
  for (const sec of worksheetSections(input.answers)) {
    for (const r of sec.rows) {
      const answer = (r.meta ? `${r.value} (${r.meta})` : r.value).slice(0, ANSWER_MAX_LENGTH);
      out.push({ id: r.id, question: `${sec.title}: ${r.label}`, answer });
    }
  }
  return out;
}

/** "yes" only for the exact choice on the page; "no" for any other answer; "unanswered" when blank. */
export function strategySessionAnswer(a: WorksheetAnswers): "yes" | "no" | "unanswered" {
  const t = a.nextStep.talk.trim();
  if (!t) return "unanswered";
  return t === STRATEGY_SESSION_YES ? "yes" : "no";
}

export function fullName(input: WorksheetInput): string {
  return `${input.contact.firstName} ${input.contact.lastName}`.trim();
}

/** The date as the attendee's copy prints it, in Eastern time (the class's clock). */
export function worksheetDate(now: Date): string {
  try {
    return now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" });
  } catch {
    return "";
  }
}

/** The worksheet as text, line for line like the page's own "Copy as text", minus the page's small print. */
export function worksheetSummary(input: WorksheetInput, now: Date): string {
  const L: string[] = [];
  L.push("YOUR IP PORTFOLIO", `${WORKSHEET_EVENT.name} · ${WORKSHEET_EVENT.date}`, WORKSHEET_EVENT.sub, "RPB Law Firm");
  L.push([`Prepared for ${fullName(input) || "you"}`, input.contact.business, worksheetDate(now)].filter(Boolean).join(" · "));
  L.push("");
  for (const sec of worksheetSections(input.answers)) {
    L.push(`${sec.n}. ${sec.title.toUpperCase()}`);
    if (!sec.rows.length) L.push("  Nothing added.");
    for (const r of sec.rows) L.push(`  ${r.label}: ${r.value}${r.meta ? ` (${r.meta})` : ""}`);
    L.push("");
  }
  L.push("This is a record of what you entered. It is not a legal assessment.");
  return L.join("\n");
}

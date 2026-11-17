import { cleanLine } from "./schema";
import {
  fullName,
  STRATEGY_SESSION_URL,
  strategySessionAnswer,
  WORKSHEET_EVENT,
  WORKSHEET_FOOTER,
  worksheetSummary,
} from "./answers";
import { attendeeHtml, PERSONAL_BOOKING_SENTENCE } from "./email-html";
import type { WorksheetInput } from "./schema";

/**
 * The two worksheet emails, as plain text. Pure: no address, key or sender is chosen here (the route takes those from
 * its env), and nothing is sent. The summary is the server's own rebuild (`worksheetSummary`).
 *
 * Words: no "free", no "discount" (the session has a price), nothing that reads as legal advice; the attendee copy
 * ends with the firm's attorney-advertising line.
 */

export type BuiltEmail = { subject: string; text: string; html?: string };

const SESSION_LINE: Record<ReturnType<typeof strategySessionAnswer>, string> = {
  yes: "WANTS A LEGAL STRATEGY SESSION: YES. They chose \"Yes, I'd like to book a Legal Strategy Session\".",
  no: "Legal Strategy Session: not right now.",
  unanswered: "Legal Strategy Session: they didn't answer this question.",
};

/** To the firm (support@ / info@): who, whether they want a session (first line), then the whole worksheet. */
export function firmNotice(input: WorksheetInput, ctx: { now: Date; filedAs: string; copySent: boolean }): BuiltEmail {
  const name = fullName(input);
  const wants = strategySessionAnswer(input.answers);
  const subject = cleanLine(`${wants === "yes" ? "[Wants a Strategy Session] " : ""}Master Class worksheet: ${name}`, 180);
  const lines = [
    SESSION_LINE[wants],
    "",
    `Name: ${name}`,
    `Email: ${input.contact.email.toLowerCase()}`,
    `Business: ${input.contact.business || "(not given)"}`,
    `Mobile: ${input.contact.mobile || "(not given)"}`,
    `Copy of the worksheet requested by email: ${input.consent.given ? "yes" : "no"}${input.consent.given ? (ctx.copySent ? " (sent)" : " (could not be sent; please forward this one)") : ""}`,
    `In Lectual: a new lead from the "${ctx.filedAs}" form.`,
    "",
    "Reply to this email to write to the attendee.",
    "",
    "----------------------------------------",
    worksheetSummary(input, ctx.now),
  ];
  return { subject, text: lines.join("\n") };
}

/** To the attendee, only when they ticked the box asking for a copy. */
export function attendeeCopy(input: WorksheetInput, ctx: { now: Date; bookingUrl?: string | null }): BuiltEmail {
  const personal = ctx.bookingUrl ?? null;
  const first = input.contact.firstName || "there";
  const lines = [
    `Hi ${first},`,
    "",
    `Thank you for joining ${WORKSHEET_EVENT.name} with RPB Law Firm. Here is a copy of Your IP Portfolio you filled in, so you can keep it.`,
    "",
    worksheetSummary(input, ctx.now),
    "",
    "When you're ready to talk with our team about protecting what you've built, you can book a Legal Strategy Session here:",
    personal ?? STRATEGY_SESSION_URL,
    ...(personal ? ["", PERSONAL_BOOKING_SENTENCE] : []),
    "",
    "RPB Law Firm",
    "",
    WORKSHEET_FOOTER,
  ];
  return { subject: `Your IP Portfolio from ${WORKSHEET_EVENT.name}`, text: lines.join("\n"), html: attendeeHtml(input, ctx.now, personal) };
}

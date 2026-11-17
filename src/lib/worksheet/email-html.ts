import {
  fullName,
  STRATEGY_SESSION_URL,
  WORKSHEET_EVENT,
  WORKSHEET_FOOTER,
  worksheetDate,
  worksheetSections,
} from "./answers";
import type { WorksheetInput } from "./schema";

/**
 * The attendee's copy as an HTML email. Pure. Table layout and inline styles only (no external CSS, no script), 600px
 * wide. EVERY value the attendee typed goes through `esc` before it enters the markup; the only href is the constant
 * STRATEGY_SESSION_URL, and the only image is the firm's real logo file on its own site.
 */

export const WORKSHEET_LOGO_URL = "https://masterclass.rpblawfirm.com/trademark/img/rpb-logo-cream.png";

const OXBLOOD = "#550E1A";
const CREAM = "#FFFDF7";
const MUTED = "#7A4A52";
const INK = "#2B1A1D";
const RULE = "#E8DFD0";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Escapes & < > " ' so attendee text can never become markup. */
export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function row(label: string, value: string, meta: string, last: boolean): string {
  return (
    `<tr><td style="padding:12px 0;${last ? "" : `border-bottom:1px solid ${RULE};`}">` +
    `<div style="font-family:${SANS};font-size:11px;letter-spacing:0.8px;text-transform:uppercase;color:${MUTED};line-height:16px;">${esc(label)}</div>` +
    `<div style="font-family:${SANS};font-size:16px;line-height:24px;color:${INK};padding-top:2px;word-break:break-word;">${esc(value)}</div>` +
    (meta ? `<div style="font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};padding-top:2px;">${esc(meta)}</div>` : "") +
    `</td></tr>`
  );
}

export const PERSONAL_BOOKING_SENTENCE = "Your booking form is already filled in with your details.";

export function attendeeHtml(input: WorksheetInput, now: Date, bookingUrl: string | null = null): string {
  const first = input.contact.firstName || "there";
  const prepared = [`Prepared for ${fullName(input) || "you"}`, input.contact.business, worksheetDate(now)].filter(Boolean).join(" · ");
  const sections = worksheetSections(input.answers)
    .map((sec) => {
      const body = sec.rows.length
        ? sec.rows.map((r, i) => row(r.label, r.value, r.meta, i === sec.rows.length - 1)).join("")
        : `<tr><td style="padding:8px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${MUTED};font-style:italic;">Nothing added.</td></tr>`;
      return (
        `<tr><td style="padding:24px 0 0 0;">` +
        `<div style="font-family:${SERIF};font-size:18px;line-height:24px;color:${OXBLOOD};font-weight:bold;padding-bottom:6px;border-bottom:2px solid ${OXBLOOD};">${sec.n} · ${esc(sec.title)}</div>` +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${body}</table>` +
        `</td></tr>`
      );
    })
    .join("");
  const url = esc(bookingUrl ?? STRATEGY_SESSION_URL);
  return (
    `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>Your IP Portfolio</title></head>` +
    `<body style="margin:0;padding:0;background:#F1ECE2;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F1ECE2;"><tr><td align="center" style="padding:16px 8px;">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:${CREAM};">` +
    // header band
    `<tr><td align="center" bgcolor="${OXBLOOD}" style="background:${OXBLOOD};padding:28px 20px;">` +
    `<img src="${WORKSHEET_LOGO_URL}" width="200" alt="RPB Law Firm" style="display:block;border:0;width:200px;max-width:100%;height:auto;margin:0 auto;"></td></tr>` +
    // title block
    `<tr><td style="padding:32px 28px 8px 28px;" align="center">` +
    `<div style="font-family:${SERIF};font-size:32px;line-height:38px;color:${OXBLOOD};font-weight:bold;">Your IP Portfolio</div>` +
    `<div style="font-family:${SANS};font-size:12px;letter-spacing:1.6px;text-transform:uppercase;color:${MUTED};padding-top:12px;line-height:18px;">${esc(WORKSHEET_EVENT.name)} · ${esc(WORKSHEET_EVENT.date)}</div>` +
    `<div style="font-family:${SERIF};font-style:italic;font-size:17px;line-height:24px;color:${INK};padding-top:6px;">${esc(WORKSHEET_EVENT.sub)}</div>` +
    `<div style="font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED};padding-top:14px;">${esc(prepared)}</div>` +
    `</td></tr>` +
    // greeting
    `<tr><td style="padding:20px 28px 0 28px;font-family:${SANS};font-size:16px;line-height:25px;color:${INK};">` +
    `<p style="margin:0 0 12px 0;">Hi ${esc(first)},</p>` +
    `<p style="margin:0;">Thank you for joining ${esc(WORKSHEET_EVENT.name)} with RPB Law Firm. Here is a copy of the worksheet you filled in, so you can keep it.</p></td></tr>` +
    // sections
    `<tr><td style="padding:0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${sections}</table></td></tr>` +
    // CTA
    `<tr><td style="padding:32px 28px 0 28px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${RULE};background:#F7F0E3;"><tr><td align="center" style="padding:26px 20px;">` +
    `<div style="font-family:${SERIF};font-size:22px;line-height:28px;color:${OXBLOOD};font-weight:bold;">Ready to protect what you&#39;ve built?</div>` +
    `<div style="font-family:${SANS};font-size:15px;line-height:23px;color:${INK};padding:10px 0 18px 0;">When you&#39;re ready to talk with our team about protecting what you&#39;ve built, book a Legal Strategy Session.</div>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td align="center" bgcolor="${OXBLOOD}" style="background:${OXBLOOD};border-radius:4px;">` +
    `<a href="${url}" style="display:inline-block;padding:14px 28px;font-family:${SANS};font-size:16px;font-weight:bold;line-height:20px;color:${CREAM};text-decoration:none;">Book your Legal Strategy Session</a></td></tr></table>` +
    `<div style="font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};padding-top:14px;word-break:break-all;">${url}</div>` +
    (bookingUrl ? `<div style="font-family:${SANS};font-size:13px;line-height:20px;color:${INK};padding-top:10px;">${esc(PERSONAL_BOOKING_SENTENCE)}</div>` : "") +
    `</td></tr></table></td></tr>` +
    // sign-off and footer
    `<tr><td style="padding:28px 28px 0 28px;font-family:${SERIF};font-size:17px;color:${OXBLOOD};font-weight:bold;">RPB Law Firm</td></tr>` +
    `<tr><td style="padding:16px 28px 32px 28px;font-family:${SANS};font-size:12px;line-height:18px;color:${MUTED};">` +
    `<p style="margin:0 0 8px 0;">${esc(WORKSHEET_FOOTER)}</p>` +
    `<p style="margin:0;">This is a record of what you entered. It is not a legal assessment.</p></td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

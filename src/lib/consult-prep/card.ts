import type { SendRecord } from "./sends";
import { parsePrepKey } from "./keys";
import {
  CONSULT_PREP_ASK_ADMIN,
  CONSULT_PREP_EMAIL_OFF,
  CONSULT_PREP_NOT_EMAILED,
  CONSULT_PREP_NOT_YET,
  CONSULT_PREP_NO_RECIPIENTS,
  CONSULT_PREP_OFF,
  CONSULT_PREP_RECIPIENTS_NOW,
  CONSULT_PREP_RECIPIENTS_UNREAD,
  CONSULT_PREP_SET_IN_TEAM,
} from "@/lib/ui/words";

/**
 * The lead page's Consult prep card, as a pure decision (no database, no clock but the one passed in). Three states per
 * read, never two: a failed read is "couldn't load", never "not prepared yet" and never "no one is set".
 */

export type Read3<T> = { status: "ok"; value: T } | { status: "unavailable" };

export type PrepMarker = { prepKey: string | null; queueItemId: string | null; at: string };
export type RecipientsView = { names: string[]; cc: string[] };

export type CardInputs = {
  /** The firm's feature list: "unreadable" is the card's own "couldn't load". */
  agents: "on" | "off" | "unreadable";
  /** The assistant's setting as far as THIS reader can know it (`unknown` for a role that can't read it). */
  setting: "on" | "off" | "unknown";
  markers: Read3<PrepMarker[]>;
  sends: Read3<SendRecord[]>;
  recipients: Read3<RecipientsView>;
  /** The deployment can send email (a key and a sender). */
  emailOn: boolean;
  adminTier: boolean;
  tz: string;
};

export type CardView =
  | { kind: "hidden" }
  | { kind: "unavailable" }
  | { kind: "prepared"; prepKey: string | null; queueItemId: string | null; lines: string[] }
  | { kind: "not-prepared"; reason: "off" | "no-recipients" | "not-yet"; lines: string[] };

const when = (iso: string, tz: string): string => {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "a time that could not be read";
  const p = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(at);
  return `${p({ month: "short" })} ${p({ day: "numeric" })}, ${p({ hour: "numeric", minute: "2-digit" })}`;
};

const list = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

const noRecipientsLines = (adminTier: boolean): string[] => [`${CONSULT_PREP_NO_RECIPIENTS} ${adminTier ? CONSULT_PREP_SET_IN_TEAM : CONSULT_PREP_ASK_ADMIN}`];

export function consultPrepCardView(input: CardInputs): CardView {
  if (input.agents === "off") return { kind: "hidden" };
  if (input.agents === "unreadable" || input.markers.status !== "ok" || input.sends.status !== "ok") return { kind: "unavailable" };

  const markers = [...input.markers.value].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const newest = markers[0];
  const recipientsEmpty = input.recipients.status === "ok" && input.recipients.value.names.length === 0;

  if (newest) {
    const mine = input.sends.value.filter((r) => newest.prepKey !== null && r.prepKey === newest.prepKey);
    // Append-only rows: the newest per kind is the truth.
    const latest = new Map<string, SendRecord>();
    for (const r of [...mine].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) latest.set(r.kind, r);
    const booked = latest.get("booked");
    let mail: string;
    if (booked && (booked.status === "sent" || booked.status === "scheduled" || booked.status === "duplicate")) {
      // Who received a PAST email is not known from today's setting (it may have changed since), so the card says "emailed" and
      // shows the setting as what it is: the current one.
      mail = "emailed";
    } else if (booked?.status === "failed") {
      mail = "the email couldn't be sent and will be tried again";
    } else if (!input.emailOn) {
      mail = `${CONSULT_PREP_NOT_EMAILED} (${CONSULT_PREP_EMAIL_OFF})`;
    } else {
      mail = CONSULT_PREP_NOT_EMAILED;
    }
    const reminders: string[] = [];
    for (const kind of ["24h", "1h"] as const) {
      const r = latest.get(kind);
      if (!r || (r.status !== "scheduled" && r.status !== "sent")) continue;
      reminders.push(`${kind === "24h" ? "a day before" : "an hour before"}${r.scheduledFor ? `, ${when(r.scheduledFor, input.tz)}` : ""}`);
    }
    const head = [`Prepared ${when(newest.at, input.tz)}`, mail, ...(reminders.length > 0 ? [`reminders: ${reminders.join("; ")}`] : [])].join(" · ");
    const lines = [head];
    if (mail === "emailed" && input.recipients.status === "ok" && input.recipients.value.names.length > 0) {
      const to = list(input.recipients.value.names);
      const cc = input.recipients.value.cc;
      lines.push(`${CONSULT_PREP_RECIPIENTS_NOW}: ${to}${cc.length > 0 ? `, cc ${cc.join(", ")}` : ""}.`);
    }
    if (recipientsEmpty) lines.push(...noRecipientsLines(input.adminTier));
    if (input.recipients.status === "unavailable") lines.push(CONSULT_PREP_RECIPIENTS_UNREAD);
    return { kind: "prepared", prepKey: newest.prepKey, queueItemId: newest.queueItemId, lines };
  }

  if (input.setting === "off") return { kind: "not-prepared", reason: "off", lines: [CONSULT_PREP_OFF] };
  if (recipientsEmpty) return { kind: "not-prepared", reason: "no-recipients", lines: noRecipientsLines(input.adminTier) };
  const lines = [CONSULT_PREP_NOT_YET];
  if (input.recipients.status === "unavailable") lines.push(CONSULT_PREP_RECIPIENTS_UNREAD);
  return { kind: "not-prepared", reason: "not-yet", lines };
}

/** The key's kind, for a caller that needs to say "a prep for a consult" or "a prep for the stage". */
export const prepKeyKind = (key: string | null): "event" | "stage" | null => (key ? (parsePrepKey(key)?.kind ?? null) : null);

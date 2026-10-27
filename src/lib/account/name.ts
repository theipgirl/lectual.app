/**
 * A person's name as the account stores it: `user_metadata.full_name` = "<first> <last>".
 * Pure, so the dialog (browser) and the action (server) share one rule.
 */

export const NAME_MAX = 80;
export const NAME_MESSAGES = {
  notSignedIn: "You are not signed in.",
  needFirst: "Enter your first name.",
  tooLong: "Names can be up to 80 characters each.",
  badChars: "Use letters only: no email addresses or special characters.",
  invalid: "We couldn't read that name.",
  notSaved: "We couldn't save your name. Try again.",
} as const;

export type NameInput = { first: string; last: string };
export type NameCheck = { ok: true; first: string; last: string; fullName: string } | { ok: false; error: string };

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Splits a stored full name for the dialog: the first word is the first name, the rest the last. */
export function splitFullName(value: unknown): NameInput {
  if (typeof value !== "string") return { first: "", last: "" };
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || value.includes("@")) return { first: "", last: "" };
  return { first: words[0], last: words.slice(1).join(" ") };
}

export function validateName(input: unknown): NameCheck {
  if (!input || typeof input !== "object") return { ok: false, error: NAME_MESSAGES.invalid };
  const { first, last } = input as Record<string, unknown>;
  if (typeof first !== "string" || (last !== undefined && typeof last !== "string")) return { ok: false, error: NAME_MESSAGES.invalid };
  const f = first.trim().replace(/\s+/g, " ");
  const l = (typeof last === "string" ? last : "").trim().replace(/\s+/g, " ");
  if (!f) return { ok: false, error: NAME_MESSAGES.needFirst };
  if (f.length > NAME_MAX || l.length > NAME_MAX) return { ok: false, error: NAME_MESSAGES.tooLong };
  if (CONTROL.test(f) || CONTROL.test(l) || f.includes("@") || l.includes("@")) return { ok: false, error: NAME_MESSAGES.badChars };
  return { ok: true, first: f, last: l, fullName: l ? `${f} ${l}` : f };
}

export const SHOW_NAME_EVENT = "lectual:show-name";

type Dispatcher = { dispatchEvent: (event: Event) => boolean };
/** Asks the one "Your name" dialog in the dashboard layout to open. `opener` is where focus returns. */
export function requestNameDialog(target: Dispatcher, opener: { focus?: () => void; isConnected?: boolean } | null): void {
  target.dispatchEvent(new CustomEvent(SHOW_NAME_EVENT, { detail: { opener } }));
}

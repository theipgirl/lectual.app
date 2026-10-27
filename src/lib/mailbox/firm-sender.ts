/**
 * Whether a stored message was really sent BY the firm. Pure.
 *
 * The sync files a message by the mailbox it was read from. Rayn's post-consult email reaches the
 * firm's shared info@ inbox only as a cc from trademark@, so it is stored as `email_received` even
 * though the firm wrote it. A message whose sender is one of the firm's own addresses, or sits on
 * the domain of one of the firm's mailbox connections, counts as firm-sent for the milestone
 * classifier and the Stage Keeper. Only the sender address and the subject are ever looked at,
 * never a body, and nothing here stores or logs an address.
 *
 * A mailbox on a public webmail domain (a firm that connected a gmail.com address) contributes
 * its exact address only: its domain would make every Gmail correspondent "the firm".
 */

const PUBLIC_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "zoho.com",
]);

export type FirmSenders = { addresses: ReadonlySet<string>; domains: ReadonlySet<string> };

export const NO_FIRM_SENDERS: FirmSenders = { addresses: new Set(), domains: new Set() };

function addressOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const match = value.match(/<([^<>]+)>/);
  const raw = (match ? match[1] : value).trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  return at > 0 && at < raw.length - 1 && !/\s/.test(raw) ? raw : null;
}

/** The firm's own addresses and domains, from the email addresses of its connected mailboxes. */
export function firmSendersFrom(mailboxEmails: ReadonlyArray<string | null | undefined>): FirmSenders {
  const addresses = new Set<string>();
  const domains = new Set<string>();
  for (const email of mailboxEmails) {
    const address = addressOf(email);
    if (!address) continue;
    addresses.add(address);
    const domain = address.slice(address.lastIndexOf("@") + 1);
    if (!PUBLIC_MAIL_DOMAINS.has(domain)) domains.add(domain);
  }
  return { addresses, domains };
}

/** True when the sender address is one of the firm's own. A missing or malformed sender is never the firm. */
export function isFirmSender(from: string | null | undefined, senders: FirmSenders): boolean {
  const address = addressOf(from);
  if (!address) return false;
  if (senders.addresses.has(address)) return true;
  return senders.domains.has(address.slice(address.lastIndexOf("@") + 1));
}

/** The direction to classify with: inbound mail from the firm itself is outbound. */
export function effectiveDirection(
  stored: "inbound" | "outbound",
  from: string | null | undefined,
  senders: FirmSenders,
): "inbound" | "outbound" {
  return stored === "inbound" && isFirmSender(from, senders) ? "outbound" : stored;
}

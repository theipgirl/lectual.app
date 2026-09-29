import { isPlaceholderEmail, participantsOf, type ThreadMessage } from "@/lib/intake/email-match";

/**
 * Which matter is this message about, via the matter's CONTACTS?
 *
 * The lead matcher (src/lib/intake/email-match.ts) covers people who haven't
 * signed yet. Once someone is a client their mail is about a MATTER, and a
 * matter knows its people through crm_matter_contact (0048). This adds that
 * second route, with the lead matcher's rule: refuse rather than guess.
 *
 *   1. Only an exact ADDRESS match counts. Names and marks are too weak to put
 *      a client's email on a matter's timeline on their own.
 *   2. The matched contacts' matters are collected. One matter → that matter.
 *   3. Several (a client with three marks) → the one whose mark appears in the
 *      subject, if exactly one does. Otherwise no match: filing mail on the
 *      wrong matter makes the right one look neglected, invisibly.
 *
 * Pure: no database, no network. The sync loads the rows and calls this.
 */

export type MatterContact = { contactId: string; email: string | null };
export type MatterLink = { contactId: string; matterId: string; markText: string | null };

function fold(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export type MatterMatch = { matterId: string; basis: "contact-email" | "contact-email+mark" } | null;

export function matchMessageToMatter(
  message: ThreadMessage,
  contacts: readonly MatterContact[],
  links: readonly MatterLink[],
): MatterMatch {
  const addresses = new Set(
    participantsOf(message)
      .map((p) => p.address?.trim().toLowerCase())
      .filter((a): a is string => !!a),
  );
  // The connected mailbox itself is never evidence about a client.
  addresses.delete(message.mailbox.trim().toLowerCase());

  const contactIds = new Set(
    contacts
      .filter((c) => {
        const email = c.email?.trim().toLowerCase() ?? "";
        return email && !isPlaceholderEmail(email) && addresses.has(email);
      })
      .map((c) => c.contactId),
  );
  if (contactIds.size === 0) return null;

  const matters = new Map<string, string | null>();
  for (const link of links) {
    if (contactIds.has(link.contactId)) matters.set(link.matterId, link.markText);
  }
  if (matters.size === 0) return null;
  if (matters.size === 1) return { matterId: [...matters.keys()][0], basis: "contact-email" };

  const subject = fold(message.subject ?? "");
  const byMark = [...matters.entries()].filter(([, mark]) => {
    const m = fold(mark ?? "");
    return m.length >= 3 && subject.includes(m);
  });
  return byMark.length === 1 ? { matterId: byMark[0][0], basis: "contact-email+mark" } : null;
}

import { cleanEmail, type Attendee } from "./types";

/**
 * Which lead or matter is this meeting about? Decided from attendee EMAIL
 * addresses only, against THAT firm's own leads and contacts (the caller loads
 * them fenced on the meeting's org_id). Names never match anything: two
 * people share a name far more often than an address.
 *
 * THE RULE (docs/meetings-setup.md):
 *   · The firm's own side of the call (the Fathom recorder, the Zoom host) is
 *     never matched, so an attorney's address can't pull every call onto the
 *     one lead that happens to share it.
 *   · A lead is linked automatically only when EXACTLY ONE lead in the firm
 *     has any attendee's address. Two or more → the first is offered as a
 *     suggestion and staff decide.
 *   · A matter is linked the same way, from its contacts' addresses plus the
 *     matters opened from the matched lead(s): exactly one → linked; more →
 *     suggested.
 *   · Nothing found → the meeting stays unlinked.
 *   · The importer applies a link only to a meeting nobody has linked yet;
 *     it never overrides staff.
 */

export type MatchContext = {
  leads: { id: string; email: string | null }[];
  contacts: { id: string; email: string | null }[];
  matterContacts: { contactId: string; matterId: string }[];
  matters: { id: string; leadId: string | null }[];
};

export type LinkDecision = {
  leadId: string | null;
  matterId: string | null;
  suggestedLeadId: string | null;
  suggestedMatterId: string | null;
};

export const NO_LINK: LinkDecision = { leadId: null, matterId: null, suggestedLeadId: null, suggestedMatterId: null };

export function decideLinks(attendees: Attendee[], hostEmails: string[], ctx: MatchContext): LinkDecision {
  const hosts = new Set(hostEmails.map((e) => cleanEmail(e)).filter((e): e is string => !!e));
  const emails = new Set(
    attendees.map((a) => cleanEmail(a.email)).filter((e): e is string => !!e && !hosts.has(e)),
  );
  if (emails.size === 0) return NO_LINK;

  const leadIds = [...new Set(ctx.leads.filter((l) => { const e = cleanEmail(l.email); return !!e && emails.has(e); }).map((l) => l.id))].sort();
  const contactIds = new Set(ctx.contacts.filter((c) => { const e = cleanEmail(c.email); return !!e && emails.has(e); }).map((c) => c.id));
  const leadSet = new Set(leadIds);
  const matterIds = [
    ...new Set([
      ...ctx.matterContacts.filter((mc) => contactIds.has(mc.contactId)).map((mc) => mc.matterId),
      ...ctx.matters.filter((m) => m.leadId && leadSet.has(m.leadId)).map((m) => m.id),
    ]),
  ].sort();

  return {
    leadId: leadIds.length === 1 ? leadIds[0] : null,
    suggestedLeadId: leadIds.length > 1 ? leadIds[0] : null,
    matterId: matterIds.length === 1 ? matterIds[0] : null,
    suggestedMatterId: matterIds.length > 1 ? matterIds[0] : null,
  };
}

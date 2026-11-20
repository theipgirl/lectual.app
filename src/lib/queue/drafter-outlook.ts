import type { MyOutlookDraftAccess } from "@/lib/queue/draft-handoff";
import {
  DRAFTER_OUTLOOK_READY,
  MAKE_DRAFT_NEEDS_PERMISSION,
  MAKE_DRAFT_NO_OUTLOOK,
  MAKE_DRAFT_NOT_OUTLOOK,
  MAKE_DRAFT_OUTLOOK_UNREAD,
  onlyCanSeeThis,
} from "@/lib/ui/words";

/**
 * The drafter's Outlook as Settings -> Approvals can say it (Sprint 4). Only the viewer's OWN connection can be read
 * (a colleague's personal Outlook is invisible by RLS), so for anyone else it is "Only <first name> can see this".
 * Pure. A failed read is "couldn't check", never "not connected".
 */
export function drafterOutlookLine(args: { drafterName: string; isSelf: boolean; access: MyOutlookDraftAccess | null }): string {
  if (!args.isSelf) {
    const first = args.drafterName.trim().split(/\s+/)[0] || null;
    return `${onlyCanSeeThis(first && !first.includes("@") ? first : null)}.`;
  }
  switch (args.access) {
    case "ready":
      return DRAFTER_OUTLOOK_READY;
    case "no-mailbox":
      return MAKE_DRAFT_NO_OUTLOOK;
    case "not-outlook":
      return MAKE_DRAFT_NOT_OUTLOOK;
    case "needs-permission":
      return MAKE_DRAFT_NEEDS_PERMISSION;
    default:
      return MAKE_DRAFT_OUTLOOK_UNREAD;
  }
}

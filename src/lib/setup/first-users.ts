import { roleLabel } from "@/lib/auth/roles";
import { firstNameOf } from "@/lib/review/last-changed";
import type { ColleagueMailbox, ColleagueMailboxes } from "@/lib/mailbox/colleague-rows";
import {
  TEAM_ACCOUNTS_DRAFTS,
  TEAM_ACCOUNTS_MAILBOXES_OFF,
  TEAM_ACCOUNTS_OUTLOOK,
  TEAMMATE,
  onlyCanSeeThis,
} from "@/lib/ui/words";
import { canSeeSetup } from "./roles";
import { INTEGRATIONS_PATH, MODULES_PATH } from "./routes";
import type { Reading } from "./types";

/**
 * "Team accounts" and the "Your setup" line, computed from readings. Pure: nothing is stored, no name, email or role is
 * fixed in code (people come from the member directory), and each item is done / to do / couldn't check, with one more
 * word for a mailbox only its owner can see ("private"). A failed read is "couldn't check", never done and never to do.
 *
 * "Signed in at least once" is left out on purpose: the member directory (`org_member_directory()`) has no sign-in field,
 * and reading one would need the service role, which dashboard code may not use.
 */
export type PersonIn = { userId: string; name: string | null; role: string };

/** One of the viewer's OWN visible mailbox connections. `canDraft` is decided by the reader from the stored scopes; the scope list itself never gets here. */
export type OwnConnection = {
  id: string;
  userId: string | null;
  scope: "personal" | "firm";
  provider: "google" | "microsoft";
  status: string;
  email: string;
  canDraft: boolean;
};

export type AccountItemId = "outlook" | "drafts";
export type AccountItemStatus = "done" | "to-do" | "couldnt-check" | "private";
export type AccountItem = { id: AccountItemId; label: string; status: AccountItemStatus; text: string; href?: string };
export type AccountRow = { userId: string; name: string; roleLabel: string; isYou: boolean; items: AccountItem[] };
export type FirstUsers = { status: "ok"; rows: AccountRow[] } | { status: "couldnt-check" };

export type FirstUsersInput = {
  viewerId: string;
  viewerRole: string;
  members: Reading<PersonIn[]>;
  modules: Reading<string[]>;
  own: Reading<OwnConnection[]>;
  colleagues: ColleagueMailboxes;
};

const LABELS: Record<AccountItemId, string> = { outlook: TEAM_ACCOUNTS_OUTLOOK, drafts: TEAM_ACCOUNTS_DRAFTS };

function item(id: AccountItemId, status: AccountItemStatus, text: string, href?: string): AccountItem {
  return { id, label: LABELS[id], status, text, ...(href ? { href } : {}) };
}

const CANT = "Couldn't check this just now. Try again in a minute.";
const pair = (status: AccountItemStatus, text: string, href?: string): AccountItem[] => [item("outlook", status, text, href), item("drafts", status, text, href)];

/** What a connection's status says, in words. An unknown status is never guessed. */
function statusWords(status: string): string | null {
  switch (status) {
    case "reauth":
      return "needs reconnecting";
    case "error":
      return "has a problem and needs reconnecting";
    case "revoked":
      return "was disconnected";
    default:
      return null;
  }
}

function moduleGate(modules: Reading<string[]>, viewerRole: string): AccountItem[] | null {
  if (!modules.ok) return pair("couldnt-check", CANT);
  if (!modules.value.includes("mailbox")) return pair("to-do", TEAM_ACCOUNTS_MAILBOXES_OFF, canSeeSetup(viewerRole) ? MODULES_PATH : undefined);
  return null;
}

/** The viewer's own two items, from their own scoped read of their own connections. */
export function ownItems(args: { viewerId: string; viewerRole: string; modules: Reading<string[]>; own: Reading<OwnConnection[]> }): AccountItem[] {
  const gate = moduleGate(args.modules, args.viewerRole);
  if (gate) return gate;
  if (!args.own.ok) return pair("couldnt-check", CANT);
  const mine = args.own.value.filter((c) => c.scope === "personal" && c.userId === args.viewerId);
  const outlook = mine.filter((c) => c.provider === "microsoft");
  const active = outlook.find((c) => c.status === "active");
  if (!active) {
    const broken = outlook.find((c) => statusWords(c.status));
    const text = broken
      ? `Your Outlook mailbox (${broken.email}) ${statusWords(broken.status)}.`
      : mine.length > 0
        ? "Only a Gmail mailbox is connected. Connect Outlook."
        : "No Outlook mailbox connected yet.";
    return [item("outlook", "to-do", text, INTEGRATIONS_PATH), item("drafts", "to-do", "Connect Outlook first.", INTEGRATIONS_PATH)];
  }
  const drafts = active.canDraft
    ? item("drafts", "done", "Approved drafts can be saved to your Outlook Drafts.")
    : item("drafts", "to-do", "Reconnect Outlook and allow it to save drafts.", INTEGRATIONS_PATH);
  return [item("outlook", "done", `Connected as ${active.email}.`), drafts];
}

function colleagueItems(p: PersonIn, input: FirstUsersInput): AccountItem[] {
  const first = firstNameOf(p.name);
  const hidden = () => pair("private", onlyCanSeeThis(first));
  const c = input.colleagues;
  if (c.kind === "not-asked" || c.kind === "not-switched-on") return hidden();
  if (c.kind === "unavailable") return pair("couldnt-check", CANT);

  // A sanity check against a function that answers with nothing for the wrong reason (no active firm): the owner's own
  // visible personal mailbox must be in the answer too. If it is not, the answer is not trusted and nothing reads "not connected".
  if (input.own.ok) {
    const mineIds = input.own.value.filter((x) => x.scope === "personal" && x.userId === input.viewerId).map((x) => x.id);
    if (mineIds.length > 0 && !c.rows.some((r) => mineIds.includes(r.id))) return pair("couldnt-check", CANT);
  }

  const theirs: ColleagueMailbox[] = c.rows.filter((r) => r.scope === "personal" && r.userId === p.userId);
  const outlook = theirs.filter((r) => r.provider === "microsoft");
  const active = outlook.find((r) => r.status === "active");
  if (active) return [item("outlook", "done", `Connected as ${active.email}.`), item("drafts", "private", onlyCanSeeThis(first))];
  const broken = outlook.find((r) => statusWords(r.status));
  if (broken) return [item("outlook", "to-do", `Their Outlook mailbox (${broken.email}) ${statusWords(broken.status)}.`), item("drafts", "to-do", "Connect Outlook first.")];
  const text = theirs.length > 0 ? "Only a Gmail mailbox is connected." : "No Outlook mailbox connected yet.";
  return [item("outlook", "to-do", text), item("drafts", "to-do", "Connect Outlook first.")];
}

export function firstUsers(input: FirstUsersInput): FirstUsers {
  if (!input.members.ok) return { status: "couldnt-check" };
  const gate = moduleGate(input.modules, input.viewerRole);
  const rows = input.members.value.map<AccountRow>((p) => {
    const isYou = p.userId === input.viewerId;
    const items = gate ?? (isYou ? ownItems(input) : colleagueItems(p, input));
    return { userId: p.userId, name: p.name?.trim() || TEAMMATE, roleLabel: roleLabel(p.role), isYou, items };
  });
  return { status: "ok", rows };
}

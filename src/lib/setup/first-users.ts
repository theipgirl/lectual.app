import { roleLabel } from "@/lib/auth/roles";
import { firstNameOf } from "@/lib/review/last-changed";
import type { ColleagueMailbox, ColleagueMailboxes } from "@/lib/mailbox/colleague-rows";
import {
  TEAM_ACCOUNTS_DRAFTS,
  notReadyPlural,
  TEAM_ACCOUNTS_OUTLOOK,
  TEAMMATE,
  onlyCanSeeThis,
} from "@/lib/ui/words";
import { INTEGRATIONS_PATH } from "./routes";
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
/** "lectual" = a feature only Lectual can switch on (Mailboxes off): not the firm's to do, so never "to do" and no link. */
export type AccountItemStatus = "done" | "to-do" | "couldnt-check" | "private" | "lectual";
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

function moduleGate(modules: Reading<string[]>): AccountItem[] | null {
  if (!modules.ok) return pair("couldnt-check", CANT);
  if (!modules.value.includes("mailbox")) return pair("lectual", notReadyPlural("Mailboxes"));
  return null;
}

/** The viewer's own two items, from their own scoped read of their own connections. */
export function ownItems(args: { viewerId: string; viewerRole: string; modules: Reading<string[]>; own: Reading<OwnConnection[]> }): AccountItem[] {
  const gate = moduleGate(args.modules);
  if (gate) return gate;
  if (!args.own.ok) return pair("couldnt-check", CANT);
  const mine = args.own.value.filter((c) => c.scope === "personal" && c.userId === args.viewerId);
  const outlook = mine.filter((c) => c.provider === "microsoft");
  const active = outlook.find((c) => c.status === "active");
  if (!active) {
    // A connection whose status is not one we know is never guessed at.
    const unknown = outlook.find((c) => !statusWords(c.status));
    if (unknown) return pair("couldnt-check", CANT);
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

  // The answer is trusted only when it is checked against EVERY connection the caller can see themselves (firm-scope as well as personal):
  // each must be in it. A caller whose own read failed cannot check it, so nothing reads "not connected". An empty answer is
  // trusted only when the caller's own read is empty too (the function answered, and there is nothing it could have left out).
  if (!input.own.ok) return pair("couldnt-check", CANT);
  if (c.rows.length === 0 && input.own.value.length > 0) return pair("couldnt-check", CANT);
  const answered = new Set(c.rows.map((r) => r.id));
  if (!input.own.value.every((x) => answered.has(x.id))) return pair("couldnt-check", CANT);

  const theirs: ColleagueMailbox[] = c.rows.filter((r) => r.scope === "personal" && r.userId === p.userId);
  const outlook = theirs.filter((r) => r.provider === "microsoft");
  const active = outlook.find((r) => r.status === "active");
  if (active) return [item("outlook", "done", `Connected as ${active.email}.`), item("drafts", "private", onlyCanSeeThis(first))];
  const broken = outlook.find((r) => statusWords(r.status));
  if (broken) return [item("outlook", "to-do", `Their Outlook mailbox (${broken.email}) ${statusWords(broken.status)}.`), item("drafts", "to-do", "Connect Outlook first.")];
  const text = theirs.length > 0 ? "Only a Gmail mailbox is connected." : "No Outlook mailbox connected yet.";
  return [item("outlook", "to-do", text), item("drafts", "to-do", "Connect Outlook first.")];
}

/** A display name; an address is never used as one. */
function safeName(name: string | null): string {
  const n = name?.trim() ?? "";
  return n && !n.includes("@") ? n : TEAMMATE;
}

export function firstUsers(input: FirstUsersInput): FirstUsers {
  if (!input.members.ok) return { status: "couldnt-check" };
  const gate = moduleGate(input.modules);
  const rows = input.members.value.map<AccountRow>((p) => {
    const isYou = p.userId === input.viewerId;
    const items = gate ?? (isYou ? ownItems(input) : colleagueItems(p, input));
    return { userId: p.userId, name: safeName(p.name), roleLabel: roleLabel(p.role), isYou, items };
  });
  return { status: "ok", rows };
}

import { isOfferablePackage } from "@/lib/intake-forms/packages";
import { ASSISTANTS_NAME, notReadyPlural } from "@/lib/ui/words";
import { INTEGRATIONS_PATH, MODULES_PATH } from "./routes";
import type { Reading, SetupChecklist, SetupItem, SetupState } from "./types";

type Verdict = Pick<SetupItem, "status" | "why"> & { href?: string };

const done = (why: string): Verdict => ({ status: "done", why });
const notYet = (why: string, href?: string): Verdict => ({ status: "to-do", why, href });
const unchecked = (what: string): Verdict => ({
  status: "couldnt-check",
  why: `We couldn't check ${what} just now. Try again in a minute.`,
});

const RECONNECT = "needs reconnecting";

/** The module gate shared by the Outlook and agent items: unreadable list, module off, or on. */
function moduleGate(modules: Reading<string[]>, mod: string, what: string, off: string): Verdict | null {
  if (!modules.ok) return unchecked(what);
  if (!modules.value.includes(mod)) return notYet(off, MODULES_PATH);
  return null;
}

function profileVerdict(r: SetupState["profile"]): Verdict {
  if (!r.ok) return unchecked("your firm profile");
  const name = r.value?.displayName?.trim();
  const signature = r.value?.emailSignature?.trim();
  if (name && signature) return done("Your firm name and email sign-off are saved.");
  if (!name && !signature) return notYet("Add your firm's display name and the sign-off that goes on client drafts.");
  if (!name) return notYet("Add your firm's display name.");
  return notYet("Add the email sign-off that goes on client drafts.");
}

function teamVerdict(r: SetupState["members"]): Verdict {
  if (!r.ok) return unchecked("your team");
  if (r.value.count > 1) return done(`${r.value.count} people are on your team.`);
  return notYet("Only you are on the team so far. Invite your colleagues.");
}

function outlookVerdict(modules: SetupState["modules"], r: SetupState["mailboxes"]): Verdict {
  const gate = moduleGate(
    modules,
    "mailbox",
    "whether mailboxes are switched on",
    "Mailboxes aren't switched on for your firm yet. Lectual turns them on.",
  );
  if (gate) return gate;
  if (!r.ok) return unchecked("your mailbox connections");
  const outlook = r.value.filter((c) => c.provider === "microsoft");
  if (outlook.some((c) => c.status === "active")) return done("An Outlook mailbox is connected, yours or a shared one.");
  if (outlook.length > 0) return notYet(`Your Outlook mailbox ${RECONNECT}.`, INTEGRATIONS_PATH);
  if (r.value.length > 0) return notYet("Only a Gmail mailbox is connected. Connect Outlook, yours or a shared one.", INTEGRATIONS_PATH);
  return notYet("No Outlook mailbox connected yet, yours or a shared one.", INTEGRATIONS_PATH);
}

function lawmaticsVerdict(r: SetupState["lawmatics"]): Verdict {
  if (!r.ok) return unchecked("your Lawmatics connection");
  if (!r.value) return notYet("Not connected yet. Add your Lawmatics token to bring over your contacts and matters.");
  if (r.value.status === "active") return done("Lawmatics is connected.");
  return notYet(`Lawmatics stopped accepting your token. It ${RECONNECT}.`);
}

function meetingsVerdict(r: SetupState["meetings"]): Verdict {
  if (!r.ok) return unchecked("your meeting connections");
  if (r.value.some((c) => c.status === "active")) return done("A meeting source (Fathom or Zoom) is connected.");
  if (r.value.length > 0) return notYet(`Your meeting source ${RECONNECT}.`);
  return notYet("Not connected yet. Connect Fathom or Zoom to bring in your consult recordings.");
}

function lawpayVerdict(r: SetupState["lawpay"]): Verdict {
  if (!r.ok) return unchecked("your LawPay connection");
  if (!r.value) return notYet("Not connected yet. Sign in to your LawPay account so clients can pay by card at signing.");
  if (r.value.status === "active") return done("LawPay is connected.");
  return notYet(`LawPay stopped accepting your connection. It ${RECONNECT}.`);
}

function agentsVerdict(modules: SetupState["modules"], r: SetupState["agents"]): Verdict {
  const gate = moduleGate(
    modules,
    "agents",
    "whether assistants are switched on",
    notReadyPlural(ASSISTANTS_NAME),
  );
  if (gate) return gate;
  if (!r.ok) return unchecked("your assistant settings");
  const on = r.value.filter((a) => a.enabled).length;
  if (on > 0) return done(on === 1 ? "One assistant is on." : `${on} assistants are on.`);
  return notYet("No assistant is switched on. Turn on at least one.");
}

function intakeVerdict(r: SetupState["intakeForms"]): Verdict {
  if (!r.ok) return unchecked("your intake forms");
  if (r.value.some((f) => f.status === "live")) return done("An intake form is live.");
  if (r.value.length > 0) return notYet("Your intake form isn't live yet. Publish it to start taking leads.");
  return notYet("No intake form yet. Create one and publish it.");
}

function packagesVerdict(r: SetupState["services"]): Verdict {
  if (!r.ok) return unchecked("your service library");
  if (r.value.some(isOfferablePackage)) {
    return done("Your service library has a fee package.");
  }
  return notYet("No fee package saved. Add at least one legal-fee item to your service library.");
}

function aiVerdict(configured: boolean): Verdict {
  return configured ? done("AI is switched on for your firm.") : notYet("AI isn't switched on for your firm yet. Lectual will turn it on.");
}

type Spec = { id: SetupItem["id"]; label: string; href: string; verdict: (s: SetupState) => Verdict };

const SPECS: Spec[] = [
  { id: "profile", label: "Firm profile and sign-off", href: "/dashboard/settings/firm/", verdict: (s) => profileVerdict(s.profile) },
  { id: "team", label: "Team invited", href: "/dashboard/settings/team/", verdict: (s) => teamVerdict(s.members) },
  { id: "outlook", label: "Outlook mailbox connected", href: INTEGRATIONS_PATH, verdict: (s) => outlookVerdict(s.modules, s.mailboxes) },
  { id: "lawmatics", label: "Lawmatics connected", href: "/dashboard/settings/integrations/lawmatics/", verdict: (s) => lawmaticsVerdict(s.lawmatics) },
  { id: "meetings", label: "Fathom or Zoom connected", href: "/dashboard/settings/integrations/meetings/", verdict: (s) => meetingsVerdict(s.meetings) },
  { id: "lawpay", label: "LawPay connected", href: "/dashboard/settings/integrations/lawpay/", verdict: (s) => lawpayVerdict(s.lawpay) },
  { id: "agents", label: "At least one assistant on", href: "/dashboard/agents/", verdict: (s) => agentsVerdict(s.modules, s.agents) },
  { id: "intake", label: "An intake form live", href: "/dashboard/forms/", verdict: (s) => intakeVerdict(s.intakeForms) },
  { id: "packages", label: "Packages saved", href: "/dashboard/settings/services/", verdict: (s) => packagesVerdict(s.services) },
  { id: "ai", label: "AI configured", href: "/dashboard/copilot/", verdict: (s) => aiVerdict(s.aiConfigured) },
];

/**
 * The ten-item setup checklist, computed from readings of real state. Pure.
 *
 * `done` needs every fact the item depends on to have been READ and to say so.
 * A fact that could not be read gives `couldnt-check`, never `done` and never
 * `to-do`: a failed read must not tell a firm it has finished, or that it
 * hasn't started. The one item that cannot fail is "AI configured" (an
 * environment variable). A module that is off is `to-do` (with a link to
 * Modules), not hidden, so the count is always "N of 10".
 */
export function setupChecklist(state: SetupState): SetupChecklist {
  const items: SetupItem[] = SPECS.map((spec) => {
    const v = spec.verdict(state);
    return { id: spec.id, label: spec.label, status: v.status, why: v.why, href: v.href ?? spec.href };
  });
  const doneCount = items.filter((i) => i.status === "done").length;
  return { items, doneCount, total: items.length, complete: doneCount === items.length };
}

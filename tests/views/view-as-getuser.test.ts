import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * View as: every `auth.getUser()` call is classified. Most stamp a write (refused in a preview anyway) or authorize an
 * action; the ones that decide whose items to SHOW either use the viewer or show the private sentence. A new call fails
 * until it is listed.
 */
const ROOT = path.resolve(__dirname, "../..");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

type Kind = "stamp" | "authorize" | "session" | "private" | "viewer";
const CLASSIFIED: Record<string, { kind: Kind; why: string }> = {
  "src/app/dashboard/quotes/[id]/actions.ts": { kind: "stamp", why: "an action" },
  "src/lib/account/actions.ts": { kind: "stamp", why: "updateUser (refused by the net in a preview)" },
  "src/lib/account/deal-times-actions.ts": { kind: "stamp", why: "updateUser" },
  "src/lib/account/view-actions.ts": { kind: "stamp", why: "updateUser" },
  "src/lib/automation/drips.ts": { kind: "stamp", why: "enrol / stop writes" },
  "src/lib/brain/claims.ts": { kind: "stamp", why: "Firm notes writes" },
  "src/lib/brain/entries.ts": { kind: "stamp", why: "Firm notes writes" },
  "src/lib/campaigns/stop-staff.ts": { kind: "stamp", why: "a sequence stop" },
  "src/lib/deal/my-times.ts": { kind: "authorize", why: "the deck's Later action (an action); a preview uses the firm's default deal times" },
  "src/lib/files/guard.ts": { kind: "authorize", why: "file action and download gates" },
  "src/lib/firm/session.ts": { kind: "session", why: "the session itself" },
  "src/lib/intake-forms/event-export-csv.ts": { kind: "authorize", why: "the CSV route's gate" },
  "src/lib/intake-forms/export-csv.ts": { kind: "authorize", why: "the CSV route's gate" },
  "src/lib/intake-forms/requests.ts": { kind: "stamp", why: "intake request writes" },
  "src/lib/intake-forms/store.ts": { kind: "stamp", why: "form writes" },
  "src/lib/intake/leads.ts": { kind: "stamp", why: "lane / temperature writes" },
  "src/lib/loe/page-load.ts": { kind: "viewer", why: "who is an approver on the Engagement letter page: the viewer's id while previewing (no getUser then)" },
  "src/lib/mailbox/my-mailbox.ts": { kind: "private", why: "the caller's OWN mailbox (myOwnOutlookRow): never asked in a preview; the pages show VIEW_AS_PRIVATE_OUTLOOK" },
  "src/lib/matters/activity.ts": { kind: "stamp", why: "a timeline write" },
  "src/lib/matters/deadlines.ts": { kind: "stamp", why: "deadline writes" },
  "src/lib/matters/stages.ts": { kind: "stamp", why: "a stage move" },
  "src/lib/matters/team-status-note.ts": { kind: "stamp", why: "a note write" },
  "src/lib/notifications/approval.ts": { kind: "stamp", why: "a notice write" },
  "src/lib/notifications/core.ts": { kind: "private", why: "the bell's own reads (user_id = auth.uid()): the layout and the notifications page never call them in a preview" },
  "src/lib/onboarding/actions.ts": { kind: "stamp", why: "updateUser" },
  "src/lib/onboarding/hub-actions.ts": { kind: "stamp", why: "updateUser, and the allowlisted record picker (a signed-in check only)" },
  "src/lib/org/profile.ts": { kind: "stamp", why: "a profile save" },
  "src/lib/pipeline/consult-outcome.ts": { kind: "stamp", why: "an outcome write" },
  "src/lib/pipeline/leads.ts": { kind: "stamp", why: "lead writes" },
  "src/lib/pipeline/notes.ts": { kind: "stamp", why: "a note write" },
  "src/lib/proposals/staff-view.ts": { kind: "authorize", why: "whether a staff member opened the public page (no view event written for staff)" },
  "src/lib/proposals/store.ts": { kind: "stamp", why: "proposal writes and the approver check behind isCurrentUserApprover (an action's)" },
  "src/lib/queue/review-core.ts": { kind: "stamp", why: "approve / reject" },
  "src/lib/quotes/store.ts": { kind: "stamp", why: "quote writes" },
  "src/lib/reconcile/authorize.ts": { kind: "authorize", why: "the reconcile actions' gate" },
  "src/lib/settings/admin.ts": { kind: "stamp", why: "member writes" },
  "src/lib/settings/members.ts": { kind: "stamp", why: "member writes" },
  "src/lib/time/entries.ts": { kind: "stamp", why: "time writes; the running chip takes the viewer's id" },
  "src/proxy.ts": { kind: "session", why: "the session refresh" },
};

describe("every auth.getUser() call is classified", () => {
  const files = walk(path.join(ROOT, "src")).filter((f) => /auth\.getUser\(\)/.test(readFileSync(f, "utf8")));

  it("the list of callers equals the classified list", () => {
    expect(files.map((f) => path.relative(ROOT, f).split(path.sep).join("/")).sort()).toEqual(Object.keys(CLASSIFIED).sort());
  });

  it("the drawn loaders that used getUser for 'whose' now read the viewer", () => {
    const pageLoad = readFileSync(path.join(ROOT, "src/lib/loe/page-load.ts"), "utf8");
    expect(pageLoad).toMatch(/previewing \? null : db\.auth\.getUser\(\)/);
    expect(pageLoad).toMatch(/userId = previewing \? previewing\.userId/);
    const entries = readFileSync(path.join(ROOT, "src/lib/time/entries.ts"), "utf8");
    expect(entries).toMatch(/export async function runningForMe\(forUserId\?: string\)/);
  });
});

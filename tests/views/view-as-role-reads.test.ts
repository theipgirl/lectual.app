import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isEntryFile } from "./_entry";

/**
 * View as, "Every role read is switched for drawing" (spec "The seam"). The session role helpers stay SESSION reads: actions
 * use them to authorize, and actions are refused in a preview. Everything that decides what is DRAWN reads the viewer
 * (resolveViewSession / viewerRole / viewerHasRole / isViewerApprover / resolveViewer). This pins every call of a session
 * helper outside the entry points ("use server" files and route.ts, which are always authorize -> session), so a new call
 * fails until it is classified here.
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
const HELPERS = [
  "currentRole",
  "callerHasRole",
  "resolveCurrentRole",
  "resolveQueueRole",
  "requireMatterWriteRole",
  "requireQuoteWriteRole",
  "requireAutomationAdminRole",
  "requireAutomationStaffRole",
  "requireQuoteLibraryAdminRole",
  "requireLeadWriteRole",
  "isCurrentUserApprover",
  "resolveFirmSession",
];
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

type Counts = Record<string, number>;
function inventory(): Record<string, Counts> {
  const out: Record<string, Counts> = {};
  for (const f of walk(path.join(ROOT, "src"))) {
    const raw = readFileSync(f, "utf8");
    if (isEntryFile(f)) continue;
    const src = strip(raw);
    const c: Counts = {};
    for (const h of HELPERS) {
      const calls = (src.match(new RegExp(`(?<![\\w.])${h}\\(`, "g")) ?? []).length;
      const defs = (src.match(new RegExp(`function ${h}\\(`, "g")) ?? []).length;
      if (calls - defs > 0) c[h] = calls - defs;
    }
    const rpc = (src.match(/rpc\(\s*"current_org_role"/g) ?? []).length;
    if (rpc) c["rpc:current_org_role"] = rpc;
    if (Object.keys(c).length) out[path.relative(ROOT, f).split(path.sep).join("/")] = c;
  }
  return out;
}

/** Every remaining session read outside an entry point, with why it is a session read (authorize), not a drawn one. */
const AUTHORIZE: Record<string, { counts: Counts; why: string }> = {
  "src/app/dashboard/layout.tsx": { counts: { resolveFirmSession: 1 }, why: "reads the session once, then the viewer (resolveViewer) for everything it draws" },
  "src/app/dashboard/proposals/gate.ts": { counts: { currentRole: 4 }, why: "the proposal actions' gates (pages call only requireProposalsModule)" },
  "src/lib/agents/copilot-draft-proposal.ts": { counts: { currentRole: 1 }, why: "Copilot's draft write, behind the chat route (refused in a preview)" },
  "src/lib/auth/current-role.ts": { counts: { currentRole: 1, "rpc:current_org_role": 1 }, why: "the session helper itself" },
  "src/lib/automation/drips.ts": { counts: { requireAutomationAdminRole: 6, requireAutomationStaffRole: 3 }, why: "sequence writes" },
  "src/lib/automation/rules.ts": { counts: { requireAutomationAdminRole: 4, "rpc:current_org_role": 2 }, why: "the automation write gates themselves" },
  "src/lib/brain/claims.ts": { counts: { "rpc:current_org_role": 3 }, why: "Firm notes writes" },
  "src/lib/brain/entries.ts": { counts: { "rpc:current_org_role": 1 }, why: "Firm notes writes" },
  "src/lib/campaigns/advance.ts": { counts: { requireAutomationStaffRole: 1 }, why: "a sequence write" },
  "src/lib/consult-proposal/link.ts": { counts: { isCurrentUserApprover: 1 }, why: "the queue approve gate (an action)" },
  "src/lib/custom-columns/field-deps.ts": { counts: { resolveFirmSession: 1 }, why: "the firm column writes' org id (an owner-only write, called from server actions)" },
  "src/lib/documents/store.ts": { counts: { requireMatterWriteRole: 1 }, why: "a document write" },
  "src/lib/files/guard.ts": { counts: { "rpc:current_org_role": 1 }, why: "file upload / delete / download gates (actions and the download route)" },
  "src/lib/firm/session.ts": { counts: { "rpc:current_org_role": 1 }, why: "the session itself (staff's claimed role)" },
  "src/lib/intake/leads.ts": { counts: { resolveCurrentRole: 2 }, why: "lead writes (lane, temperature)" },
  "src/lib/intake-forms/event-export-csv.ts": { counts: { "rpc:current_org_role": 1 }, why: "the CSV route's own gate (a route handler)" },
  "src/lib/intake-forms/export-csv.ts": { counts: { "rpc:current_org_role": 1 }, why: "the CSV route's own gate (a route handler)" },
  "src/lib/intake-forms/load-performance.ts": { counts: { callerHasRole: 1 }, why: "the status change write" },
  "src/lib/intake-forms/requests.ts": { counts: { "rpc:current_org_role": 1 }, why: "intake request writes" },
  "src/lib/intake-forms/store.ts": { counts: { currentRole: 2 }, why: "form writes, and the first-draft create on the Forms page (a write; the page passes mayCreate: false in a preview)" },
  "src/lib/matters/contacts.ts": { counts: { requireMatterWriteRole: 5 }, why: "contact writes and the allowlisted contact search" },
  "src/lib/matters/deadlines.ts": { counts: { requireMatterWriteRole: 5, "rpc:current_org_role": 2 }, why: "deadline writes" },
  "src/lib/matters/litigation.ts": { counts: { requireMatterWriteRole: 1 }, why: "a matter write" },
  "src/lib/matters/matters.ts": { counts: { requireMatterWriteRole: 6, resolveFirmSession: 1, "rpc:current_org_role": 2 }, why: "matter writes and the close override" },
  "src/lib/matters/notes.ts": { counts: { requireMatterWriteRole: 1 }, why: "a note write" },
  "src/lib/matters/stages.ts": { counts: { requireMatterWriteRole: 1 }, why: "a stage move" },
  "src/lib/matters/tasks.ts": { counts: { requireMatterWriteRole: 4 }, why: "task writes" },
  "src/lib/matters/team-status-note.ts": { counts: { requireMatterWriteRole: 1 }, why: "a note write" },
  "src/lib/pipeline/consult-outcome.ts": { counts: { resolveCurrentRole: 1 }, why: "a consult outcome write" },
  "src/lib/pipeline/leads.ts": { counts: { resolveCurrentRole: 2, requireLeadWriteRole: 2, "rpc:current_org_role": 1 }, why: "lead writes and stage moves" },
  "src/lib/pipeline/notes.ts": { counts: { resolveCurrentRole: 1 }, why: "a note write" },
  "src/lib/proposals/store.ts": { counts: { "rpc:current_org_role": 2 }, why: "proposal writes (:174 requireRole) and the delete path" },
  "src/lib/queue/card-moves.ts": { counts: { resolveFirmSession: 2 }, why: "hand off / send back writes" },
  "src/lib/queue/make-draft.ts": { counts: { resolveFirmSession: 3 }, why: "the Outlook draft write" },
  "src/lib/queue/review-core.ts": { counts: { resolveQueueRole: 1 }, why: "approve / reject" },
  "src/lib/queue/roles.ts": { counts: { "rpc:current_org_role": 1 }, why: "the queue role helper itself (actions)" },
  "src/lib/quotes/service-library.ts": { counts: { requireQuoteLibraryAdminRole: 3, "rpc:current_org_role": 1 }, why: "service library writes" },
  "src/lib/quotes/store.ts": { counts: { requireQuoteWriteRole: 16, "rpc:current_org_role": 1 }, why: "quote writes" },
  "src/lib/reconcile/authorize.ts": { counts: { "rpc:current_org_role": 1 }, why: "the reconcile actions' gate (the page draws by resolveViewSession)" },
  "src/lib/settings/admin.ts": { counts: { "rpc:current_org_role": 1 }, why: "member writes" },
  "src/lib/time/entries.ts": { counts: { resolveCurrentRole: 1 }, why: "time writes (the running chip reads the viewer's id)" },
  "src/lib/views/view-as.ts": { counts: { resolveFirmSession: 1, currentRole: 1, isCurrentUserApprover: 1, resolveQueueRole: 1 }, why: "the twins: outside a preview each IS its session helper" },
  "src/lib/voice/notes.ts": { counts: { resolveCurrentRole: 1 }, why: "a voice note write" },
  "src/lib/welcome/generate.ts": { counts: { requireMatterWriteRole: 1 }, why: "a welcome draft (queue write)" },
};

describe("every session role read is classified", () => {
  const inv = inventory();

  it("render code (pages, layouts, components) makes no session role read except the layout's one session read", () => {
    const render = Object.keys(inv).filter((f) => /^src\/(app|components)\//.test(f) && !/proposals\/gate\.ts$/.test(f));
    expect(render).toEqual(["src/app/dashboard/layout.tsx"]);
  });

  it("the inventory equals the classified list, call for call", () => {
    const expected = Object.fromEntries(Object.entries(AUTHORIZE).map(([f, v]) => [f, v.counts]));
    expect(inv).toEqual(expected);
  });

  it("the drawn reads use the twins", () => {
    const uses = (f: string, re: RegExp) => re.test(readFileSync(path.join(ROOT, f), "utf8"));
    for (const f of [
      "src/app/dashboard/settings/approvals/page.tsx",
      "src/app/dashboard/settings/proposals/page.tsx",
      "src/app/dashboard/proposals/new/page.tsx",
      "src/app/dashboard/proposals/page.tsx",
      "src/app/dashboard/reports/page.tsx",
      "src/app/dashboard/reports/[key]/page.tsx",
      "src/app/dashboard/campaigns/page.tsx",
      "src/app/dashboard/campaigns/[id]/page.tsx",
      "src/app/dashboard/campaigns/templates/page.tsx",
      "src/app/dashboard/queue/[id]/page.tsx",
    ]) {
      expect(uses(f, /viewerRole\(\)|viewerQueueRole\(|resolveViewSession\(/), f).toBe(true);
    }
    expect(uses("src/app/dashboard/proposals/[id]/page.tsx", /isViewerApprover\(\)/)).toBe(true);
    expect(uses("src/lib/queue/view-context.ts", /resolveViewSession\(\)/)).toBe(true);
    expect(uses("src/lib/loe/page-load.ts", /viewerRole\(\), previewingAs\(\)/)).toBe(true);
    expect(uses("src/lib/record-card/load.ts", /resolveViewSession\(\)/)).toBe(true);
    expect(uses("src/lib/lead-step/load.ts", /resolveViewSession\(\)/)).toBe(true);
  });
});

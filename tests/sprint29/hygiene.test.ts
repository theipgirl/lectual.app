import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { aliasTable } from "@/lib/lawmatics/stage-map";
import { DEFAULT_STAGE_NAMES } from "@/lib/agents/stage-keeper/mapping";
import { ORDERED_MILESTONES, MILESTONE_STAGE_NAMES } from "@/lib/reconcile/milestones";

/** Sprint 29 hygiene: the contract's grep checks, as tests. */

const read = (f: string) => readFileSync(f, "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const SRC = walk("src");
const NEW_OR_REWRITTEN = [
  "src/lib/stage-keeper/signals.ts",
  "src/lib/mailbox/firm-sender.ts",
  "src/lib/pipeline/new-enquiry.ts",
  "src/lib/pipeline/stage-order.ts",
  "src/lib/pipeline/bulk-move.ts",
  "src/lib/intake/stage-decision.ts",
  "src/lib/intake/stage-decisions-read.ts",
  "src/lib/queue/reviewer-summary.ts",
  "src/lib/proposals/transcript-lead.ts",
  "src/app/dashboard/intake/_components/BulkMoveBar.tsx",
  "src/components/queue/ReviewerSummary.tsx",
  "src/components/queue/ReviewPanel.tsx",
  "src/components/queue/review.css",
  "src/components/meetings/MeetingForms.tsx",
  "src/components/proposal-list/PaidCell.tsx",
  "src/components/proposal-list/ProposalsTable.tsx",
  "src/components/proposal-editor/WhoIsThisFor.tsx",
];

describe("scope: no migration, no dependency, no new unsafe HTML", () => {
  it("no SQL file and no migrations directory in this repo", () => {
    expect(existsSync("supabase")).toBe(false);
    expect(walk(".").filter((f) => !f.includes("node_modules") && !f.includes(".next") && !f.includes(".git/") && /\.sql$/.test(f))).toEqual([]);
  });

  it("no new migration or dependency since the start of the sprint (when git can say)", () => {
    let changed: string[];
    try {
      changed = execSync("git diff --name-only 3ed824b HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n").filter(Boolean);
    } catch {
      return; // no history here: the static checks above still hold
    }
    for (const file of changed) {
      expect(file, file).not.toMatch(/migrations?\/|\.sql$|^package\.json$|pnpm-lock\.yaml|pnpm-workspace\.yaml|^vercel\.json$/);
    }
    // The paid view and the Lawmatics stage alias table are untouched. (paid.ts left this list on
    // purpose: the 2026-10-28 reset-acceptance change, lectual 0101, gave it the fresh-round rule.)
    for (const file of ["src/lib/proposals/paid-view.ts", "src/lib/lawmatics/stage-map.ts", "src/lib/reconcile/milestones.ts"]) {
      expect(changed, file).not.toContain(file);
    }
  });

  it("no dangerouslySetInnerHTML in any file this sprint wrote", () => {
    for (const file of NEW_OR_REWRITTEN) expect(read(file), file).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it("no new service-role client outside the Stage Keeper runner", () => {
    for (const file of NEW_OR_REWRITTEN) expect(read(file), file).not.toMatch(/db\/admin|getAdminClient|SERVICE_ROLE/);
    // The runner and its reads are handed the client by the agent context; they import none.
    expect(read("src/lib/agents/stage-keeper/run.ts")).not.toMatch(/db\/admin|getAdminClient/);
  });

  it("no emoji in any file this sprint wrote", () => {
    for (const file of NEW_OR_REWRITTEN) expect(read(file), file).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it("the CSS this sprint added uses tokens only", () => {
    const intake = read("src/app/dashboard/intake/intake.css");
    const block = intake.slice(intake.indexOf("Sprint 29: why a card is in its column"));
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    expect(read("src/components/queue/review.css")).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });

  it("the explicit {\" \"} in the JSX text it touched is still there", () => {
    expect(read("src/app/dashboard/meetings/[id]/page.tsx")).toContain('{" "}didn');
    expect(read("src/components/meetings/MeetingForms.tsx")).toContain("&apos;");
  });
});

describe("ON HOLD: the new RPB intake board is not built", () => {
  it("no Consult Held - Proposal in Progress name, and no new alias for the scheduled stages", () => {
    for (const file of SRC.filter((f) => /\.(ts|tsx)$/.test(f))) expect(read(file), file).not.toMatch(/Proposal in Progress/i);
    expect(DEFAULT_STAGE_NAMES["consult-scheduled"]).toEqual(["Consultation Scheduled", "Consult Scheduled", "Consult Booked", "Strategy Session Scheduled", "Discovery Call Scheduled"]);
    expect(DEFAULT_STAGE_NAMES["consult-held"]).toEqual(["Consult Held", "Consultation Held", "Consult Completed"]);
    expect(DEFAULT_STAGE_NAMES["post-consult-sent"]).toEqual(["Post Consultation Email Sent", "Post Consult Email Sent", "Post Consultation Follow Up"]);
  });

  it("the milestone order is the Sprint 26 order, and the milestone stage names carry no board names", () => {
    expect(ORDERED_MILESTONES).toEqual([
      "contacted",
      "consult_scheduled",
      "consult_held",
      "questionnaire_sent",
      "opinion_letter_sent",
      "proposal_sent",
      "follow_up_sent",
      "accepted",
      "loe_sent",
      "paid",
    ]);
    expect(JSON.stringify(MILESTONE_STAGE_NAMES)).not.toMatch(/Strategy Session Scheduled.*Proposal in Progress/i);
  });
});

describe("Lawmatics stage names never choose a stage", () => {
  it("the alias table is the one Sprint 26 left (no entry added or widened)", () => {
    expect(aliasTable().map((a) => a.lawmatics).sort()).toEqual(
      [
        "discovery call",
        "discovery call scheduled",
        "consultation scheduled",
        "legal strategy session scheduled",
        "strategy session scheduled",
        "strategy session",
        "follow up",
        "loe and invoice sent",
        "lost",
        "lost lead",
        "new inquiry",
        "new lead",
        "new pnc",
        "nurture",
        "pending loe and payment",
        "pending loe payment",
        "engagement letter sent",
        "pnc",
        "potential new client",
        "signed loe deposit received",
        "undecided",
        "undecided questions",
      ].sort(),
    );
  });

  it("the importer and Reconcile's Lawmatics, evidence and create paths do not call resolveStage or import the alias table (mail's own default stage names still resolve through it)", () => {
    for (const file of [
      "src/lib/lawmatics/import-plan.ts",
      "src/lib/lawmatics/import.ts",
      "src/lib/reconcile/lawmatics.ts",
      "src/lib/reconcile/plan.ts",
      "src/lib/reconcile/evidence.ts",
      "src/lib/reconcile/sources.ts",
      "src/app/dashboard/intake/reconcile/create-lead.ts",
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/resolveStage\s*\(|aliasTable|\bALIASES\b/);
    }
  });

  it("the only stage-map import left in the importer is the 'Hired' name check", () => {
    const plan = read("src/lib/lawmatics/import-plan.ts");
    expect([...plan.matchAll(/import \{([^}]*)\} from "\.\/stage-map"/g)].map((m) => m[1].trim())).toEqual(["isHiredStageName, type StageRef"]);
  });
});

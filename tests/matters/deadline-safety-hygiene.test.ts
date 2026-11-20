import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const flat = (file: string) => readFileSync(path.join(ROOT, file), "utf8").replace(/\s+/g, " ");

const NEW_FILES = [
  "src/lib/matters/deadline-safety.ts",
  "src/lib/matters/close-guard.ts",
  "src/lib/matters/open-deadlines-read.ts",
  "src/lib/today/deadline-alerts.ts",
  "src/lib/today/deadline-alerts-store.ts",
  "src/components/today/DeadlineAlertsCard.tsx",
  "src/components/matters/CloseOverrideForm.tsx",
  "src/components/settings/DeadlineAlertsForm.tsx",
  "src/app/dashboard/settings/team/deadline-alert-actions.ts",
];

describe("PGE Sprint 3 Part A hygiene", () => {
  it("no new deadline-safety file reaches the service role", () => {
    for (const f of NEW_FILES) {
      const src = flat(f);
      expect(src, f).not.toMatch(/@\/lib\/db\/admin|getAdminClient|SERVICE_ROLE/);
    }
  });

  it("the matter status is written in ONE file (updateMatterStatus and the override), so the close guard cannot be skipped", () => {
    const hits = walk("src").filter((f) => /from\("crm_matter"\) ?\.update\(\{ ?status\b/.test(flat(f)));
    expect(hits).toEqual(["src/lib/matters/matters.ts"]);
  });

  it("no agent, Today or review code writes a deadline or changes attorney_confirmed (only the matter page's own actions do)", () => {
    const files = [...walk("src/lib/agents"), ...walk("src/lib/today"), ...walk("src/lib/review"), ...walk("src/components/today")];
    for (const f of files) {
      const src = flat(f);
      expect(src, f).not.toMatch(/crm_matter_deadline"\) ?\.(insert|update|upsert|delete)\(/);
      expect(src, f).not.toMatch(/attorney_confirmed: ?true/);
    }
  });

  it("the deadline notice carries ids, the window and the title only (no client name, address or note)", () => {
    const src = flat("src/lib/today/deadline-alerts.ts");
    const payload = src.slice(src.indexOf("export function noticePayload"));
    expect(payload).toMatch(/source: DEADLINE_NOTICE_SOURCE, deadline_id: plan.deadlineId, window: plan.window, title: plan.title.slice\(0, 120\)/);
  });

  it("the override form is drawn only behind canOverrideClose, and the action re-checks the role before any read", () => {
    expect(flat("src/app/dashboard/matters/[id]/page.tsx")).toMatch(/const showCloseOverride = canOverrideClose\(session.role\)/);
    const core = flat("src/lib/matters/close-guard.ts");
    const run = core.slice(core.indexOf("export async function runCloseOverride"));
    expect(run.indexOf("canOverrideClose(role)")).toBeLessThan(run.indexOf("readGuard(deps)"));
  });
});

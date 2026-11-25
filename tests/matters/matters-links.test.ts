import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A link into the Matters LIST that shows a firm-wide number or a status/view filter must say `group=all`, or it lands on
 * the default group (Pre-filing when it has matters) and the number on the link disagrees with the page.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}
const files = walk("src");

describe("links into /dashboard/matters/ (the list)", () => {
  it("any href with seg= or view= carries group=", () => {
    const bad: string[] = [];
    for (const f of files) {
      if (f === join("src", "lib", "matters", "list-href.ts")) continue; // the one helper that writes the list value
      if (f === join("src", "app", "dashboard", "matters", "page.tsx")) continue; // builds its own hrefs from the resolved group
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\/dashboard\/matters\/?\?[^"'`\s)]*/g)) {
        if (/(seg|view)=/.test(m[0]) && !/group=/.test(m[0])) bad.push(`${f}: ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("a plain list link (no group) is only in the allow-list: rail, back links and links with no count", () => {
    const ALLOW: Record<string, string> = {
      "src/app/dashboard/matters/[id]/actions.ts": "revalidatePath, not a link",
      "src/app/dashboard/settings/integrations/lawmatics/actions.ts": "revalidatePath, not a link",
      "src/lib/nav.ts": "the rail: a plain click may take the default",
      "src/app/dashboard/matters/[id]/page.tsx": "back link, no count",
      "src/components/reconcile/ReconcileTable.tsx": "Open a matter, no count",
      "src/lib/onboarding/hub.ts": "guided-flow page paths, not links with a count",
      "src/lib/onboarding/hub-runner.ts": "guided-flow page paths",
      "src/app/dashboard/matters/page.tsx": "its own path for the opened card: the open and close links keep every query key",
      "src/lib/matters/calendar-rows.ts": "last-resort target for a task with no record",
      "src/lib/views/layout/actions.ts": "revalidatePath after a layout change, not a link",
      "src/lib/stages/actions.ts": "revalidatePath after a stage change (boards, reconcile, review, and the record pages as /[id] \"page\"), not a link",
    };
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/["'`]\/dashboard\/matters\/?["'`]/.test(src) && !(f in ALLOW)) bad.push(f);
    }
    expect(bad).toEqual([]);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = fs.readFileSync(path.join(process.cwd(), "src/app/dashboard/matters/[id]/page.tsx"), "utf8");

describe("matter page billing card", () => {
  it("mounts the card exactly once, only inside canSeeBilling(session.role)", () => {
    expect(page.match(/<MatterBilling\b/g)).toHaveLength(1);
    expect(page).not.toMatch(/<BillingCard\b/);
    const at = page.indexOf("<MatterBilling");
    const guard = page.lastIndexOf("canSeeBilling(session.role) ?", at);
    expect(guard).toBeGreaterThan(-1);
    // nothing between the guard and the card closes the conditional
    expect(page.slice(guard, at)).not.toContain(") : null}");
  });
  it("the card's server component re-checks the role and never uses a service role", () => {
    const comp = fs.readFileSync(path.join(process.cwd(), "src/components/billing/MatterBilling.tsx"), "utf8");
    expect(comp).toContain("canSeeBilling(session.role)");
    for (const f of ["src/lib/billing/load.ts", "src/components/billing/MatterBilling.tsx"]) {
      expect(fs.readFileSync(path.join(process.cwd(), f), "utf8")).not.toMatch(/db\/admin|getAdminClient/);
    }
  });
});

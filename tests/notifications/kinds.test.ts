import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NOTIFICATION_KIND_FOR } from "@/lib/notifications/kinds";

const read = (rel: string) => readFileSync(path.join(__dirname, "../..", rel), "utf8");

describe("NOTIFICATION_KIND_FOR (F8)", () => {
  it("maps every event to a value the crm_notification_kind enum has", () => {
    const types = read("src/lib/db/types.ts");
    const block = types.match(/crm_notification_kind:\s*\[([^\]]*)\]/);
    expect(block).not.toBeNull();
    const enumValues = [...block![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(enumValues.length).toBeGreaterThan(0);
    for (const [event, kind] of Object.entries(NOTIFICATION_KIND_FOR)) {
      expect(enumValues, event).toContain(kind);
    }
  });

  it("writes consult outcomes and approval alerts under their dedicated kinds (lectual 0094)", () => {
    expect(NOTIFICATION_KIND_FOR.consult_outcome).toBe("consult_outcome");
    expect(NOTIFICATION_KIND_FOR.approval_needed).toBe("approval_needed");
  });

  it("lists exactly six kinds, in both the type union and the Constants array", () => {
    const types = read("src/lib/db/types.ts");
    const union = types.match(/crm_notification_kind:\s*((?:\|\s*"[a-z_]+"\s*)+)/);
    expect(union).not.toBeNull();
    const unionValues = [...union![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const arr = types.match(/crm_notification_kind:\s*\[([^\]]*)\]/);
    const arrayValues = [...arr![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
    const six = ["approval_needed", "assigned", "consult_outcome", "lead_replied", "mentioned", "time_running"];
    expect(unionValues).toEqual(six);
    expect(arrayValues).toEqual(six);
  });

  it("covers the six events", () => {
    expect(Object.keys(NOTIFICATION_KIND_FOR).sort()).toEqual(
      ["approval_needed", "assigned", "consult_outcome", "lead_replied", "mentioned", "time_running"],
    );
  });

  it("is what the consult-outcome and approval producers read their kind from", () => {
    expect(read("src/lib/pipeline/consult-outcome.ts")).toMatch(/kind: NOTIFICATION_KIND_FOR\.consult_outcome/);
    expect(read("src/lib/notifications/approval.ts")).toMatch(/kind: NOTIFICATION_KIND_FOR\.approval_needed/);
    expect(read("src/lib/pipeline/consult-outcome.ts")).not.toMatch(/kind:\s*"mentioned"/);
  });
});

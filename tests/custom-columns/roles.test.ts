import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CUSTOM_VALUE_WRITE_ROLES, canWriteCustomValue } from "@/lib/custom-columns/rules";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { SETUP_ROLES, canSeeSetup } from "@/lib/setup/roles";
import { ROLES } from "@/lib/auth/roles";

/** C4: the role lists the actions use equal each other and 0115's policies. */
const sql = readFileSync(path.resolve(__dirname, "../../docs/pge/2026-11-17-agentic-ip-os/0115-proposed.sql.txt"), "utf8").replace(/--.*$/gm, "");
const flat = sql.replace(/\s+/g, " ");
function policyRoles(name: string): string[][] {
  const at = flat.indexOf(`create policy ${name} `);
  expect(at, name).toBeGreaterThan(0);
  const body = flat.slice(at, flat.indexOf("end if;", at));
  return [...body.matchAll(/current_org_role\(\) in \(([^)]*)\)/g)].map((m) => m[1].split(",").map((r) => r.trim().replace(/'/g, "")).sort());
}
const sorted = (xs: readonly string[]) => [...xs].sort();

describe("C4: role lists", () => {
  it("CUSTOM_VALUE_WRITE_ROLES = MATTER_WRITE_ROLES = CAN_WRITE_LEAD (as sets)", () => {
    expect(sorted(CUSTOM_VALUE_WRITE_ROLES)).toEqual(sorted(MATTER_WRITE_ROLES));
    expect(sorted(CUSTOM_VALUE_WRITE_ROLES)).toEqual(sorted(CAN_WRITE_LEAD));
  });
  it("= 0115's value insert, update and delete policies", () => {
    for (const p of ["crm_custom_value_insert_staff", "crm_custom_value_update_staff", "crm_custom_value_delete_staff"]) {
      const lists = policyRoles(p);
      expect(lists.length, p).toBeGreaterThan(0);
      for (const l of lists) expect(l, p).toEqual(sorted(CUSTOM_VALUE_WRITE_ROLES));
    }
  });
  it("the field actions' admin tier = SETUP_ROLES = canSeeSetup over all 10 roles = 0115's field policies", () => {
    expect(ROLES).toHaveLength(10);
    expect(sorted(ROLES.filter((r) => canSeeSetup(r)))).toEqual(sorted(SETUP_ROLES));
    for (const p of ["crm_custom_field_insert_admin", "crm_custom_field_update_admin"]) for (const l of policyRoles(p)) expect(l, p).toEqual(sorted(SETUP_ROLES));
  });
  it("canWriteCustomValue fails closed", () => {
    for (const r of ROLES) expect(canWriteCustomValue(r), r).toBe(CUSTOM_VALUE_WRITE_ROLES.includes(r));
    for (const x of [null, undefined, "", "Owner", "platform_admin"]) expect(canWriteCustomValue(x)).toBe(false);
  });
});

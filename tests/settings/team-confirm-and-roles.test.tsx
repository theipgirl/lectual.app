import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ROLES, ROLE_LABEL, hasRole } from "@/lib/auth/roles";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { MATTER_WRITE_ROLES } from "@/lib/matters/matters";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import { FILE_DELETE_ROLES } from "@/lib/files/roles";
import { CLERK_NOTE, ROLE_BLURB, roleChangeQuestion, roleRows } from "@/lib/team/role-table";
import { RoleTable } from "@/components/settings/RoleTable";

vi.mock("@/app/dashboard/settings/team/actions", () => ({
  inviteMemberAction: vi.fn(),
  removeMemberAction: vi.fn(),
  setMemberRoleAction: vi.fn(),
}));

const forms = readFileSync("src/components/settings/TeamForms.tsx", "utf8");

describe("F13: role change needs a Confirm", () => {
  it("renders the select with the current role and no confirm until a different role is chosen", async () => {
    const { RoleSelect } = await import("@/components/settings/TeamForms");
    const html = renderToStaticMarkup(<RoleSelect userId="u1" role="paralegal" grantable={["attorney", "paralegal", "viewer"]} name="Dana" />);
    expect(html).toContain('<option value="paralegal" selected="">Paralegal</option>');
    expect(html).not.toContain("Confirm");
    expect(html).not.toContain("Cancel");
  });

  it("the select no longer submits on change; only the Confirm button submits, and Cancel restores the old role", () => {
    const select = forms.slice(forms.indexOf("export function RoleSelect"), forms.indexOf("export function RemoveMember"));
    expect(select).not.toContain("requestSubmit");
    expect(select).toMatch(/onChange=\{\(e\) => setChosen\(e\.currentTarget\.value\)\}/);
    expect(select).toMatch(/type="submit"[\s\S]*Confirm/);
    expect(select).toMatch(/onClick=\{\(\) => setChosen\(role\)\}[\s\S]*Cancel/);
  });

  it("asks a plain question naming the person and both roles", () => {
    expect(roleChangeQuestion("Dana", "paralegal", "law_clerk")).toBe("Change Dana's role from Paralegal to Law clerk?");
  });
});

describe("F13: What each role can do", () => {
  it("lists every role in ROLE_LABEL, once", () => {
    const rows = roleRows();
    expect(rows.map((r) => r.role)).toEqual([...ROLES]);
    expect(rows.map((r) => r.label)).toEqual(ROLES.map((r) => ROLE_LABEL[r]));
    const html = renderToStaticMarkup(<RoleTable />);
    for (const r of ROLES) expect(html).toContain(`<td class="pri">${ROLE_LABEL[r]}</td>`);
    expect(html).toContain("What each role can do");
  });

  it("is cross-checked against the role lists the code enforces", () => {
    for (const row of roleRows()) {
      expect(row.abilities.edit).toBe(CAN_WRITE_LEAD.includes(row.role) && MATTER_WRITE_ROLES.includes(row.role));
      expect(row.abilities.approve).toBe(QUEUE_APPROVE_ROLES.includes(row.role));
      expect(row.abilities.files).toBe(FILE_DELETE_ROLES.includes(row.role));
      expect(row.abilities.team).toBe(hasRole(row.role, "senior_admin"));
    }
  });

  it("claims nothing the columns contradict: a role described as not approving never approves", () => {
    for (const row of roleRows()) {
      if (/doesn't approve|but doesn't change|Can look but not/.test(row.blurb)) expect(row.abilities.approve).toBe(false);
      if (/approves client mail/.test(row.blurb)) expect(row.abilities.approve).toBe(true);
    }
  });

  it("Clerk and Law clerk each have their own one-line distinction", () => {
    expect(ROLE_BLURB.clerk).not.toBe(ROLE_BLURB.law_clerk);
    expect(ROLE_BLURB.clerk.length).toBeGreaterThan(10);
    expect(ROLE_BLURB.law_clerk.length).toBeGreaterThan(10);
    const html = renderToStaticMarkup(<RoleTable />).replaceAll("&#x27;", "'");
    expect(html).toContain(CLERK_NOTE);
  });

  it("is on the Team page", () => {
    const page = readFileSync("src/app/dashboard/settings/team/page.tsx", "utf8");
    expect(page).toContain("<RoleTable />");
    expect(page).toContain("name={name}");
  });
});

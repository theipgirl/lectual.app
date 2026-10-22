import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sectionLabelFor } from "@/lib/section-label";

describe("sectionLabelFor (F17)", () => {
  it.each([
    ["/dashboard/leads/abc/", "Intake"],
    ["/dashboard/leads/abc", "Intake"],
    ["/dashboard/", "Today"],
    ["/dashboard", "Today"],
    ["/dashboard/reports/ipos/", "IP.OS · Report"],
    ["/dashboard/reports/ipos", "IP.OS · Report"],
    ["/dashboard/reports/matters/", "Active matters · Report"],
    ["/dashboard/reports/nope/", "Report"],
    ["/dashboard/reports/", "Report"],
    ["/dashboard/queue/abc/", "Queue"],
    ["/dashboard/settings/modules/", "Settings"],
    ["/dashboard/intake/", "Intake"],
    ["/dashboard/proposals/new/", "Client proposals"],
    ["/dashboard/matters/m1/", "Matters"],
  ])("%s -> %s", (pathname, label) => {
    expect(sectionLabelFor(pathname)).toBe(label);
  });

  it("gives an unknown path a neutral label, never Today", () => {
    expect(sectionLabelFor("/dashboard/zzz/")).toBe("Workspace");
    expect(sectionLabelFor("/dashboard/zzz/deep/er/")).toBe("Workspace");
    expect(sectionLabelFor("/somewhere-else/")).toBe("Workspace");
  });

  it("gives an unbuilt section the neutral label too", () => {
    for (const slug of ["sms", "portals"]) expect(sectionLabelFor(`/dashboard/${slug}/`)).toBe("Workspace");
  });

  it("labels the Skills page Skills (built in Sprint 18)", () => {
    expect(sectionLabelFor("/dashboard/skills/")).toBe("Skills");
  });

  it("treats a missing pathname as Today", () => {
    expect(sectionLabelFor(null)).toBe("Today");
    expect(sectionLabelFor(undefined)).toBe("Today");
  });

  it("SectionLabel renders what sectionLabelFor returns", () => {
    const src = readFileSync(path.resolve(__dirname, "../../src/components/shell/SectionLabel.tsx"), "utf8");
    expect(src).toContain("sectionLabelFor(usePathname())");
    expect(src).not.toContain("?? \"Today\"");
  });
});

describe("sectionLabelFor notifications (S5 F9)", () => {
  it.each([
    "/dashboard/notifications/",
    "/dashboard/notifications",
    "/dashboard/notifications/?tab=unread",
    "/dashboard/notifications?tab=unread&page=2",
  ])("%s -> Notifications", (pathname) => {
    expect(sectionLabelFor(pathname)).toBe("Notifications");
  });
});

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/" }));
vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));

import { Rail } from "@/components/shell/Rail";
import { visibleNav } from "@/lib/nav";
import { drawnNav, shellFor } from "@/lib/views";
import { tourSteps } from "@/lib/onboarding/tour";
import { visibleFlows } from "@/lib/onboarding/hub";
import type { Role } from "@/lib/auth/roles";

const ALL = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "role-views"];
const TEAM_ROLES: Role[] = ["admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk"];

const tokensOf = (html: string) => new Set([...html.matchAll(/data-tour="([^"]*)"/g)].flatMap((m) => m[1].split(" ")));

describe("tour and Getting started on the team rail", () => {
  for (const role of TEAM_ROLES) {
    for (const modules of [[], ALL]) {
      it(`${role} (${modules.length ? "all features" : "no features"}): no step points at a rail row the team rail does not draw`, () => {
        const drawn = drawnNav(visibleNav(modules, role), "team");
        const shell = shellFor("team");
        const html = renderToStaticMarkup(
          createElement(Rail, { items: drawn, queueStatus: "ok", pendingCount: 0, counts: {}, initialPinned: false, tree: shell.tree, showSettings: shell.showSettings, showReports: shell.showReports }),
        );
        const tokens = tokensOf(html);
        for (const step of tourSteps({ role, navItems: drawn, aiConfigured: true })) {
          if (step.target?.startsWith("nav-")) expect(tokens, `tour ${step.id}`).toContain(step.target);
        }
        for (const flow of visibleFlows({ role, modules, aiConfigured: true, outlookConnectable: true })) {
          for (const step of flow.steps) if (step.target.startsWith("nav-")) expect(tokens, `hub ${flow.id}/${step.id}`).toContain(step.target);
        }
        expect(html).not.toContain("Settings");
      });
    }
  }
});

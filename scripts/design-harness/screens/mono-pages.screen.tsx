import type { ReactElement } from "react";
import MattersPage from "@/app/dashboard/matters/page";
import IntakePage from "@/app/dashboard/intake/page";
import MatterPage from "@/app/dashboard/matters/[id]/page";
import LeadPage from "@/app/dashboard/leads/[id]/page";
import ProposalsPage from "@/app/dashboard/proposals/page";
import ProposalPage from "@/app/dashboard/proposals/[id]/page";
import { L, M } from "../mono-data";
import { P } from "../mono-proposals";
import { resetState } from "../fixtures";
import { state } from "../state";
import { OwnerShell } from "../shell";
import { TechShell } from "../mono-shell";
import type { Screen } from "../registry";

/**
 * Legibility pass, "monotype" round: the staff Proposals, Leads and Matters pages with the REAL page components and sample data
 * (mono-data.ts), in the technician shell and the owner shell, desktop and phone. Same ids before and after (the "before" run is a
 * worktree of the previous HEAD), so the two renders pair up by file name.
 */
type Page = { key: string; title: string; pathname: string; render: () => Promise<ReactElement> | ReactElement };

const pages: Page[] = [
  { key: "matters-list", title: "Matters list", pathname: "/dashboard/matters/", render: () => MattersPage({ searchParams: Promise.resolve({}) }) as unknown as Promise<ReactElement> },
  { key: "matters-board", title: "Matters board", pathname: "/dashboard/matters/", render: () => MattersPage({ searchParams: Promise.resolve({ view: "board" }) }) as unknown as Promise<ReactElement> },
  { key: "leads-list", title: "Leads list", pathname: "/dashboard/intake/", render: () => IntakePage({ searchParams: Promise.resolve({}) }) as unknown as Promise<ReactElement> },
  { key: "leads-board", title: "Leads board", pathname: "/dashboard/intake/", render: () => IntakePage({ searchParams: Promise.resolve({ view: "board" }) }) as unknown as Promise<ReactElement> },
  { key: "proposals-list", title: "Proposals list", pathname: "/dashboard/proposals/", render: () => ProposalsPage({ searchParams: Promise.resolve({}) }) as unknown as Promise<ReactElement> },
  { key: "proposal-page", title: "Proposal page", pathname: `/dashboard/proposals/${P.crumb}/`, render: () => ProposalPage({ params: Promise.resolve({ id: P.crumb }) }) as unknown as Promise<ReactElement> },
  { key: "lead-page", title: "Lead page", pathname: `/dashboard/leads/${L.maya}/`, render: () => LeadPage({ params: Promise.resolve({ id: L.maya }) }) as unknown as Promise<ReactElement> },
  { key: "matter-page", title: "Matter page", pathname: `/dashboard/matters/${M.lumen}/`, render: () => MatterPage({ params: Promise.resolve({ id: M.lumen }) }) as unknown as Promise<ReactElement> },
];

export const screens: Screen[] = pages.flatMap((p) =>
  (["tech", "owner"] as const).flatMap((shell) =>
    (["desktop", "phone"] as const).map((viewport) => ({
      id: `mono-${p.key}-${shell}-${viewport === "desktop" ? "d" : "p"}`,
      title: `${p.title} (${shell}, ${viewport})`,
      designBoard: "none",
      viewport,
      pathname: p.pathname,
      shell: "none" as const,
      prepare: () => {
        resetState();
        state.pathname = p.pathname;
        (state as { paidUnreadable?: boolean }).paidUnreadable = false;
      },
      render: async () => {
        const page = await p.render();
        return shell === "owner" ? <OwnerShell>{page}</OwnerShell> : <TechShell>{page}</TechShell>;
      },
    })),
  ),
);

/** Proposals list variants: the paid read failing (every accepted row says so), and the Paid segment (only exists after the paid-leaves-the-list change). */
const proposalsVariant = (key: string, title: string, search: Record<string, string>, unreadable: boolean): Screen => ({
  id: `mono-proposals-${key}-tech-d`,
  title: `Proposals list, ${title} (tech, desktop)`,
  designBoard: "none",
  viewport: "desktop",
  pathname: "/dashboard/proposals/",
  shell: "none" as const,
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/proposals/";
    (state as { paidUnreadable?: boolean }).paidUnreadable = unreadable;
  },
  render: async () => <TechShell>{(await ProposalsPage({ searchParams: Promise.resolve(search) })) as unknown as ReactElement}</TechShell>,
});
screens.push(proposalsVariant("unreadable", "paid read failed", {}, true), proposalsVariant("paid-segment", "Paid segment", { segment: "paid" }, false));

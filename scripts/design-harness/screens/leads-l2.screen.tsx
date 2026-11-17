import type { ReactElement } from "react";
import IntakePage from "@/app/dashboard/intake/page";
import { tables } from "../mono-data";
import { activities, boothScorecards, stages, NOW_MS } from "../fixtures-leads-real";
import { l2Leads, l2State } from "../fixtures-leads-l2";
import { resetState } from "../fixtures";
import { state } from "../state";
import { OwnerShell } from "../shell";
import { TechShell } from "../mono-shell";
import type { Screen } from "../registry";
import CompareView from "@/app/dashboard/intake/_components/CompareView";
import { shapeCompareSide } from "@/lib/intake/compare";

/**
 * Item L2: the Leads list and board with the production-shaped sample (long names, long chips, a suggestion, temperatures set and
 * suggested, a duplicate pair), technician and owner shells at 1440 / 1280 / 375. The same screens render BEFORE (9c6e7f5) and AFTER.
 */
const EXTRA = ["crm_drip_enrollment", "crm_meeting", "crm_discovery_session", "crm_drip_step", "crm_time_entry", "crm_calendar_event", "client_proposal"];

async function withL2Data<T>(fn: () => Promise<T>): Promise<T> {
  const mine: Record<string, Record<string, unknown>[]> = { crm_stage: stages, crm_lead: l2Leads(), crm_activity: activities, crm_booth_scorecard: boothScorecards };
  const keys = [...new Set([...Object.keys(mine), ...EXTRA])];
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(tables, k)] as const);
  for (const k of keys) {
    const rows = mine[k] ?? [];
    Object.defineProperty(tables, k, { configurable: true, enumerable: true, get: () => rows });
  }
  try {
    return await fn();
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(tables, k, d);
      else delete (tables as Record<string, unknown>)[k];
    }
  }
}

const RELEASE = "<style>.lx-app{height:auto!important;min-height:0!important;overflow:visible!important}.lx-main,.lx-content,.lx-page{overflow:visible!important;height:auto!important}</style>";
const VPS = [["d", "desktop"], ["m", "desktop"], ["p", "phone"]] as const;
const VIEWS = [["list", { set: "open" }], ["board", { view: "board", set: "open" }]] as const;

const mk = (id: string, view: string, shell: "tech" | "owner", vp: string, viewport: "desktop" | "phone", search: Record<string, string>): Screen => ({
  id,
  title: `Leads ${view} L2 sample (${shell}, ${vp})`,
  designBoard: "none",
  viewport,
  pathname: "/dashboard/intake/",
  shell: "none" as const,
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/intake/";
    const s = l2State(new Date(NOW_MS));
    Object.assign(state, { l2Pending: s.pending, l2Moves: s.moves, l2Facts: s.facts });
  },
  render: async () => {
    const page = (await withL2Data(() => IntakePage({ searchParams: Promise.resolve(search) }))) as unknown as ReactElement;
    return shell === "owner" ? <OwnerShell>{page}</OwnerShell> : <TechShell>{page}</TechShell>;
  },
  transformHtml: (html: string) => RELEASE + html,
});

export const screens: Screen[] = VIEWS.flatMap(([view, search]) => (["tech", "owner"] as const).flatMap((shell) => VPS.map(([vp, viewport]) => mk(`l2-${view}-${shell}-${vp}`, view, shell, vp, viewport, search))));

// The compare panel, drawn open over the list (its behaviour is client state, so the static render draws the panel itself).
const lead = (id: string, last: string, business: string) => ({ id, first_name: "Dominique", last_name: last, business_name: business, mark_text: null, email: "dominique.okonkwo@example.test", referral_source: "UGW", created_at: "2026-09-03T15:00:00Z" });
const comparePanel = (shell: "tech" | "owner", id: string, viewport: "desktop" | "phone"): Screen => ({
  id,
  title: `Compare panel (${shell})`,
  designBoard: "none",
  viewport,
  pathname: "/dashboard/intake/",
  shell: "none" as const,
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/intake/";
  },
  render: async () => {
    const page = (await withL2Data(() => IntakePage({ searchParams: Promise.resolve({ set: "open" }) }))) as unknown as ReactElement;
    const panel = (
      <div className="intake-root">
        <div className="ix-cmp-backdrop">
          <div className="ix-cmp-wrap">
            <CompareView
              titleId="cmp-t"
              state={{
                status: "ok",
                data: {
                  a: shapeCompareSide(lead("a", "Okonkwo", "Okonkwo Textiles"), { status: "ok", name: "Follow-Up" }, { timeline: { status: "ok", count: 7 }, tasks: { status: "ok", count: 1 }, proposals: { status: "ok", count: 0 } }),
                  b: shapeCompareSide(lead("b", "Okonkwo", "Okonkwo Textiles & Home"), { status: "ok", name: "Potential New Client" }, { timeline: { status: "ok", count: 2 }, tasks: { status: "unavailable" }, proposals: { status: "ok", count: 1 } }),
                },
              }}
            />
          </div>
        </div>
      </div>
    );
    const both = (<>{page}{panel}</>);
    return shell === "owner" ? <OwnerShell>{both}</OwnerShell> : <TechShell>{both}</TechShell>;
  },
  transformHtml: (html: string) => RELEASE + html,
});
screens.push(comparePanel("tech", "l2-compare-tech-d", "desktop"), comparePanel("owner", "l2-compare-owner-d", "desktop"), comparePanel("tech", "l2-compare-tech-p", "phone"));

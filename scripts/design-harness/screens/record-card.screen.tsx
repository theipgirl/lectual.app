import type { ReactElement } from "react";
import IntakePage from "@/app/dashboard/intake/page";
import MattersPage from "@/app/dashboard/matters/page";
import { tables } from "../mono-data";
import { activities, boothScorecards, leads, stages } from "../fixtures-leads-real";
import { resetState } from "../fixtures";
import { state } from "../state";
import { TechShell } from "../mono-shell";
import type { Screen } from "../registry";
import { applyMatterData, firstMatterId } from "./matters-phase.screen";

/**
 * Sprint 10 Part 2: the REAL Intake and Matters pages with the edit-in-place controls, and the OPENED card (`?open=`), at 1440 / 1280 /
 * 375, measured for page overflow. Same sample data as the Leads and Matters screens. Not a design board.
 */
const EXTRA = ["crm_drip_enrollment", "crm_meeting", "crm_discovery_session", "crm_drip_step", "crm_time_entry", "crm_booth_scorecard", "crm_calendar_event", "client_proposal"];
const MINE: Record<string, Record<string, unknown>[]> = { crm_stage: stages, crm_lead: leads, crm_activity: activities, crm_booth_scorecard: boothScorecards };

// The opened card is an async server component: it reads AFTER the page function has returned, while the stream renders. So the
// sample tables stay in place until the NEXT screen of this file starts (`prepare`), not just for the page call. Render these
// screens by id (`run.mjs rc-...`); a full run is fine too, the last one leaves its tables behind only until the process ends.
let restoreTables: (() => void) | null = null;
function applyTables(rowsFor: (k: string) => Record<string, unknown>[], keys: string[]) {
  restoreTables?.();
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(tables, k)] as const);
  for (const k of keys) Object.defineProperty(tables, k, { configurable: true, enumerable: true, value: rowsFor(k), writable: true });
  restoreTables = () => {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(tables, k, d);
      else delete (tables as Record<string, unknown>)[k];
    }
    restoreTables = null;
  };
}
async function withLeadData<T>(fn: () => Promise<T>): Promise<T> {
  applyTables((k) => MINE[k] ?? [], [...new Set([...Object.keys(MINE), ...EXTRA])]);
  return fn();
}

const RELEASE = "<style>.lx-app{height:auto!important;min-height:0!important;overflow:visible!important}.lx-main,.lx-content,.lx-page{overflow:visible!important;height:auto!important}</style>";
const VPS = [["d", "desktop"], ["m", "desktop1280"], ["p", "phone"]] as const;
const firstLead = String((leads.find((l) => String(l.first_name ?? "").trim()) ?? leads[0]).id);

type Kind = "intake" | "matters";
const mk = (id: string, title: string, kind: Kind, vp: "desktop" | "desktop1280" | "phone", search: () => Record<string, string>): Screen => ({
  id,
  title,
  designBoard: "none",
  viewport: vp,
  pathname: `/dashboard/${kind}/`,
  shell: "none" as const,
  prepare: () => {
    restoreTables?.();
    resetState();
    state.pathname = `/dashboard/${kind}/`;
  },
  render: async () => {
    const page =
      kind === "intake"
        ? await withLeadData(() => IntakePage({ searchParams: Promise.resolve(search()) }))
        : await (() => {
            restoreTables?.();
            restoreTables = applyMatterData();
            return MattersPage({ searchParams: Promise.resolve(search()) });
          })();
    return <TechShell>{page as unknown as ReactElement}</TechShell>;
  },
  transformHtml: (html: string) => RELEASE + html,
});

export const screens: Screen[] = [
  ...VPS.flatMap(([tag, vp]) => [
    mk(`rc-intake-board-${tag}`, `Intake board with controls (${tag})`, "intake", vp, () => ({ view: "board" })),
    mk(`rc-intake-list-${tag}`, `Intake list with controls (${tag})`, "intake", vp, () => ({ view: "table" })),
    mk(`rc-intake-open-${tag}`, `Intake, opened card (${tag})`, "intake", vp, () => ({ view: "board", open: `lead:${firstLead}` })),
    mk(`rc-matters-board-${tag}`, `Matters board with controls (${tag})`, "matters", vp, () => ({ view: "board" })),
    mk(`rc-matters-list-${tag}`, `Matters list with controls (${tag})`, "matters", vp, () => ({ view: "table" })),
    mk(`rc-matters-open-${tag}`, `Matters, opened card (${tag})`, "matters", vp, () => ({ view: "table", open: `matter:${firstMatterId}` })),
  ]),
];

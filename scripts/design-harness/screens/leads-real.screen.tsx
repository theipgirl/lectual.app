import fs from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import IntakePage from "@/app/dashboard/intake/page";
import { tables } from "../mono-data";
import { activities, boothScorecards, leads, stages } from "../fixtures-leads-real";
import { resetState } from "../fixtures";
import { state } from "../state";
import { OwnerShell } from "../shell";
import { TechShell } from "../mono-shell";
import type { Screen } from "../registry";

/**
 * Item L step 1: the REAL Leads page (/dashboard/intake/, list and board) with RPB's real-shaped data (fixtures-leads-real.ts), in the
 * technician and owner shells at 1440, 1280 and 375. The mono fake client reads `tables`; here they are swapped for the render and put
 * back afterwards (so the other mono screens are untouched), and every read the page makes is counted per table into out/leads-real-reads.json.
 * The shell is released from its fixed height so a full-page screenshot is the whole list.
 */
const EXTRA = ["crm_drip_enrollment", "crm_meeting", "crm_discovery_session", "crm_drip_step", "crm_time_entry", "crm_booth_scorecard"];
const MINE: Record<string, Record<string, unknown>[]> = { crm_stage: stages, crm_lead: leads, crm_activity: activities, crm_booth_scorecard: boothScorecards };

async function withRealData<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const keys = [...new Set([...Object.keys(MINE), ...EXTRA])];
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(tables, k)] as const);
  const reads: Record<string, number> = {};
  for (const k of keys) {
    const rows = MINE[k] ?? [];
    Object.defineProperty(tables, k, { configurable: true, enumerable: true, get: () => ((reads[k] = (reads[k] ?? 0) + 1), rows) });
  }
  try {
    return await fn();
  } finally {
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(tables, k, d);
      else delete (tables as Record<string, unknown>)[k];
    }
    const file = path.resolve(__dirname, "../out/leads-real-reads.json");
    const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    prev[label] = reads;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(prev, null, 1));
  }
}

const RELEASE = "<style>.lx-app{height:auto!important;min-height:0!important;overflow:visible!important}.lx-main,.lx-content,.lx-page{overflow:visible!important;height:auto!important}</style>";
const VPS = [["d", "desktop"], ["m", "desktop"], ["p", "phone"]] as const;
const VIEWS = [["list", {}], ["board", { view: "board" }]] as const;

export const screens: Screen[] = VIEWS.flatMap(([view, search]) =>
  (["tech", "owner"] as const).flatMap((shell) =>
    VPS.map(([vp, viewport]) => ({
      id: `mono-leadsreal-${view}-${shell}-${vp}`,
      title: `Leads ${view} with real-shaped data (${shell}, ${vp})`,
      designBoard: "none",
      viewport,
      pathname: "/dashboard/intake/",
      shell: "none" as const,
      prepare: () => {
        resetState();
        state.pathname = "/dashboard/intake/";
      },
      render: async () => {
        const page = (await withRealData(`${view}-${shell}-${vp}`, () => IntakePage({ searchParams: Promise.resolve(search) }))) as unknown as ReactElement;
        return shell === "owner" ? <OwnerShell>{page}</OwnerShell> : <TechShell>{page}</TechShell>;
      },
      transformHtml: (html: string) => RELEASE + html,
    })),
  ),
);

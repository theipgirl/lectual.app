import type { ReactElement } from "react";
import MattersPage from "@/app/dashboard/matters/page";
import { tables } from "../mono-data";
import { ORG, OWNER_ID, members, resetState } from "../fixtures";
import { state } from "../state";
import { OwnerShell } from "../shell";
import { TechShell } from "../mono-shell";
import type { Screen } from "../registry";

/**
 * M1: the REAL Matters page (/dashboard/matters/) with its Intake / Pre-filing / Post-filing / Matters chips, on a prod-shaped sample:
 * 29 pipeline, 34 pre-filing and 42 post-filing TM matters, 23 BL matters with no stage and 1 LIT. Names are invented. The mono fake
 * client reads `tables`; they are swapped for the render and put back, so the other mono screens are untouched.
 */
const O = ORG.id;
const iso = (d: string) => `2026-${d}`;
const uid = (n: number, p: string) => `${p.repeat(8)}-${p.repeat(4)}-4${p.repeat(3)}-8${p.repeat(3)}-${String(n).padStart(12, "0")}`;

const PIPELINE = ["Potential New Client", "Consult Scheduled", "Consult Held", "Proposal Sent", "Proposal Accepted", "Engagement Letter Sent", "Signed LOE / Deposit Received"];
const PRE = ["Questionnaire Complete", "Clearance Search", "Opinion Letter Sent", "Application Drafting", "Client Review", "Ready to File", "Awaiting Filing Fee", "Payment Plan Active", "Partial Balance Received", "Full Balance Received"];
const POST = [
  "Filed, Awaiting Examination", "Office Action Received", "Office Action Response Drafting", "Office Action Response Filed", "Suspension Notice", "Approved for Publication",
  "Published for Opposition", "Opposition Period Open", "Notice of Allowance", "Statement of Use Due", "Statement of Use Filed", "Awaiting Registration", "Registered",
  "Section 8 Due", "Section 8 Filed", "Renewal Due", "Renewal Filed", "Waiting on Client Specimen", "Extension Requested", "Abandoned", "Closed, No Longer Moving Forward", "Cancelled",
];

type StageRow = Record<string, unknown>;
const stageRows: StageRow[] = [];
let order = 0;
const addStages = (labels: string[], phase: string, prefix: string, closedFrom = Infinity) =>
  labels.map((label, i) => {
    order += 1;
    const row: StageRow = {
      id: uid(order, prefix), org_id: O, code: `${prefix}${i + 1}`, label: `${order}. ${label}`, order_index: order, is_open: i < closedFrom, phase,
      waiting_on: i % 5 === 3 ? "uspto" : i % 7 === 5 ? "client" : "firm", created_at: iso("01-02T12:00:00Z"), updated_at: iso("01-02T12:00:00Z"),
    };
    stageRows.push(row);
    return row;
  });
const pipeStages = addStages(PIPELINE, "pipeline", "a");
const preStages = addStages(PRE, "pre_filing", "b");
const postStages = addStages(POST, "post_filing", "c", 19);

const OWNERS = ["Ada Lovell", "Ben Okafor", "Cleo Brandt", "Dev Ramanathan", "Elin Voss", "Farid Haddad", "Gwen Tanaka", "Hugo Marsh", "Ivy Castellan", "Jonas Pike"];
const MARKS = ["LUMEN", "HALCYON", "NORTHFIELD", "OAT", "BLUE HERON", "SALT", "CRUMB", "PAPER MOON", "COPPER KETTLE", "MERIDIAN", "FOXGLOVE", "TIDEWELL", "ASHLAR", "WILLOW & WREN", "KITE", "LANTERN", "SPARROW", "QUILL", "EMBER", "BRAMBLE"];

const matterRows: StageRow[] = [];
let mn = 0;
const addMatter = (type: string, stage: StageRow | null, status = "open") => {
  mn += 1;
  const owner = OWNERS[mn % OWNERS.length];
  const mark = `${MARKS[mn % MARKS.length]} ${Math.floor(mn / MARKS.length) + 1}`;
  const memberIds = [OWNER_ID, ...members.map((m) => m.userId)];
  matterRows.push({
    id: uid(mn, "d"), org_id: O, matter_number: `${type}-${1000 + mn}`, title: type === "BL" ? `${owner.split(" ")[1]} contract review` : mark, mark_text: type === "TM" ? mark : null,
    owner_name: owner, type, status, stage_id: stage ? stage.id : null, stage_entered_at: stage ? iso(`${String(10 - (mn % 3)).padStart(2, "0")}-${String(1 + (mn % 27)).padStart(2, "0")}T14:00:00Z`) : null,
    assigned_to: mn % 6 === 0 ? null : memberIds[mn % memberIds.length], opened_at: iso("05-15T14:00:00Z"), created_at: iso("05-15T14:00:00Z"), updated_at: iso("11-05T14:00:00Z"), lead_id: null,
    package_name: "Enhanced", referral_source: "Referral", notes: null, international_classes: [25], goods_services: null, filing_basis: "1a", filing_date: null, serial_number: null,
    registration_number: null, registration_date: null, examining_attorney: null, uspto_status: null, uspto_status_as_of: null, lawmatics_id: null, lawmatics_synced_at: null, practice_pipeline: null,
  });
};
// Spread the matters over their phase's stages, uneven, leaving a few stages empty (as a real docket does).
const spread = (n: number, pool: StageRow[], skip: number[]) => {
  const usable = pool.filter((_, i) => !skip.includes(i));
  for (let i = 0; i < n; i++) addMatter("TM", usable[(i * 7 + (i % 3)) % usable.length]);
};
spread(29, pipeStages, [4]);
spread(34, preStages, [3, 7]);
spread(42, postStages.slice(0, 19), [13, 14, 15, 16]);
for (let i = 0; i < 23; i++) addMatter("BL", null);
addMatter("LIT", null);

const MINE: Record<string, StageRow[]> = { crm_matter_stage: stageRows, crm_matter: matterRows };
const EXTRA = ["crm_drip_enrollment", "crm_meeting", "crm_calendar_event", "client_proposal", "crm_lead", "queue_card_event"];

async function withMatterData<T>(fn: () => Promise<T>): Promise<T> {
  const keys = [...new Set([...Object.keys(MINE), ...EXTRA])];
  const saved = keys.map((k) => [k, Object.getOwnPropertyDescriptor(tables, k)] as const);
  for (const k of keys) {
    const rows = MINE[k] ?? (tables as Record<string, StageRow[]>)[k] ?? [];
    Object.defineProperty(tables, k, { configurable: true, enumerable: true, value: rows, writable: true });
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
const VIEWS = [["list", {}], ["board", { view: "board" }]] as const;
const GROUPS = [["pre", {}], ["intake", { group: "intake" }], ["post", { group: "post" }], ["other", { group: "other" }], ["all", { group: "all" }]] as const;

const mk = (id: string, title: string, shell: "tech" | "owner", viewport: "desktop" | "phone", search: Record<string, string>): Screen => ({
  id,
  title,
  designBoard: "none",
  viewport,
  pathname: "/dashboard/matters/",
  shell: "none" as const,
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/matters/";
  },
  render: async () => {
    const page = (await withMatterData(() => MattersPage({ searchParams: Promise.resolve(search) }))) as unknown as ReactElement;
    return shell === "owner" ? <OwnerShell>{page}</OwnerShell> : <TechShell>{page}</TechShell>;
  },
  transformHtml: (html: string) => RELEASE + html,
});

export const screens: Screen[] = [
  ...VIEWS.flatMap(([view, vsearch]) =>
    GROUPS.flatMap(([g, gsearch]) =>
      ((g === "pre" ? ["tech", "owner"] : ["tech"]) as Array<"tech" | "owner">).flatMap((shell) =>
        (["desktop", "phone"] as const).map((vp) => mk(`m1-${view}-${g}-${shell}-${vp === "desktop" ? "d" : "p"}`, `Matters ${view}, ${g} group (${shell}, ${vp})`, shell, vp, { ...vsearch, ...gsearch })),
      ),
    ),
  ),
];

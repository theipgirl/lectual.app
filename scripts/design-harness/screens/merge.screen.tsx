import type { ReactElement } from "react";
import MergeLeadsPage from "@/app/dashboard/intake/merge/page";
import LeadPage from "@/app/dashboard/leads/[id]/page";
import { L, leads, tables } from "../mono-data";
import { resetState } from "../fixtures";
import { state } from "../state";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

/**
 * M5: the merge screen, and the kept lead's page after a merged lead's link was followed (the quiet line and the merged
 * lead's history on the timeline). Real pages over mono-data, with a live duplicate of Maya and a lead already merged into her.
 */
const DUPE = "00000000-0000-4000-8000-0000000000d1";
const MERGED = "00000000-0000-4000-8000-0000000000d2";
const maya = leads.find((l) => l.id === L.maya)!;
const extraLeads = [
  { ...maya, id: DUPE, email: "maya.chen.personal.long.address@gmail.example", phone: null, business_name: "Crumb and Company Bakery Collective", created_at: "2026-09-01T14:00:00Z", merged_into_id: null, assigned_to: null },
  { ...maya, id: MERGED, email: "maya@old-crumb.example", merged_into_id: L.maya },
];
const extraActivity = [
  { id: "00000000-0000-4000-8000-0000000000a1", org_id: maya.org_id, type: "note", created_at: "2026-10-01T15:00:00Z", actor_type: "user", actor_id: null, lead_id: MERGED, matter_id: null, payload: { note: "Called from the old number; wants to trademark the bakery name." } },
  { id: "00000000-0000-4000-8000-0000000000a2", org_id: maya.org_id, type: "lead_merged", created_at: "2026-11-10T09:00:00Z", actor_type: "user", actor_id: null, lead_id: L.maya, matter_id: null, payload: { role: "keeper", fields: ["email"], counts: { tasks: 1, meetings: 2 } } },
];

async function withMergeData<T>(fn: () => Promise<T>): Promise<T> {
  const savedLeads = tables.crm_lead;
  const savedAct = tables.crm_activity;
  tables.crm_lead = [...savedLeads, ...extraLeads];
  tables.crm_activity = [...(savedAct ?? []), ...extraActivity];
  try {
    return await fn();
  } finally {
    tables.crm_lead = savedLeads;
    tables.crm_activity = savedAct;
  }
}

const RELEASE = "<style>.lx-app{height:auto!important;min-height:0!important;overflow:visible!important}.lx-main,.lx-content,.lx-page{overflow:visible!important;height:auto!important}</style>";
const VPS = [["d", "desktop"], ["m", "desktop1280"], ["p", "phone"]] as const;

const pages: Array<{ key: string; title: string; pathname: string; render: () => Promise<ReactElement> }> = [
  { key: "screen", title: "Merge two leads", pathname: "/dashboard/intake/", render: () => MergeLeadsPage({ searchParams: Promise.resolve({ a: L.maya, b: DUPE }) }) as unknown as Promise<ReactElement> },
  { key: "keeper", title: "Kept lead after following a merged lead's link", pathname: `/dashboard/leads/${L.maya}/`, render: () => LeadPage({ params: Promise.resolve({ id: L.maya }), searchParams: Promise.resolve({ from: MERGED }) }) as unknown as Promise<ReactElement> },
];

export const screens: Screen[] = pages.flatMap((p) =>
  VPS.map(([tag, viewport]) => ({
    id: `m5-${p.key}-${tag}`,
    title: `${p.title} (${viewport})`,
    designBoard: "none",
    viewport,
    pathname: p.pathname,
    shell: "none" as const,
    prepare: () => {
      resetState();
      state.pathname = p.pathname;
    },
    render: async () => <OwnerShell>{await withMergeData(p.render)}</OwnerShell>,
    transformHtml: (html: string) => html.replace("</head>", `${RELEASE}</head>`),
  })),
);

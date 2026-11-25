// S2b fixtures for the full consult prep: invented names, no network, no model.

import type { StructuredCall } from "@/lib/ai/claude";
import type { BriefFacts } from "@/lib/consult-prep/brief";
import type { FirmForBrief } from "@/lib/consult-prep/full";
import type { Judgment, RoutePlan } from "@/lib/consult-prep/judge/schemas";
import { PACKAGES } from "./judge/fixtures";

export const lead = { id: "l1", firstName: "Dana", lastName: "Ruiz", businessName: "Sankofa Brewing", email: "dana@client.example", phone: "555-0100", practiceArea: "Trademark", markText: "SANKOFA", referralSource: "Booth", referralDetail: "UGW 2026", stage: "Consultation Scheduled", lawmaticsId: null };
export const FACTS: BriefFacts = {
  lead,
  startsAt: "2026-11-25T19:00:00.000Z",
  joinUrl: null,
  preparedAt: "2026-11-24T19:10:00.000Z",
  tz: "America/New_York",
  lawmatics: { state: "not-linked" },
  answers: { state: "ok", blocks: [] },
  files: { state: "ok", files: [], more: 0 },
  mail: { state: "ok", summary: { received: 0, sent: 0, newestReceived: null, subjects: [], withheld: 0 } },
  meetings: { state: "ok", meetings: [] },
} as BriefFacts;

export const FIRM: FirmForBrief = { name: "Harbor IP, PLLC", slug: "harbor", timeZone: "America/New_York", packages: PACKAGES };

export const PLAN: RoutePlan = {
  route: "TRADEMARK",
  routeReason: "The client wants to register the brewery name.",
  secondaryMatter: null,
  markStatus: "confirmed",
  mark: "SANKOFA",
  stem: "sankofa",
  variants: [],
  likelyClasses: [{ classNumber: 32, rationale: "Beer." }],
};

export const JUDGMENT: Judgment = {
  clientSnapshot: "Dana runs Sankofa Brewing, a craft brewery. The model says it costs $9,999.",
  markSubmitted: "SANKOFA — word mark for beer.",
  natureOfMatter: "Register the brewery name before expanding.",
  flagsToProbe: ["Who owns the name?"],
  questions: ["When did you first sell beer under SANKOFA?", "Any logo?", "Other products planned?"],
  trademark: {
    likelyClasses: [{ classNumber: 32, rationale: "Beer and brewed beverages." }],
    noClassesReason: null,
    riskRead: "One close mark in Class 32. Leaning yellow, for the attorney to confirm.",
    package: {
      choice: "Enhanced",
      reasoning: "One mark, one class now, room to grow. Price is $1 per class, the model says.",
      classesToFileNow: [32],
      priorityClass: 32,
      pending: null,
      pdfMarks: [{ mark: "SANKOFA", categories: [{ text: "Beer and brewed beverages (Class 32)", classNumber: 32, priority: true }] }],
    },
  },
  general: null,
  dispute: null,
};

/** A model that answers the route call, then the judgment call, and records each request. */
export function scriptedLlm(...outputs: Array<unknown | Error>) {
  const calls: Array<{ system: string; user: string; agent?: string }> = [];
  const llm = (async (req) => {
    calls.push({ system: req.system, user: req.user, agent: req.agent });
    const out = outputs[calls.length - 1];
    if (out instanceof Error) throw out;
    return { output: out, model: "claude-sonnet-5-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.001 };
  }) as StructuredCall;
  return { llm, calls };
}

export const hit = { hits: { totalValue: 1, hits: [{ source: { id: "90000001", wordmark: "SANKOFA", alive: true, internationalClass: ["032"], ownerName: ["Other Brewer LLC"], goodsAndServices: ["Beer"] } }] } };

/** USPTO: every search answers one hit; every mark image is missing. `down` makes the search fail. */
export function usptoFetch(opts: { down?: boolean } = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (url: unknown) => {
    urls.push(String(url));
    if (String(url).includes("tmcms-docs")) return new Response("", { status: 404 });
    if (opts.down) return new Response("", { status: 503 });
    return new Response(JSON.stringify(hit), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, urls };
}

export const PDF_BYTES = Buffer.from("%PDF-1.7 fake");


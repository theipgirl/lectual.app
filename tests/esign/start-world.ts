import { vi } from "vitest";
import { runStartAdobeSigning, type StartDeps, type StartInput } from "@/lib/esign/start-core";
import type { AdobeAccessResult } from "@/lib/esign/adobe-connection";
import { browserSigning } from "../proposals/signing-world";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe/loe-fixtures";
import { esignDb, esignOpenImpl, fakeAdobe, json, type Row } from "./esign-db";

export const TOKEN = "T".repeat(43);
export const NOW = new Date("2026-10-20T15:00:00.000Z");
export const ACCESS_POINT = "https://api.na1.adobesign.com/";
export const ESIGN_URL = "https://secure.na1.adobesign.com/public/apiesign?pid=SECRET-SIGNING-LINK";

/** A fake world: one live letter proposal (the made-up client "Callum Ferreira", entity "Larkmoor Inc."). */
export function startWorld(over: { proposal?: Row; requests?: Row[]; rpcImpl?: Parameters<typeof esignDb>[1] extends infer O ? (O extends { rpcImpl?: infer F } ? F : never) : never } = {}) {
  return esignDb(
    {
      client_proposal: [
        {
          id: "prop-2",
          org_id: "org-1",
          family_id: "prop-1",
          version: 2,
          public_token: TOKEN,
          title: "Trademark Proposal",
          client_name: "Callum Ferreira",
          client_email: "callum@example.com",
          status: "sent",
          content: withLoe(twoBrandPerMark()),
          expires_on: "2026-11-01",
          pay_url: "https://app.lawmatics.com/forms/share/abc",
          accepted_at: null,
          accepted_selection: null,
          accepted_snapshot: null,
          ...over.proposal,
        },
      ],
      crm_org: [{ id: "org-1", name: "RPB Law Firm", slug: "rpb-law", modules: ["proposals"] }],
      crm_org_profile: [{ org_id: "org-1", time_zone: "America/New_York" }],
      client_proposal_event: [],
      client_proposal_esign_request: over.requests ?? [],
    },
    { rpcImpl: over.rpcImpl ?? esignOpenImpl },
  );
}

export function happyAdobe(over: Record<string, (c: import("./esign-db").FetchCall) => Response | Promise<Response>> = {}) {
  return fakeAdobe({
    "POST /transientDocuments": () => json({ transientDocumentId: "tdoc-1" }, 201),
    "POST /agreements": () => json({ id: "agr-1" }, 201),
    "POST /webhooks": () => json({ id: "wh-1" }, 201),
    "GET /signingUrls": () => json({ signingUrlSetInfos: [{ signingUrls: [{ email: "callum@example.com", esignUrl: ESIGN_URL }] }] }),
    "PUT /state": () => new Response(null, { status: 204 }),
    // GET /agreements/{id}: the re-read before an open request is cancelled or replaced.
    "GET /agreements/[^/]+": () => json({ id: "agr-1", status: "OUT_FOR_SIGNATURE" }),
    ...over,
  });
}

export function deps(world: ReturnType<typeof startWorld>, adobe: ReturnType<typeof fakeAdobe>, over: Partial<StartDeps> = {}): StartDeps & { markReauth: ReturnType<typeof vi.fn> } {
  const markReauth = vi.fn(async () => {});
  const access = async (): Promise<AdobeAccessResult> => ({ kind: "ok", connectionId: "conn-1", accessPoint: ACCESS_POINT, accessToken: "ACCESS-TOKEN", refreshToken: "REFRESH" });
  return {
    now: NOW,
    switchOn: true,
    db: world.db,
    access,
    markReauth,
    fetchImpl: adobe.fetchImpl,
    renderPdf: async () => new TextEncoder().encode("%PDF-1.7 fake"),
    letterCurrent: async () => "current",
    linkOrigin: async () => "https://app.example.com",
    webhookUrl: "https://app.example.com/api/esign/webhook/",
    sleep: async () => {},
    ...over,
  } as StartDeps & { markReauth: ReturnType<typeof vi.fn> };
}

/** What the page sends: the real page pipeline over the same read, the typed name "Jordan Sample". */
export async function pageInput(world: ReturnType<typeof startWorld>, over: { typedName?: string; selection?: Record<string, boolean>; details?: unknown } = {}): Promise<StartInput & { text: string }> {
  const typedName = over.typedName ?? "Jordan Sample";
  const b = await browserSigning(world.db as never, { typedName: typedName.length >= 2 ? typedName : "Jordan Sample", selection: over.selection, readAt: NOW });
  return {
    token: TOKEN,
    selection: b.selection,
    clientClasses: undefined,
    details: over.details ?? TEST_DETAILS,
    typedName,
    fingerprint: b.signing.fingerprint,
    text: b.text,
  };
}

export async function start(world: ReturnType<typeof startWorld>, adobe: ReturnType<typeof fakeAdobe>, input: StartInput, over: Partial<StartDeps> = {}) {
  const d = deps(world, adobe, over);
  return { result: await runStartAdobeSigning(input, d), deps: d };
}

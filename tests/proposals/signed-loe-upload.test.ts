import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { runAcceptanceFollowups } from "@/lib/proposals/accept-followups";
import { runSignedLoeUpload } from "@/lib/proposals/loe-signed-upload";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import type { MultipartFetchLike } from "@/lib/lawmatics/writes";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { acceptedSnapshot } from "./accepted-fixture";
import { fakeFollowupDb, type Row } from "./followup-db";
import { signedTrademark, FINGERPRINT } from "../loe/signed-fixtures";
import { paragraphText, squash } from "../loe/full-letter-fixture";

vi.mock("next/server", () => ({ after: () => {} }));

const PID = "p1";
const ORG = "org-1";

function tablesFor(snapshot: AcceptedSnapshot, extra: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    client_proposal: [{ id: PID, org_id: ORG, family_id: "f1", status: "accepted", client_name: "Sevetri Wilson", client_email: "sevetri@example.com", lead_id: null, matter_id: "m1", accepted_snapshot: snapshot }],
    client_proposal_setting: [{ org_id: ORG, approver_user_ids: ["u1"] }],
    crm_org_member: [{ org_id: ORG, user_id: "u1", role: "owner" }],
    crm_matter: [{ id: "m1", org_id: ORG, lawmatics_id: "LM-77" }],
    crm_lead: [],
    crm_org: [{ id: ORG, name: "RPB Law Firm" }],
    crm_org_profile: [{ org_id: ORG, display_name: "RPB Law", time_zone: "America/New_York" }],
    client_proposal_event: [],
    crm_notification: [],
    ...extra,
  };
}

type Sent = { url: string; form: FormData };
function fakeUpload(status = 200) {
  const sent: Sent[] = [];
  const fetchImpl: MultipartFetchLike = async (url, init) => {
    sent.push({ url: String(url), form: (init as { body: FormData }).body });
    return { ok: status >= 200 && status < 300, status } as Awaited<ReturnType<MultipartFetchLike>>;
  };
  return { sent, fetchImpl };
}

const steps = (tables: Record<string, Row[]>) => tables.client_proposal_event.map((e) => `${(e.payload as Row).step}:${(e.payload as Row).outcome}`);
const filed = (tables: Record<string, Row[]>) => tables.client_proposal_event.filter((e) => (e.payload as Row).step === "signed_loe_upload");

async function pdfTextOf(form: FormData): Promise<string> {
  const file = form.get("file") as Blob;
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const { text } = await extractText(pdf, { mergePages: true });
  return squash(text.replace(/Page \d+ of \d+/g, " "));
}

const run = (db: Parameters<typeof runAcceptanceFollowups>[0], uploadFetch: MultipartFetchLike, getToken: () => Promise<string | null> = async () => "FIRM-TOKEN") =>
  runAcceptanceFollowups(db, { proposalId: PID, orgId: ORG }, { getToken, uploadFetch, fetchImpl: async () => ({ ok: true, status: 200 }) as never });

describe("P3: the signed letter is filed in Lawmatics", () => {
  let snapshot: AcceptedSnapshot;
  beforeEach(() => {
    snapshot = signedTrademark();
  });

  it("uploads exactly once per signing: a multipart POST of the signed PDF to the matter's Engagement folder", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    const up = fakeUpload();
    await run(db, up.fetchImpl);
    expect(up.sent).toHaveLength(1);
    expect(up.sent[0].url).toMatch(/\/files$/);
    expect(up.sent[0].form.get("documentable_type")).toBe("matter");
    expect(up.sent[0].form.get("documentable_id")).toBe("LM-77");
    expect(up.sent[0].form.get("path[]")).toBe("Engagement");
    const file = up.sent[0].form.get("file") as File;
    expect(file.type).toBe("application/pdf");
    expect(file.name).toBe("Sevetri-Wilson-engagement-letter-signed-2026-11-12.pdf");
    expect(filed(tables).map((e) => (e.payload as Row).outcome)).toEqual(["uploaded"]);
    expect(filed(tables)[0].actor).toBe("system");

    // The file's text is the signed letter (same text P2 checks).
    const text = await pdfTextOf(up.sent[0].form);
    const letter = rebuildSignedLetter(snapshot, "America/New_York")!;
    for (const b of letter.blocks) expect(text).toContain(squash(paragraphText(b)));
    expect(text).toContain("Sevetri Wilson");
    expect(text).toContain(FINGERPRINT);
    expect(text.startsWith("RPB Law")).toBe(true);

    // A second run finds `uploaded` and does nothing.
    await run(db, up.fetchImpl);
    expect(up.sent).toHaveLength(1);
    expect(filed(tables)).toHaveLength(1);
  });

  it("a failed upload is a `failed` step event, leaves the acceptance row alone, and is tried again on the next run", async () => {
    const t = tablesFor(snapshot);
    const before = JSON.stringify(t.client_proposal);
    const { db, tables } = fakeFollowupDb(t);
    const bad = fakeUpload(422);
    await run(db, bad.fetchImpl);
    expect(filed(tables)[0].payload).toMatchObject({ step: "signed_loe_upload", outcome: "failed", reason: "HTTP 422" });
    expect(JSON.stringify(tables.client_proposal)).toBe(before);
    expect(tables.client_proposal[0].status).toBe("accepted");
    const good = fakeUpload(200);
    await run(db, good.fetchImpl);
    expect(good.sent).toHaveLength(1);
    expect(filed(tables).map((e) => (e.payload as Row).outcome)).toEqual(["failed", "uploaded"]);
  });

  it("a firm with no active Lawmatics connection is skipped with a reason, and no request is made", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    const up = fakeUpload();
    await run(db, up.fetchImpl, async () => null);
    expect(up.sent).toHaveLength(0);
    expect(filed(tables)[0].payload).toMatchObject({ outcome: "skipped", reason: "Lawmatics isn't connected, so the signed letter wasn't filed there." });
  });

  it("no record, or more than one, is blocked with the target sentences", async () => {
    const none = fakeFollowupDb(tablesFor(snapshot, { crm_matter: [] }));
    const up = fakeUpload();
    await run(none.db, up.fetchImpl);
    expect(filed(none.tables)[0].payload).toMatchObject({ outcome: "blocked", reason: "No Lawmatics record was found for this client, so the signed letter wasn't filed." });

    // No matter or lead id: the client's address matches two of the firm's leads.
    const t = tablesFor(snapshot, { crm_matter: [], crm_lead: [{ id: "l1", org_id: ORG, email: "sevetri@example.com", lawmatics_id: "A" }, { id: "l2", org_id: ORG, email: "SEVETRI@example.com", lawmatics_id: "B" }] });
    (t.client_proposal[0] as Row).matter_id = null;
    const many = fakeFollowupDb(t);
    await run(many.db, up.fetchImpl);
    expect(filed(many.tables)[0].payload).toMatchObject({ outcome: "blocked", reason: "More than one Lawmatics record matches this client, so the signed letter wasn't filed." });
    expect(up.sent).toHaveLength(0);
  });

  it("an unreadable matter lookup is `failed`, never `blocked` or `uploaded`", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot), { failSelect: (table) => table === "crm_matter" });
    await run(db, fakeUpload().fetchImpl);
    expect(filed(tables)[0].payload).toMatchObject({ outcome: "failed" });
  });

  it("a schema 1 (unsigned) snapshot never runs the step", async () => {
    const plain = acceptedSnapshot({ classes: 2 });
    const { db, tables } = fakeFollowupDb(tablesFor(plain));
    const up = fakeUpload();
    await run(db, up.fetchImpl);
    expect(up.sent).toHaveLength(0);
    expect(steps(tables).some((s) => s.startsWith("signed_loe_upload"))).toBe(false);
  });

  it("a reset starts a fresh round, so a second signing uploads again", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    const up = fakeUpload();
    await run(db, up.fetchImpl);
    expect(up.sent).toHaveLength(1);
    // lectual 0101: a `reset` event after the first round's steps.
    tables.client_proposal_event.push({ id: "reset-1", proposal_id: PID, org_id: ORG, type: "reset", actor: "staff", created_at: new Date(Date.UTC(2026, 10, 12, 20, 0, 0)).toISOString(), payload: {} });
    await run(db, up.fetchImpl);
    expect(up.sent).toHaveLength(2);
  });

  it("the token is the firm's own: asked for the proposal's org, and the fetch carries it as the bearer", async () => {
    const { db } = fakeFollowupDb(tablesFor(snapshot));
    const asked: string[] = [];
    let auth = "";
    const fetchImpl: MultipartFetchLike = async (_u, init) => {
      auth = String((init as { headers: Record<string, string> }).headers.Authorization);
      return { ok: true, status: 200 } as never;
    };
    await runAcceptanceFollowups(db, { proposalId: PID, orgId: ORG }, { getToken: async (_d, orgId) => (asked.push(orgId), "ORG-1-TOKEN"), uploadFetch: fetchImpl, fetchImpl: async () => ({ ok: true, status: 200 }) as never });
    expect(asked.every((o) => o === ORG)).toBe(true);
    expect(auth).toBe("Bearer ORG-1-TOKEN");
  });

  it("a letter that cannot be rebuilt files nothing (blocked, no request)", async () => {
    const calls: string[] = [];
    const result = await runSignedLoeUpload(null, {
      token: async () => (calls.push("token"), { status: "ok", token: "t" }),
      target: async () => (calls.push("target"), { ok: true, lawmaticsId: "1" }),
      buildPdf: async () => new Uint8Array(),
      upload: async () => (calls.push("upload"), { ok: true }),
      fileName: "x.pdf",
    });
    expect(result.outcome).toBe("blocked");
    expect(calls).toEqual([]);
  });

  it("a PDF that cannot be built is `failed` with a fixed sentence and nothing is uploaded", async () => {
    const letter = rebuildSignedLetter(snapshot, "UTC")!;
    let uploaded = false;
    const result = await runSignedLoeUpload(letter, {
      token: async () => ({ status: "ok", token: "t" }),
      target: async () => ({ ok: true, lawmaticsId: "1" }),
      buildPdf: async () => {
        throw new Error("font exploded with Sevetri's address");
      },
      upload: async () => ((uploaded = true), { ok: true }),
      fileName: "x.pdf",
    });
    expect(result).toEqual({ outcome: "failed", reason: "The signed letter couldn't be built, so nothing was filed." });
    expect(uploaded).toBe(false);
  });

  it("nothing of the letter, the address or the file is on the step event or in a log", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    await run(db, fakeUpload(500).fetchImpl);
    const wire = JSON.stringify(tables.client_proposal_event) + JSON.stringify(spy.mock.calls) + JSON.stringify(log.mock.calls);
    for (const never of ["100 Example Street", "Miami", "Dear ", "%PDF", FINGERPRINT, "Sevetri's"]) expect(wire).not.toContain(never);
    spy.mockRestore();
    log.mockRestore();
  });
});

/* ── Try again (signed in): `retryProposalStep` runs the same core with the signed-in token ── */

describe("Try again uploads and writes `uploaded`", () => {
  async function setup(events: Array<Record<string, unknown>>) {
    vi.resetModules();
    const snapshot = signedTrademark();
    const { acceptedProposalRow } = await import("../loe/signed-fixtures");
    const proposal = acceptedProposalRow(snapshot);
    const recorded: Array<Record<string, unknown>> = [];
    const all = [...events];
    const uploadMatterFile = vi.fn<(token: string, file: { matterId: string; fileName: string; mime: string; bytes: Uint8Array }) => Promise<{ ok: true }>>(async () => ({ ok: true }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => ({})) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalRow: vi.fn(async () => proposal),
      listProposalStepEvents: vi.fn(async () => ({ ok: true, events: [...all].reverse() })),
      recordProposalStep: vi.fn(async (_p: unknown, payload: Record<string, unknown>) => {
        recorded.push(payload);
        all.push({ proposal_id: proposal.id, type: "edited", actor: "staff", actor_user_id: "u1", created_at: new Date(Date.UTC(2026, 10, 12, 21, 0, all.length)).toISOString(), payload });
        return true;
      }),
      getProposalSettings: vi.fn(async () => ({ pricing: {} })),
    }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => true) }));
    vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
    vi.doMock("@/lib/documents/generate", () => ({ generateTrademarkLoe: vi.fn() }));
    vi.doMock("@/lib/documents/store", () => ({ listDraftsForProposal: vi.fn(async () => []) }));
    vi.doMock("@/lib/loe/staff-firm", () => ({ loadStaffFirmFacts: vi.fn(async () => ({ status: "ok", displayName: "RPB Law", timeZone: "America/New_York" })) }));
    vi.doMock("@/lib/proposals/lawmatics-access", async () => {
      const actual = await vi.importActual<typeof import("@/lib/proposals/lawmatics-access")>("@/lib/proposals/lawmatics-access");
      return { ...actual, signedInLawmaticsToken: vi.fn(async () => ({ status: "ok", token: "SIGNED-IN-TOKEN" })), resolveProposalMatter: vi.fn() };
    });
    vi.doMock("@/lib/lawmatics/writes", () => ({ uploadMatterFile, setProspectCustomFields: vi.fn() }));
    vi.doMock("@/lib/proposals/accept-followups", () => ({
      addAcceptanceNote: vi.fn(),
      resolveNoteTarget: vi.fn(async () => ({ ok: true, notableType: "Prospect", notableId: "LM-77" })),
    }));
    vi.doMock("@/lib/proposals/loe-upload", () => ({ retryLoeFileUpload: vi.fn() }));
    const flow = await import("@/lib/proposals/paid-flow");
    return { flow, recorded, uploadMatterFile, proposal };
  }

  const failedEvent = (proposalId: string) => ({
    proposal_id: proposalId,
    type: "edited",
    actor: "system",
    actor_user_id: null,
    created_at: "2026-11-12T19:15:00.000Z",
    payload: { step: "signed_loe_upload", outcome: "failed", reason: "HTTP 422" },
  });

  it("a failed filing is uploaded again without a paid mark, and the card's next read says `uploaded`", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const { flow, recorded, uploadMatterFile } = await setup([failedEvent(id)]);
    const r = await flow.retryProposalStep(id, "signed_loe_upload");
    expect(r.ok).toBe(true);
    expect(uploadMatterFile).toHaveBeenCalledTimes(1);
    const [token, file] = uploadMatterFile.mock.calls[0];
    expect(token).toBe("SIGNED-IN-TOKEN");
    expect(file.matterId).toBe("LM-77");
    expect(file.mime).toBe("application/pdf");
    expect(Buffer.from(file.bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect(recorded).toEqual([{ step: "signed_loe_upload", outcome: "uploaded" }]);

    // Already filed: a second Try again says so and uploads nothing.
    const again = await flow.retryProposalStep(id, "signed_loe_upload");
    expect(again.ok && again.notes).toEqual(["The signed engagement letter is already filed in Lawmatics."]);
    expect(uploadMatterFile).toHaveBeenCalledTimes(1);
  });

  it("every other retry still needs the paid mark", async () => {
    const id = "44444444-4444-4444-8444-444444444444";
    const { flow } = await setup([]);
    expect(await flow.retryProposalStep(id, "loe_draft")).toEqual({ ok: false, error: "Mark the proposal paid first." });
  });
});

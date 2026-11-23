import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: () => {} }));

import { runAcceptanceFollowups, type FollowupDeps } from "@/lib/proposals/accept-followups";
import { runSignedLoeFile, filingStoreFor, type FilingStore } from "@/lib/proposals/signed-loe-file";
import { copyMailGate, runSignedCopyEmail } from "@/lib/proposals/signed-copy-email";
import { STEP_TEXT } from "@/lib/proposals/step-text";
import type { InternalMail, InternalMailResult } from "@/lib/mail/internal-mail";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { fakeFollowupDb, type Row } from "./followup-db";
import { signedTrademark } from "../loe/signed-fixtures";
import { REQUEST_ID, SENT_TO, evidenceFor, linkSnapshot } from "../loe/email-signing/evidence-fixtures";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FROM = "Sample Firm <signing@firm.example.org>";
const ON = { LOE_EMAIL_SIGNING: "on", RESEND_API_KEY: "re_test_key", FIRM_CLIENT_MAIL_FROM: JSON.stringify({ [ORG]: FROM }) };
const OFF = { ...ON, LOE_EMAIL_SIGNING: "off" };

function setup(snapshot: AcceptedSnapshot, over: { matterId?: string | null; leadId?: string | null; clientEmail?: string; reset?: boolean; failInsertOn?: string } = {}) {
  const e = evidenceFor(snapshot, { request: { proposal_id: "p1", org_id: ORG } });
  const tables: Record<string, Row[]> = {
    client_proposal: [
      { id: "p1", org_id: ORG, family_id: "f1", status: "accepted", client_name: "Sample Client", client_email: over.clientEmail ?? "changed-later@example.com", lead_id: over.leadId ?? null, matter_id: over.matterId === undefined ? "m1" : over.matterId, accepted_snapshot: snapshot },
    ],
    client_proposal_setting: [{ org_id: ORG, approver_user_ids: ["u1"] }],
    crm_org_member: [{ org_id: ORG, user_id: "u1", role: "owner" }],
    crm_matter: [{ id: "m1", org_id: ORG, lawmatics_id: "LM-77" }],
    crm_lead: [],
    crm_org: [{ id: ORG, name: "Sample Firm", slug: "sample" }],
    crm_org_profile: [{ org_id: ORG, display_name: "Sample Firm", time_zone: "America/New_York" }],
    client_proposal_event: over.reset ? [{ proposal_id: "p1", org_id: ORG, type: "reset", created_at: "2026-11-01T00:00:00.000Z", payload: {} }] : [],
    crm_notification: [],
    crm_file: [],
    crm_activity: [],
    client_proposal_signing_request: [{ ...e.request }],
    client_proposal_signing_event: e.events.map((x) => ({ ...x, org_id: ORG, request_id: e.request.id })),
  };
  const { db } = fakeFollowupDb(tables, { failInsert: (table) => (over.failInsertOn === table ? "error" : null) });
  const uploads: Array<{ path: string; bytes: Uint8Array; opts: unknown }> = [];
  const removed: string[] = [];
  (db as unknown as Record<string, unknown>).storage = {
    from: () => ({
      upload: async (path: string, bytes: Uint8Array, opts: unknown) => {
        uploads.push({ path, bytes, opts });
        return { error: null };
      },
      remove: async (paths: string[]) => {
        removed.push(...paths);
        return { error: null };
      },
    }),
  };
  const mails: InternalMail[] = [];
  const deliverMail = vi.fn(async (m: InternalMail): Promise<InternalMailResult> => {
    mails.push(m);
    return { status: "sent" };
  });
  const base: FollowupDeps = { getToken: async () => "FIRM-TOKEN", uploadFetch: async () => ({ ok: true, status: 200 }) as never, fetchImpl: async () => ({ ok: true, status: 200 }) as never, newFileId: () => "ffffffff-0000-4000-8000-000000000001" };
  const run = (deps: FollowupDeps = {}) => runAcceptanceFollowups(db as never, { proposalId: "p1", orgId: ORG }, { ...base, copyEnv: ON, deliverMail, ...deps });
  const steps = (step: string) => tables.client_proposal_event.filter((x) => (x.payload as Row | undefined)?.step === step).map((x) => (x.payload as Row).outcome);
  return { tables, run, steps, uploads, removed, mails, deliverMail };
}

describe("signed_copy_email", () => {
  it("emails the signed copy to the sent event's address, with the snapshotted words, the verified PDF and a per-round key", async () => {
    const s = setup(linkSnapshot());
    await s.run();
    expect(s.steps("signed_copy_email")).toEqual(["sent"]);
    const [m] = s.mails;
    // The address the link went to, never the proposal's (changed) client email.
    expect(m.to).toEqual([SENT_TO]);
    expect(m.from).toBe(FROM);
    expect(m.subject).toBe("Your signed letter from Sample Firm");
    expect(m.text).toBe("Hello Callum Ferreira, your signed copy is attached.");
    expect(m.idempotencyKey).toBe(`signed-copy:${REQUEST_ID}:0`);
    expect(Buffer.from(m.attachments![0].content.slice(0, 4)).toString()).toBe("%PDF");
    expect(m.attachments![0].filename).toMatch(/engagement-letter-signed-2026-11-12\.pdf$/);
    // The recorded steps carry no address, words or token.
    const payloads = JSON.stringify(s.tables.client_proposal_event);
    for (const secret of [SENT_TO, "changed-later@example.com", "your signed copy", "re_test_key"]) expect(payloads).not.toContain(secret);
  });

  it("is once per round: a second run sends nothing", async () => {
    const s = setup(linkSnapshot());
    await s.run();
    await s.run();
    expect(s.deliverMail).toHaveBeenCalledTimes(1);
    expect(s.steps("signed_copy_email")).toEqual(["sent"]);
  });

  it("a reset starts a new round, so the key changes", async () => {
    const s = setup(linkSnapshot(), { reset: true });
    await s.run();
    expect(s.mails[0].idempotencyKey).toBe(`signed-copy:${REQUEST_ID}:1`);
  });

  it("skipped is not the success word: skipped while the switch is off, then sent once the switch is on, and not again", async () => {
    const s = setup(linkSnapshot());
    await s.run({ copyEnv: OFF });
    expect(s.steps("signed_copy_email")).toEqual(["skipped"]);
    expect(s.deliverMail).not.toHaveBeenCalled();
    await s.run({ copyEnv: ON });
    expect(s.deliverMail).toHaveBeenCalledTimes(1);
    expect(s.steps("signed_copy_email")).toEqual(["skipped", "sent"]);
    await s.run({ copyEnv: ON });
    expect(s.deliverMail).toHaveBeenCalledTimes(1);
  });

  it("skipped for a firm with no mail entry or no key", async () => {
    for (const env of [{ ...ON, FIRM_CLIENT_MAIL_FROM: "{}" }, { ...ON, RESEND_API_KEY: " " }]) {
      const s = setup(linkSnapshot());
      await s.run({ copyEnv: env });
      expect(s.steps("signed_copy_email")).toEqual(["skipped"]);
    }
  });

  it("a mailer failure is `failed` with its HTTP status only, and is retried by the next run", async () => {
    const s = setup(linkSnapshot());
    const failing = vi.fn(async (): Promise<InternalMailResult> => ({ status: "failed", http: 422 }));
    await s.run({ deliverMail: failing });
    const events = s.tables.client_proposal_event.map((x) => x.payload as Row).filter((p) => p.step === "signed_copy_email");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ step: "signed_copy_email", outcome: "failed", reason: "HTTP 422" });
    await s.run();
    expect(s.steps("signed_copy_email")).toEqual(["failed", "sent"]);
  });

  it("is never run for an in-app signature", async () => {
    const s = setup(signedTrademark());
    await s.run();
    expect(s.steps("signed_copy_email")).toEqual([]);
    expect(s.steps("signed_loe_file")).toEqual([]);
    expect(s.deliverMail).not.toHaveBeenCalled();
    expect(s.uploads).toEqual([]);
  });

  it("the core: blocked without an address or words; failed when the evidence can't be read; blocked on a PDF mismatch", async () => {
    const snapshot = linkSnapshot();
    const base = { linkSigned: true, gate: () => copyMailGate(ORG, ON), clientName: "A", firmName: "F", fileName: "x.pdf", round: 0, deliver: vi.fn(), buildPdf: async () => new Uint8Array([1]) };
    const noSent = evidenceFor(snapshot);
    expect((await runSignedCopyEmail({ ...base, readEvidence: async () => ({ ...noSent, events: noSent.events.filter((x) => x.kind !== "sent") }) })).outcome).toBe("blocked");
    expect((await runSignedCopyEmail({ ...base, readEvidence: async () => ({ ...noSent, request: { ...noSent.request, copy_body: "Hi {{signing_link}}" } }) })).outcome).toBe("blocked");
    expect(await runSignedCopyEmail({ ...base, readEvidence: async () => "unavailable" })).toEqual({ outcome: "failed", reason: STEP_TEXT.copyEvidenceUnreadable });
    const { SignedUploadBlocked } = await import("@/lib/proposals/loe-signed-upload");
    expect(await runSignedCopyEmail({ ...base, readEvidence: async () => noSent, buildPdf: async () => { throw new SignedUploadBlocked(); } })).toEqual({ outcome: "blocked", reason: STEP_TEXT.signedMismatch });
    expect(base.deliver).not.toHaveBeenCalled();
    expect((await runSignedCopyEmail({ ...base, linkSigned: false, readEvidence: async () => noSent })).outcome).toBe("blocked");
  });
});

describe("signed_loe_file", () => {
  it("files the signed PDF in the private bucket at the path built from the proposal row's org, then the row and the timeline entry", async () => {
    const s = setup(linkSnapshot());
    await s.run();
    expect(s.steps("signed_loe_file")).toEqual(["filed"]);
    expect(s.uploads).toHaveLength(1);
    expect(s.uploads[0].path).toBe(`${ORG}/matter/m1/ffffffff-0000-4000-8000-000000000001.pdf`);
    expect(s.uploads[0].opts).toEqual({ contentType: "application/pdf", upsert: false });
    expect(Buffer.from(s.uploads[0].bytes.slice(0, 4)).toString()).toBe("%PDF");
    const [file] = s.tables.crm_file;
    expect(file).toMatchObject({ id: "ffffffff-0000-4000-8000-000000000001", org_id: ORG, matter_id: "m1", lead_id: null, mime: "application/pdf", size_bytes: s.uploads[0].bytes.byteLength });
    expect(file.file_name).toMatch(/engagement-letter-signed-2026-11-12\.pdf$/);
    for (const k of ["uploaded_by", "contact_id"]) expect(k in file).toBe(false);
    const [activity] = s.tables.crm_activity;
    expect(activity).toMatchObject({ org_id: ORG, matter_id: "m1", lead_id: null, type: "file_uploaded", actor_type: "system", payload: { file_id: file.id, source: "signed_letter" } });
  });

  it("is once per round", async () => {
    const s = setup(linkSnapshot());
    await s.run();
    await s.run();
    expect(s.uploads).toHaveLength(1);
    expect(s.tables.crm_file).toHaveLength(1);
  });

  it("with no matter and no lead it is blocked with the fixed sentence and writes nothing", async () => {
    const s = setup(linkSnapshot(), { matterId: null, leadId: null });
    await s.run();
    const p = s.tables.client_proposal_event.map((x) => x.payload as Row).find((x) => x.step === "signed_loe_file")!;
    expect(p).toMatchObject({ outcome: "blocked", reason: STEP_TEXT.signedNoParent });
    expect(s.uploads).toEqual([]);
  });

  it("a lead merged into another is filed under its keeper", async () => {
    const s = setup(linkSnapshot(), { matterId: null, leadId: "leadA" });
    s.tables.crm_lead.push({ id: "leadA", org_id: ORG, merged_into_id: "leadB" }, { id: "leadB", org_id: ORG, merged_into_id: null });
    await s.run();
    expect(s.uploads[0].path).toBe(`${ORG}/lead/leadB/ffffffff-0000-4000-8000-000000000001.pdf`);
    expect(s.tables.crm_file[0]).toMatchObject({ lead_id: "leadB", matter_id: null });
  });

  it("an object written but a row refused: the object is removed and the step is failed", async () => {
    const s = setup(linkSnapshot(), { failInsertOn: "crm_file" });
    await s.run();
    expect(s.steps("signed_loe_file")).toEqual(["failed"]);
    expect(s.removed).toEqual([s.uploads[0].path]);
    expect(s.tables.crm_activity).toEqual([]);
  });

  it("the core: a missing bucket or table is `skipped` (not the success word); the file name and ids come from the row", async () => {
    const baseStore = (over: Partial<FilingStore>): FilingStore => ({ put: async () => "ok", remove: vi.fn(async () => {}), insertFile: async () => "ok", logActivity: async () => {}, ...over });
    const deps = (store: FilingStore) => ({ orgId: ORG, target: async () => ({ ok: true as const, kind: "matter" as const, id: "m1" }), buildPdf: async () => new Uint8Array([1, 2]), store, fileName: "f.pdf", newId: () => "id-1" });
    expect((await runSignedLoeFile(deps(baseStore({ put: async () => "not_set_up" })))).outcome).toBe("skipped");
    const remove = vi.fn(async () => {});
    expect((await runSignedLoeFile(deps(baseStore({ insertFile: async () => "not_set_up", remove })))).outcome).toBe("skipped");
    expect(remove).toHaveBeenCalledTimes(1);
    // A failed timeline write changes nothing.
    expect(await runSignedLoeFile(deps(baseStore({ logActivity: async () => { throw new Error("x"); } })))).toEqual({ outcome: "filed", extra: { file_id: "id-1" } });
  });

  it("filingStoreFor judges errors by code: a missing table is not_set_up, a bucket message is not_set_up, anything else failed", async () => {
    const client = (err: { code?: string; message?: string } | null, bucketErr: { message?: string } | null = null) =>
      ({ from: () => ({ insert: async () => ({ error: err }) }), storage: { from: () => ({ upload: async () => ({ error: bucketErr }), remove: async () => ({ error: null }) }) } }) as never;
    expect(await filingStoreFor(client({ code: "42P01" })).insertFile({} as never)).toBe("not_set_up");
    expect(await filingStoreFor(client({ code: "23503", message: "x" })).insertFile({} as never)).toBe("failed");
    expect(await filingStoreFor(client(null, { message: "Bucket not found" })).put("p", new Uint8Array())).toBe("not_set_up");
    expect(await filingStoreFor(client(null, { message: "boom" })).put("p", new Uint8Array())).toBe("failed");
  });
});

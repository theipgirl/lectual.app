import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminFake, FORM_A, ORG_A, personRow } from "./helpers/step-db";

/**
 * Sprint 36: the Lawmatics push also tags "UTM: <source>" and "Campaign: <campaign>". The Lawmatics API
 * can't set its own UTM fields, so tags are the reliable path. A failing client never fails the intake.
 */

const root = randomBytes(32);
const writes = vi.hoisted(() => ({
  createProspect: vi.fn(),
  attachTags: vi.fn(),
  updateProspect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => root }));
vi.mock("@/lib/lawmatics/writes", () => writes);

const { sealToken } = await import("@/lib/mailbox/crypto");
const { intakeTags } = await import("@/lib/intake-forms/lawmatics-sync");

const handle = { formId: FORM_A, orgId: ORG_A, slug: "ugw-2026", name: "UGW 2026", sourceTag: "UGW 2026" } as never;
const contact = { name: "Ana Rivera", email: "ana@example.com", phone: "", company: "" };
const utm = { source: "ig", medium: "social", campaign: "UGW-2026" };

let db: AdminFake;
async function setup(person: Record<string, unknown> = {}) {
  db = new AdminFake({
    lawmatics_connection: [{ org_id: ORG_A, status: "active", token_enc: sealToken(root, "TOKEN-A-aaaaaaaaaaaaaaaaaaaaaaaaaaaa") }],
    crm_intake_submission: [personRow("tok-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", { id: "sub-1", contact: { ...contact, utm }, lawmatics_contact_id: null, ...person })],
  });
  vi.resetModules();
  vi.doMock("@/lib/db/admin", () => ({ getAdminClient: () => db.client() }));
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/mailbox/config", () => ({ rootKeyOrNull: () => root }));
  vi.doMock("@/lib/lawmatics/writes", () => writes);
  return await import("@/lib/intake-forms/lawmatics-sync");
}

beforeEach(() => {
  writes.createProspect.mockReset().mockResolvedValue({ ok: true, contactId: "c-1" });
  writes.attachTags.mockReset().mockResolvedValue({ ok: true });
  writes.updateProspect.mockReset().mockResolvedValue({ ok: true });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("intakeTags", () => {
  it("keeps the existing tags unchanged without a utm", () => {
    expect(intakeTags("UGW 2026")).toEqual(["UGW 2026"]);
    expect(intakeTags("UGW 2026", "hot")).toEqual(["UGW 2026", "Hot Lead"]);
    expect(intakeTags("UGW 2026", "hot", {})).toEqual(["UGW 2026", "Hot Lead"]);
  });
  it("adds UTM and Campaign tags after the source tag and before the temperature", () => {
    expect(intakeTags("UGW 2026", "hot", utm)).toEqual(["UGW 2026", "UTM: ig", "Campaign: UGW-2026", "Hot Lead"]);
    expect(intakeTags(null, null, { source: "li" })).toEqual(["UTM: li"]);
    expect(intakeTags("UGW 2026", null, { medium: "social" })).toEqual(["UGW 2026"]);
  });
});

describe("the sync", () => {
  it("attaches the source tag and the UTM tags at the contact step", async () => {
    const sync = await setup();
    await sync.syncIntakeStart(handle, "sub-1", contact, utm);
    expect(writes.attachTags).toHaveBeenCalledWith("TOKEN-A-aaaaaaaaaaaaaaaaaaaaaaaaaaaa", "c-1", ["UGW 2026", "UTM: ig", "Campaign: UGW-2026"]);
    expect(db.rows("crm_intake_submission")[0].lawmatics_synced_at).toBeTruthy();
  });

  it("at completion reads the utm from the stored submission row and adds the temperature tag", async () => {
    const sync = await setup({ lawmatics_contact_id: "c-9" });
    await sync.syncIntakeCompletion(handle, "sub-1", { contact, temperature: "hot", note: { name: "n", body: "b" } });
    expect(writes.attachTags).toHaveBeenCalledWith(expect.any(String), "c-9", ["UGW 2026", "UTM: ig", "Campaign: UGW-2026", "Hot Lead"]);
    expect(db.rows("crm_intake_submission")[0].lawmatics_tagged_at).toBeTruthy();
  });

  it("omits the UTM tags when the person came without them", async () => {
    const sync = await setup({ contact });
    await sync.syncIntakeStart(handle, "sub-1", contact);
    expect(writes.attachTags).toHaveBeenCalledWith(expect.any(String), "c-1", ["UGW 2026"]);
  });

  it("never throws when Lawmatics refuses, and leaves the markers null", async () => {
    writes.attachTags.mockResolvedValue({ ok: false, reason: "boom", retryable: true });
    writes.updateProspect.mockResolvedValue({ ok: false, reason: "boom", retryable: true });
    const sync = await setup();
    await expect(sync.syncIntakeStart(handle, "sub-1", contact, utm)).resolves.toBeUndefined();
    expect(db.rows("crm_intake_submission")[0].lawmatics_synced_at).toBeNull();
    const again = await setup({ lawmatics_contact_id: "c-9" });
    await expect(again.syncIntakeCompletion(handle, "sub-1", { contact, note: { name: "n", body: "b" } })).resolves.toBeUndefined();
    expect(db.rows("crm_intake_submission")[0].lawmatics_tagged_at ?? null).toBeNull();
  });

  it("never throws when the client itself throws", async () => {
    writes.createProspect.mockRejectedValue(new Error("network"));
    const sync = await setup();
    await expect(sync.syncIntakeStart(handle, "sub-1", contact, utm)).resolves.toBeUndefined();
  });
});

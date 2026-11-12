import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAcceptanceFollowups } from "@/lib/proposals/accept-followups";
import { runAddressToLawmatics, signedAddress, ADDRESS_CONTACT_NOTE } from "@/lib/proposals/address-to-lawmatics";
import { toAddressPayload, LAWMATICS_ADDRESS_PATH } from "@/lib/lawmatics/contact-payload";
import { readProspectContactId, type GetFetchLike } from "@/lib/lawmatics/writes";
import { describeStepEvent, isRetryableStep, stepActivityLabel } from "@/lib/proposals/paid";
import { stepText } from "@/lib/proposals/paid-view";
import { STEP_TEXT } from "@/lib/proposals/step-text";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { acceptedSnapshot } from "./accepted-fixture";
import { fakeFollowupDb, type Row } from "./followup-db";
import { signedTrademark } from "../loe/signed-fixtures";
import { TEST_DETAILS } from "../loe/full-letter-fixture";

/**
 * The signer's mailing address goes to Lawmatics after signing (step `address_to_lawmatics`). NOT verified against a live account:
 * these tests pin the request shape we send, the two owners, and the outcomes, all with a fake fetch.
 */
vi.mock("next/server", () => ({ after: () => {} }));

const PID = "p1";
const ORG = "org-1";
const STREET = "100 Example Street";

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

type Post = { url: string; method: string; body: Record<string, unknown>; auth: string };
function fakes(opts: { addressStatus?: (n: number, owner: string) => number; contactBody?: unknown; getStatus?: number } = {}) {
  const posts: Post[] = [];
  const gets: string[] = [];
  let addresses = 0;
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>;
    posts.push({ url, method: init.method, body, auth: init.headers.Authorization });
    let status = 200;
    if (url.endsWith(LAWMATICS_ADDRESS_PATH)) {
      addresses += 1;
      status = opts.addressStatus?.(addresses, String(body.addressable_type)) ?? 200;
    }
    return { ok: status < 300, status, json: async () => ({}), text: async () => "address text in an error body" };
  };
  const getFetchImpl: GetFetchLike = async (url) => {
    gets.push(url);
    const status = opts.getStatus ?? 200;
    return { ok: status < 300, status, json: async () => opts.contactBody ?? { data: { id: "LM-77", type: "prospects", relationships: {} } } };
  };
  return { posts, gets, fetchImpl, getFetchImpl, addressPosts: () => posts.filter((p) => p.url.endsWith(LAWMATICS_ADDRESS_PATH)) };
}

const WITH_CONTACT = { data: { id: "LM-77", type: "prospects", relationships: { contact: { data: { id: "C-9", type: "contacts" } } } } };
const run = (db: Parameters<typeof runAcceptanceFollowups>[0], f: ReturnType<typeof fakes>, getToken: () => Promise<string | null> = async () => "FIRM-TOKEN") =>
  runAcceptanceFollowups(db, { proposalId: PID, orgId: ORG }, { getToken, fetchImpl: f.fetchImpl as never, getFetch: f.getFetchImpl, uploadFetch: async () => ({ ok: true, status: 200 }) });
const events = (tables: Record<string, Row[]>) => tables.client_proposal_event.filter((e) => (e.payload as Row).step === "address_to_lawmatics");

describe("toAddressPayload", () => {
  it("is flat: label Mailing, the parts under Lawmatics' names, and the owner as addressable_type + addressable_id", () => {
    expect(toAddressPayload({ street: STREET, street2: "Suite 4", city: "Miami", region: "FL", postal: "33101", country: "United States" }, { type: "Prospect", id: "LM-77" })).toEqual({
      label: "Mailing",
      street: STREET,
      street2: "Suite 4",
      city: "Miami",
      state: "FL",
      zipcode: "33101",
      country: "United States",
      addressable_type: "Prospect",
      addressable_id: "LM-77",
    });
    expect(toAddressPayload({ street: "1 A St", city: "B" }, { type: "Contact", id: "C" })).toEqual({ label: "Mailing", street: "1 A St", city: "B", addressable_type: "Contact", addressable_id: "C" });
  });
});

describe("readProspectContactId", () => {
  const get = (body: unknown, status = 200): GetFetchLike => async () => ({ ok: status < 300, status, json: async () => body });
  it("reads the contact from the relationship or a contact_id attribute, and only for the record it asked about", async () => {
    expect(await readProspectContactId("t", "LM-77", get(WITH_CONTACT))).toEqual({ ok: true, contactId: "C-9" });
    expect(await readProspectContactId("t", "LM-77", get({ data: { id: "LM-77", attributes: { contact_id: 55 } } }))).toEqual({ ok: true, contactId: "55" });
    expect(await readProspectContactId("t", "LM-77", get({ data: { id: "LM-77", relationships: {} } }))).toEqual({ ok: true, contactId: null });
    // A different record than the one asked for is never believed (Lawmatics ignores parameters silently).
    expect(await readProspectContactId("t", "LM-77", get({ data: { id: "OTHER", relationships: { contact: { data: { id: "C-1" } } } } }))).toEqual({ ok: true, contactId: null });
    expect(await readProspectContactId("t", "LM-77", get({}, 404))).toEqual({ ok: false, status: 404 });
    expect(await readProspectContactId("t", "LM-77", async () => Promise.reject(new Error("x")))).toEqual({ ok: false });
  });
});

describe("the step vocabulary", () => {
  it("is retryable, has history words and a label, and its failure text carries the unverified-shape caution", () => {
    expect(isRetryableStep("address_to_lawmatics")).toBe(true);
    const payload = { step: "address_to_lawmatics", outcome: "added" };
    expect(describeStepEvent(payload)).toContain("added the signer’s mailing address to Lawmatics");
    expect(stepActivityLabel(payload)).toBe("Mailing address added to Lawmatics");
    expect(stepActivityLabel({ step: "address_to_lawmatics", outcome: "failed" })).toBe("Mailing address not added to Lawmatics");
    expect(stepText({ step: "address_to_lawmatics", outcome: "failed", reason: "HTTP 422" })).toContain("hasn't been checked against a live account");
    expect(stepText({ step: "address_to_lawmatics", outcome: "added", reason: null })).toBe("Mailing address added to Lawmatics.");
  });
});

describe("the address step after a signed acceptance", () => {
  let snapshot: AcceptedSnapshot;
  beforeEach(() => {
    snapshot = signedTrademark();
  });

  it("writes the snapshot's address to the matter (Prospect) AND the contact, with the firm's own token, once", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    const f = fakes({ contactBody: WITH_CONTACT });
    await run(db, f);
    const addrs = f.addressPosts();
    expect(addrs).toHaveLength(2);
    expect(addrs[0].auth).toBe("Bearer FIRM-TOKEN");
    expect(addrs[0].url).toBe("https://api.lawmatics.com/v1/addresses");
    expect(addrs[0].body).toEqual({
      label: "Mailing",
      street: STREET,
      street2: "Suite 4",
      city: "Miami",
      state: "FL",
      zipcode: "33101",
      country: "United States",
      addressable_type: "Prospect",
      addressable_id: "LM-77",
    });
    expect(addrs[1].body).toMatchObject({ addressable_type: "Contact", addressable_id: "C-9", street: STREET });
    expect(f.gets).toEqual(["https://api.lawmatics.com/v1/prospects/LM-77"]);
    expect(events(tables).map((e) => (e.payload as Row).outcome)).toEqual(["added"]);
    expect(events(tables)[0].actor).toBe("system");

    // Once per signing: a second run finds `added` and does nothing.
    await run(db, f);
    expect(f.addressPosts()).toHaveLength(2);
    expect(events(tables)).toHaveLength(1);
  });

  it("with no contact on the matter the matter's address alone is written and the step still succeeds", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    const f = fakes();
    await run(db, f);
    expect(f.addressPosts().map((p) => p.body.addressable_type)).toEqual(["Prospect"]);
    expect(events(tables)[0].payload).toMatchObject({ outcome: "added" });
    expect((events(tables)[0].payload as Row).reason ?? null).toBeNull();
  });

  it("a failed read of the matter, or a refused contact copy, never fails the step (it says so)", async () => {
    const a = fakeFollowupDb(tablesFor(snapshot));
    await run(a.db, fakes({ getStatus: 500 }));
    expect(events(a.tables)[0].payload).toMatchObject({ outcome: "added", reason: ADDRESS_CONTACT_NOTE });
    const b = fakeFollowupDb(tablesFor(snapshot));
    const f = fakes({ contactBody: WITH_CONTACT, addressStatus: (_n, owner) => (owner === "Contact" ? 422 : 200) });
    await run(b.db, f);
    expect(f.addressPosts()).toHaveLength(2);
    expect(events(b.tables)[0].payload).toMatchObject({ outcome: "added", reason: ADDRESS_CONTACT_NOTE });
  });

  it("a refused matter address is `failed` with the HTTP status only, never writes the contact, leaves the acceptance alone and is tried again next run", async () => {
    const t = tablesFor(snapshot);
    const before = JSON.stringify(t.client_proposal);
    const { db, tables } = fakeFollowupDb(t);
    const bad = fakes({ contactBody: WITH_CONTACT, addressStatus: () => 422 });
    await run(db, bad);
    expect(bad.addressPosts()).toHaveLength(1);
    expect(events(tables)[0].payload).toMatchObject({ step: "address_to_lawmatics", outcome: "failed", reason: "HTTP 422" });
    expect(JSON.stringify(tables.client_proposal)).toBe(before);
    // No part of the address, and no response text, reaches the timeline.
    const timeline = JSON.stringify(tables.client_proposal_event);
    for (const secret of [STREET, "Miami", "33101", "address text in an error body"]) expect(timeline).not.toContain(secret);

    const good = fakes();
    await run(db, good);
    expect(good.addressPosts()).toHaveLength(1);
    expect(events(tables).map((e) => (e.payload as Row).outcome)).toEqual(["failed", "added"]);
  });

  it("a failed address never stops or changes the other steps", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    await run(db, fakes({ addressStatus: () => 500 }));
    const outcomes = tables.client_proposal_event.map((e) => `${(e.payload as Row).step}:${(e.payload as Row).outcome}`);
    expect(outcomes).toContain("accept_notice:sent");
    expect(outcomes).toContain("lawmatics_note:added");
    expect(outcomes).toContain("signed_loe_upload:uploaded");
    expect(outcomes).toContain("address_to_lawmatics:failed");
  });

  it("a firm with no Lawmatics connection is skipped with a reason, and nothing is requested for the address", async () => {
    const { db, tables } = fakeFollowupDb(tablesFor(snapshot));
    const f = fakes();
    await run(db, f, async () => null);
    expect(f.addressPosts()).toHaveLength(0);
    expect(f.gets).toHaveLength(0);
    expect(events(tables)[0].payload).toMatchObject({ outcome: "skipped", reason: STEP_TEXT.addressNotConnected });
  });

  it("no matter, or more than one, is blocked with the target sentences", async () => {
    const none = fakeFollowupDb(tablesFor(snapshot, { crm_matter: [] }));
    const f = fakes();
    await run(none.db, f);
    expect(f.addressPosts()).toHaveLength(0);
    expect(events(none.tables)[0].payload).toMatchObject({ outcome: "blocked", reason: STEP_TEXT.addressNoMatter });

    const lead = (id: string) => ({ id, org_id: ORG, email: "sevetri@example.com", lawmatics_id: id });
    const many = fakeFollowupDb(tablesFor(snapshot, { crm_matter: [], client_proposal: [{ ...tablesFor(snapshot).client_proposal[0], matter_id: null }], crm_lead: [lead("L1"), lead("L2")] }));
    await run(many.db, fakes());
    expect(events(many.tables)[0].payload).toMatchObject({ outcome: "blocked", reason: STEP_TEXT.addressManyMatters });
  });

  it("the address comes only from the signed snapshot: a changed snapshot changes the request, and nothing else can", async () => {
    const changed = { ...snapshot, signing: { ...snapshot.signing!, details: { ...snapshot.signing!.details, street: "9 Snapshot Way", city: "Orlando", region: "FL", postal: "32801", country: "United States" } } };
    const { db } = fakeFollowupDb(tablesFor(changed));
    const f = fakes();
    await run(db, f);
    expect(f.addressPosts()[0].body).toMatchObject({ street: "9 Snapshot Way", city: "Orlando", zipcode: "32801" });
    expect(JSON.stringify(f.posts.filter((p) => p.url.endsWith("/notes")))).not.toContain("9 Snapshot Way");
  });

  it("a snapshot with no usable address is blocked, and an unsigned acceptance never runs the step at all", async () => {
    const empty = { ...snapshot, signing: { ...snapshot.signing!, details: { ...snapshot.signing!.details, street: "", city: "" } } };
    const a = fakeFollowupDb(tablesFor(empty));
    const f = fakes();
    await run(a.db, f);
    expect(f.addressPosts()).toHaveLength(0);
    expect(events(a.tables)[0].payload).toMatchObject({ outcome: "blocked", reason: STEP_TEXT.addressNoAddress });

    const b = fakeFollowupDb(tablesFor(acceptedSnapshot()));
    const g = fakes();
    await run(b.db, g);
    expect(g.addressPosts()).toHaveLength(0);
    expect(events(b.tables)).toHaveLength(0);
  });
});

describe("runAddressToLawmatics and signedAddress", () => {
  it("never throws, whatever a dependency does", async () => {
    const r = await runAddressToLawmatics(signedTrademark(), { token: async () => Promise.reject(new Error("x")), target: async () => ({ ok: true, lawmaticsId: "1" }) });
    expect(r.outcome).toBe("failed");
  });

  it("signedAddress reads the cleaned details of a signed snapshot only", () => {
    expect(signedAddress(signedTrademark())).toEqual({ street: TEST_DETAILS.street, street2: TEST_DETAILS.street2, city: TEST_DETAILS.city, region: "FL", postal: "33101", country: "United States" });
    expect(signedAddress(acceptedSnapshot())).toBeNull();
    expect(signedAddress(null)).toBeNull();
  });
});

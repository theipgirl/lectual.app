import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

// `after()` refuses outside a request: the entry point then awaits the write, so each test sees its effects deterministically.
vi.mock("next/server", () => ({
  after: () => {
    throw new Error("no request scope");
  },
}));

import { runAcceptanceFollowups } from "@/lib/proposals/accept-followups";
import { savePublicDetailsAddress, type PublicProposalsDb } from "@/lib/proposals/public";
import { ADDRESS_DONE_TEXT, addressDoneText, lastAddressWrite, signedAddressDone } from "@/lib/proposals/address-events";
import { describeStepEvent } from "@/lib/proposals/paid";
import { detailsAddressLimiter, detailsTokenLimiter, DETAILS_ADDRESS_PER_ADDRESS, DETAILS_ADDRESS_PER_TOKEN } from "@/lib/loe/review-limit";
import { addressView } from "@/lib/loe/signed-card";
import { detailsSavedNote } from "@/lib/loe/client-words";
import { updateAddress, type GetFetchLike } from "@/lib/lawmatics/writes";
import { saveDetailsInBackground } from "@/components/client-proposal/loe-flow";
import type { SignerDetails } from "@/lib/loe/signing";
import { fakeFollowupDb, type Row } from "./followup-db";
import { signedTrademark } from "../loe/signed-fixtures";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

/**
 * The "Your details" trigger of the address step: Continue on step 2 of `/p/<token>` writes the typed mailing address to the firm's
 * Lawmatics, deduped against the last write of the round, and the signed run that follows reuses those records. Fakes only: no
 * database, no Lawmatics. The request shapes are NOT verified against a live account.
 */

const NOW = new Date("2026-10-20T15:00:00.000Z");
const PID = "prop-2";
const ORG = "org-1";
const ADDRESS_TEXT = ["100 Example Street", "Suite 4", "Miami", "33101", "9 Changed Road", "Orlando", "32801"];
const ECHO = "lawmatics echoed 100 Example Street";

let n = 0;
/** A fresh token and network address per call site: the limiter is in memory and per process. */
function freshToken(): string {
  n += 1;
  return `D${String(n).padStart(4, "0")}`.padEnd(43, "x");
}
const freshIp = () => `198.51.100.${(n % 250) + 1}`;

function world(over: { proposal?: Row; token?: string; content?: unknown; tables?: Record<string, Row[]> } = {}) {
  const token = over.token ?? freshToken();
  const tables: Record<string, Row[]> = {
    client_proposal: [
      {
        id: PID,
        org_id: ORG,
        family_id: "prop-1",
        version: 2,
        public_token: token,
        title: "Trademark Proposal",
        client_name: "Sevetri Wilson",
        client_email: "sevetri@example.com",
        status: "sent",
        content: over.content ?? withLoe(twoBrandPerMark()),
        expires_on: "2026-10-26",
        pay_url: "https://app.lawmatics.com/forms/share/abc",
        lead_id: null,
        matter_id: "m1",
        accepted_at: null,
        accepted_selection: null,
        accepted_snapshot: null,
        ...over.proposal,
      },
    ],
    crm_org: [{ id: ORG, name: "RPB Law Firm", slug: "rpb-law", modules: ["agents", "proposals"] }],
    crm_org_profile: [{ org_id: ORG, display_name: "RPB Law", time_zone: "America/New_York" }],
    crm_matter: [{ id: "m1", org_id: ORG, lawmatics_id: "LM-77" }],
    crm_lead: [],
    client_proposal_setting: [{ org_id: ORG, approver_user_ids: ["u1"] }],
    crm_org_member: [{ org_id: ORG, user_id: "u1", role: "owner" }],
    client_proposal_event: [],
    crm_notification: [],
    ...over.tables,
  };
  const fake = fakeFollowupDb(tables);
  return { token, ...fake, publicDb: fake.db as unknown as PublicProposalsDb };
}

type Req = { method: string; url: string; body: Record<string, unknown> };

function lawmatics(opts: { status?: (req: Req) => number; throwAll?: boolean; contact?: boolean } = {}) {
  const reqs: Req[] = [];
  let ids = 0;
  const fetchImpl = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    const req = { method: init.method, url, body: JSON.parse(init.body) as Record<string, unknown> };
    reqs.push(req);
    if (opts.throwAll) throw new Error(`network down ${ECHO}`);
    const status = opts.status?.(req) ?? 200;
    const id = init.method === "POST" ? `A${++ids}` : url.split("/").pop();
    return { ok: status < 300, status, json: async () => ({ data: { id } }), text: async () => ECHO };
  };
  const getFetch: GetFetchLike = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { id: "LM-77", type: "prospects", relationships: opts.contact === false ? {} : { contact: { data: { id: "C-9", type: "contacts" } } } } }),
  });
  return {
    reqs,
    addressReqs: () => reqs.filter((r) => r.url.includes("/addresses")),
    deps: (getToken: () => Promise<string | null> = async () => "FIRM-TOKEN") => ({ getToken, fetchImpl: fetchImpl as never, getFetch }),
  };
}

const addressEvents = (tables: Record<string, Row[]>) => tables.client_proposal_event.filter((e) => (e.payload as Row | undefined)?.step === "address_to_lawmatics");
const payloadOf = (e: Row) => e.payload as Row;

async function save(w: ReturnType<typeof world>, f: ReturnType<typeof lawmatics>, details: unknown = TEST_DETAILS, extra: { ip?: string; getToken?: () => Promise<string | null> } = {}) {
  return savePublicDetailsAddress(w.token, details, NOW, w.publicDb, { ip: extra.ip ?? freshIp(), deps: f.deps(extra.getToken) });
}

const changed: SignerDetails = { ...TEST_DETAILS, street: "9 Changed Road", street2: "", city: "Orlando", postal: "32801" };

let consoleCalls: unknown[][];
beforeEach(() => {
  consoleCalls = [];
  for (const k of ["log", "error", "warn", "info"] as const) vi.spyOn(console, k).mockImplementation((...args: unknown[]) => void consoleCalls.push(args));
});
afterEach(() => vi.restoreAllMocks());

function expectNoAddressText(tables: Record<string, Row[]>) {
  const seen = JSON.stringify(tables.client_proposal_event) + JSON.stringify(consoleCalls);
  for (const secret of [...ADDRESS_TEXT, ECHO]) expect(seen).not.toContain(secret);
}

describe("Continue on Your details: what is refused, with zero Lawmatics calls", () => {
  it("a malformed token, a proposal that isn't live, an expired one, one with no letter, and incomplete details", async () => {
    const cases: Array<[string, () => ReturnType<typeof world>, unknown]> = [
      ["bad token", () => ({ ...world(), token: "short" }), TEST_DETAILS],
      ["unknown token", () => ({ ...world(), token: freshToken() }), TEST_DETAILS],
      ["accepted", () => world({ proposal: { status: "accepted", accepted_snapshot: signedTrademark() } }), TEST_DETAILS],
      ["withdrawn", () => world({ proposal: { status: "withdrawn" } }), TEST_DETAILS],
      ["draft", () => world({ proposal: { status: "draft" } }), TEST_DETAILS],
      ["expired", () => world({ proposal: { expires_on: "2026-10-10" } }), TEST_DETAILS],
      ["no letter", () => world({ content: twoBrandPerMark() }), TEST_DETAILS],
      ["no city", () => world(), { ...TEST_DETAILS, city: "" }],
      ["no ZIP", () => world(), { ...TEST_DETAILS, postal: "   " }],
      ["nothing", () => world(), null],
    ];
    for (const [label, make, details] of cases) {
      const w = make();
      const f = lawmatics();
      await expect(save(w, f, details), label).resolves.toBeUndefined();
      expect(f.reqs, label).toHaveLength(0);
      expect(addressEvents(w.tables), label).toHaveLength(0);
      expect(w.calls.filter((c) => c.op === "insert"), label).toHaveLength(0);
    }
  });

  it("is rate limited per token and per network address, before the proposal is read", async () => {
    const w = world();
    const tokenKey = `t:${createHash("sha256").update(w.token).digest("hex")}`;
    for (let i = 0; i < DETAILS_ADDRESS_PER_TOKEN; i++) detailsTokenLimiter.record(tokenKey);
    const f = lawmatics();
    await save(w, f);
    expect(f.reqs).toHaveLength(0);
    expect(w.calls).toHaveLength(0);

    const v = world();
    const ip = "192.0.2.77";
    for (let i = 0; i < DETAILS_ADDRESS_PER_ADDRESS; i++) detailsAddressLimiter.record(`ip:${ip}`);
    const g = lawmatics();
    await save(v, g, TEST_DETAILS, { ip });
    expect(g.reqs).toHaveLength(0);
    expect(v.calls).toHaveLength(0);
  });
});

describe("Continue on Your details: the write and the dedupe", () => {
  it("a good Continue writes the matter and the contact once, with the firm's own token, and records ids only", async () => {
    const w = world();
    const f = lawmatics();
    await save(w, f);
    const reqs = f.addressReqs();
    expect(reqs.map((r) => `${r.method} ${r.body.addressable_type}`)).toEqual(["POST Prospect", "POST Contact"]);
    expect(reqs[0].body).toMatchObject({ street: "100 Example Street", city: "Miami", zipcode: "33101", addressable_id: "LM-77" });
    expect(reqs[1].body).toMatchObject({ addressable_id: "C-9" });
    const events = addressEvents(w.tables);
    expect(events).toHaveLength(1);
    expect(events[0].actor).toBe("system");
    const p = payloadOf(events[0]);
    expect(p).toMatchObject({ step: "address_to_lawmatics", outcome: "added", trigger: "details", action: "created", target_id: "LM-77", matter_address_id: "A1", contact_address_id: "A2" });
    expect(p.address_sha256).toMatch(/^[0-9a-f]{64}$/);
    // Nothing else about the proposal changed.
    expect(w.tables.client_proposal[0].status).toBe("sent");
    expectNoAddressText(w.tables);
  });

  it("an identical repeat makes no request and records nothing", async () => {
    const w = world();
    const f = lawmatics();
    await save(w, f);
    // Typed differently but the same once cleaned (the signing normaliser): still the same address.
    await save(w, f, { ...TEST_DETAILS, street: "  100   Example Street ", city: "Miami\t" });
    expect(f.addressReqs()).toHaveLength(2);
    expect(addressEvents(w.tables)).toHaveLength(1);
  });

  it("a changed address PATCHes the records written earlier instead of adding new ones", async () => {
    const w = world();
    const f = lawmatics();
    await save(w, f);
    await save(w, f, changed);
    const reqs = f.addressReqs();
    expect(reqs.slice(2).map((r) => `${r.method} ${r.url}`)).toEqual(["PATCH https://api.lawmatics.com/v1/addresses/A1", "PATCH https://api.lawmatics.com/v1/addresses/A2"]);
    expect(reqs[2].body).toMatchObject({ street: "9 Changed Road", city: "Orlando", addressable_type: "Prospect", addressable_id: "LM-77" });
    expect(reqs[2].body).not.toHaveProperty("street2");
    const last = payloadOf(addressEvents(w.tables).at(-1)!);
    expect(last).toMatchObject({ trigger: "details", action: "updated", matter_address_id: "A1", contact_address_id: "A2" });
    expectNoAddressText(w.tables);
  });

  it("a 404 on the PATCH falls back to creating the record", async () => {
    const w = world();
    const f = lawmatics({ status: (r) => (r.method === "PATCH" ? 404 : 200) });
    await save(w, f);
    await save(w, f, changed);
    expect(f.addressReqs().map((r) => r.method)).toEqual(["POST", "POST", "PATCH", "POST", "PATCH", "POST"]);
    expect(payloadOf(addressEvents(w.tables).at(-1)!)).toMatchObject({ action: "created", matter_address_id: "A3", contact_address_id: "A4" });
  });

  it("a refusal is recorded once (HTTP status only) and not again for the same outcome; the next good Continue writes", async () => {
    const w = world();
    const bad = lawmatics({ status: () => 422 });
    await save(w, bad);
    await save(w, bad);
    expect(bad.addressReqs()).toHaveLength(2);
    expect(addressEvents(w.tables).map((e) => payloadOf(e).outcome)).toEqual(["failed"]);
    expect(payloadOf(addressEvents(w.tables)[0])).toMatchObject({ trigger: "details", reason: "HTTP 422" });

    const none = world();
    const g = lawmatics();
    await save(none, g, TEST_DETAILS, { getToken: async () => null });
    await save(none, g, TEST_DETAILS, { getToken: async () => null });
    expect(g.reqs).toHaveLength(0);
    expect(addressEvents(none.tables).map((e) => payloadOf(e).outcome)).toEqual(["skipped"]);

    const good = lawmatics();
    await save(w, good);
    expect(good.addressReqs()).toHaveLength(2);
    expect(addressEvents(w.tables).map((e) => payloadOf(e).outcome)).toEqual(["failed", "added"]);
    expectNoAddressText(w.tables);
    expectNoAddressText(none.tables);
  });

  it("the client is never blocked: the call resolves when Lawmatics throws, and nothing is thrown or shown", async () => {
    const w = world();
    const f = lawmatics({ throwAll: true });
    await expect(save(w, f)).resolves.toBeUndefined();
    expect(f.addressReqs()).toHaveLength(1);
    expect(payloadOf(addressEvents(w.tables)[0])).toMatchObject({ outcome: "failed", reason: "request failed", trigger: "details" });
    expectNoAddressText(w.tables);

    // A token read that throws, and a database that throws, resolve the same way.
    const v = world();
    await expect(save(v, lawmatics(), TEST_DETAILS, { getToken: () => Promise.reject(new Error("x")) })).resolves.toBeUndefined();
    const broken = { from: () => { throw new Error("db down"); } } as unknown as PublicProposalsDb;
    await expect(savePublicDetailsAddress(freshToken(), TEST_DETAILS, NOW, broken, { ip: freshIp() })).resolves.toBeUndefined();
  });

  it("a reset starts a new round: the same address is written fresh, not skipped and not patched", async () => {
    const w = world();
    const f = lawmatics();
    await save(w, f);
    w.tables.client_proposal_event.push({ proposal_id: PID, org_id: ORG, type: "reset", created_at: "2026-10-30T00:00:00.000Z" });
    const before = w.tables.client_proposal_event.length;
    await save(w, f);
    expect(f.addressReqs().map((r) => r.method)).toEqual(["POST", "POST", "POST", "POST"]);
    expect(w.tables.client_proposal_event.length).toBe(before + 1);
    expect(payloadOf(w.tables.client_proposal_event.at(-1)!)).toMatchObject({ action: "created", matter_address_id: "A3" });
  });
});

describe("signing after the details were written", () => {
  function signLater(w: ReturnType<typeof world>, snapshot = signedTrademark()) {
    const row = w.tables.client_proposal[0];
    row.status = "accepted";
    row.accepted_snapshot = snapshot;
  }
  const followups = (w: ReturnType<typeof world>, f: ReturnType<typeof lawmatics>) =>
    runAcceptanceFollowups(w.db, { proposalId: PID, orgId: ORG }, { ...f.deps(), uploadFetch: async () => ({ ok: true, status: 200 }) });

  it("the same address makes no address request and is recorded as added, unchanged, with the earlier ids", async () => {
    const w = world();
    const f = lawmatics();
    await save(w, f);
    signLater(w);
    await followups(w, f);
    expect(f.addressReqs()).toHaveLength(2);
    const events = addressEvents(w.tables);
    expect(events.map((e) => `${payloadOf(e).trigger}:${payloadOf(e).action}`)).toEqual(["details:created", "signed:unchanged"]);
    expect(payloadOf(events[1])).toMatchObject({ outcome: "added", matter_address_id: "A1", contact_address_id: "A2" });
    // Once per signing: a second run does nothing.
    await followups(w, f);
    expect(addressEvents(w.tables)).toHaveLength(2);
    expectNoAddressText(w.tables);
  });

  it("a different signed address updates the records the details wrote", async () => {
    const w = world();
    const f = lawmatics();
    await save(w, f, changed);
    signLater(w);
    await followups(w, f);
    expect(f.addressReqs().map((r) => `${r.method} ${r.url.split("/v1")[1]}`)).toEqual(["POST /addresses", "POST /addresses", "PATCH /addresses/A1", "PATCH /addresses/A2"]);
    expect(f.addressReqs()[2].body).toMatchObject({ street: "100 Example Street", city: "Miami" });
    expect(payloadOf(addressEvents(w.tables).at(-1)!)).toMatchObject({ trigger: "signed", action: "updated" });
  });

  it("with no details write this round (e.g. Lawmatics connected later), the signed run creates the records as before", async () => {
    const w = world();
    await save(w, lawmatics(), TEST_DETAILS, { getToken: async () => null });
    signLater(w);
    const f = lawmatics();
    await followups(w, f);
    expect(f.addressReqs().map((r) => r.method)).toEqual(["POST", "POST"]);
    expect(addressEvents(w.tables).map((e) => `${payloadOf(e).trigger}:${payloadOf(e).outcome}`)).toEqual(["details:skipped", "signed:added"]);
  });
});

describe("reading the events back, and the words", () => {
  const ev = (payload: Row, created_at: string, type = "edited") => ({ proposal_id: "p", created_at, type, payload });
  const H = "a".repeat(64);

  it("the last write and the signed-trigger check read only this round", () => {
    const events = [
      ev({ step: "address_to_lawmatics", outcome: "added", trigger: "details", action: "created", address_sha256: H, target_id: "LM", matter_address_id: "A1" }, "2026-10-20T10:00:00Z"),
      ev({ step: "address_to_lawmatics", outcome: "failed", trigger: "details", reason: "HTTP 500" }, "2026-10-20T11:00:00Z"),
    ];
    expect(lastAddressWrite(events, "p")).toEqual({ hash: H, targetId: "LM", matterAddressId: "A1", contactAddressId: null, trigger: "details" });
    expect(signedAddressDone(events, "p")).toBe(false);
    // An older event with no trigger was written after signing.
    expect(signedAddressDone([ev({ step: "address_to_lawmatics", outcome: "added" }, "2026-10-20T10:00:00Z")], "p")).toBe(true);
    const reset = [...events, { proposal_id: "p", type: "reset", created_at: "2026-10-21T00:00:00Z" }];
    expect(lastAddressWrite(reset, "p")).toBeNull();
    // A stored id that isn't a plain token is never put in a path.
    expect(lastAddressWrite([ev({ step: "address_to_lawmatics", outcome: "added", address_sha256: H, target_id: "LM", matter_address_id: "../x" }, "2026-10-20T10:00:00Z")], "p")?.matterAddressId).toBeNull();
  });

  it("the staff card and history say which trigger wrote it; an event with no trigger reads as before", () => {
    const at = "2026-10-20T10:00:00Z";
    const details = { step: "address_to_lawmatics", outcome: "added", trigger: "details", action: "created" };
    const unchanged = { step: "address_to_lawmatics", outcome: "added", trigger: "signed", action: "unchanged" };
    expect(addressView([ev(details, at)], "p", true)).toMatchObject({ state: "done", text: ADDRESS_DONE_TEXT.detailsCreated });
    expect(addressView([ev(unchanged, at)], "p", true).text).toBe(ADDRESS_DONE_TEXT.signedUnchanged);
    expect(addressDoneText({ trigger: "details", action: "updated" })).toBe(ADDRESS_DONE_TEXT.detailsUpdated);
    expect(addressDoneText({ trigger: "signed", action: "updated" })).toBe(ADDRESS_DONE_TEXT.signedUpdated);
    expect(addressDoneText({ trigger: "signed", action: "created" })).toBe(ADDRESS_DONE_TEXT.signedCreated);
    expect(addressDoneText({})).toBe("Mailing address added to Lawmatics.");
    expect(describeStepEvent(details)).toBe("added the signer’s mailing address to Lawmatics (when the client entered their details)");
    expect(describeStepEvent(unchanged)).toContain("(unchanged at signing)");
    expect(describeStepEvent({ step: "address_to_lawmatics", outcome: "added" })).toBe("added the signer’s mailing address to Lawmatics");
    // A failure after a details success keeps Try again.
    expect(addressView([ev(details, at), ev({ step: "address_to_lawmatics", outcome: "failed", trigger: "signed", reason: "HTTP 500" }, "2026-10-21T10:00:00Z")], "p", true)).toMatchObject({ state: "failed", retry: true });
  });

  it("the client's line names the firm and what Continue does, nothing more", () => {
    expect(detailsSavedNote("RPB Law Firm")).toBe("Your address is saved to your file with RPB Law Firm when you continue.");
    expect(detailsSavedNote("  ")).toBe("Your address is saved to your file with the firm when you continue.");
  });

  it("the page hands Continue's details over without waiting, only when complete, and never throws", async () => {
    const save = vi.fn(async () => Promise.reject(new Error("x")));
    expect(saveDetailsInBackground(save, true, TEST_DETAILS)).toBe(true);
    expect(save).toHaveBeenCalledWith(TEST_DETAILS);
    expect(saveDetailsInBackground(save, false, TEST_DETAILS)).toBe(false);
    expect(saveDetailsInBackground(undefined, true, TEST_DETAILS)).toBe(false);
    expect(
      saveDetailsInBackground(
        () => {
          throw new Error("sync");
        },
        true,
        TEST_DETAILS,
      ),
    ).toBe(true);
    await Promise.resolve();
  });

  it("updateAddress never puts an id that isn't a plain token in a path", async () => {
    const fetchImpl = vi.fn();
    const r = await updateAddress("t", "../prospects/1", { street: "1 A St", city: "B" }, { type: "Prospect", id: "LM" }, fetchImpl as never);
    expect(r).toMatchObject({ ok: false, status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

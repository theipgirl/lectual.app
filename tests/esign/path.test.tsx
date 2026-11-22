import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { decideSigningPath, type PathFacts } from "@/lib/esign/path-rules";
import { loadSigningPath } from "@/lib/esign/path";
import { adobeRowView } from "@/lib/esign/settings-view";
import { adobeStartOutcome } from "@/components/client-proposal/adobe-flow";
import { ADOBE_SIGN_LABEL, ADOBE_SIGN_NOTE, ESIGN_PAUSED_SENTENCE, SIGN_AGREE_LABEL, SIGN_LABEL } from "@/lib/loe/client-words";
import { ADOBE_SWITCH_OFF_LINE, ADOBE_NOT_SET_UP, adobeWaitingLine } from "@/lib/ui/words";
import { esignDb, type Row } from "./esign-db";
import { PIN_CASES, renderPin } from "./baseline-render";
import { TEST_DETAILS } from "../loe/full-letter-fixture";

const NOW = new Date("2026-10-20T15:00:00.000Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60 * 1000).toISOString();
const REF = { proposalId: "prop-2", orgId: "org-1" };

function facts(over: Partial<PathFacts> = {}): PathFacts {
  return { setupReady: true, switchOn: true, requests: { state: "ok", open: null }, connection: { state: "ok", id: "conn-1", status: "active" }, ...over };
}

describe("the path choice (contract item 8)", () => {
  it("AT6 / AT8: switch off, env unset, no row, revoked, reauth, a failed connection read or 0113 missing → in-app (nothing open)", () => {
    expect(decideSigningPath(facts()).kind).toBe("adobe");
    expect(decideSigningPath(facts({ switchOn: false })).kind).toBe("in_app");
    expect(decideSigningPath(facts({ setupReady: false })).kind).toBe("in_app");
    expect(decideSigningPath(facts({ connection: { state: "ok", id: null, status: null } })).kind).toBe("in_app");
    for (const status of ["revoked", "reauth"] as const) expect(decideSigningPath(facts({ connection: { state: "ok", id: "conn-1", status } })).kind, status).toBe("in_app");
    expect(decideSigningPath(facts({ connection: { state: "unavailable" } })).kind).toBe("in_app");
    expect(decideSigningPath(facts({ connection: { state: "not-set-up" }, requests: { state: "not-set-up" } })).kind).toBe("in_app");
  });

  it("AT10: a failed request read gives the in-app form", () => {
    expect(decideSigningPath(facts({ requests: { state: "unavailable" } })).kind).toBe("in_app");
  });

  it("D18: an open request with an active connection resumes, even with the switch off", () => {
    const open = { id: "r1", status: "out_for_signature" as const, connectionId: "conn-1" };
    expect(decideSigningPath(facts({ requests: { state: "ok", open }, switchOn: false })).kind).toBe("resume");
  });

  it("AT12: an open request with the connection reauth or unreadable is paused (no in-app, no Adobe)", () => {
    const open = { id: "r1", status: "out_for_signature" as const, connectionId: "conn-1" };
    expect(decideSigningPath(facts({ requests: { state: "ok", open }, connection: { state: "ok", id: "conn-1", status: "reauth" } })).kind).toBe("paused");
    expect(decideSigningPath(facts({ requests: { state: "ok", open }, connection: { state: "unavailable" } })).kind).toBe("paused");
  });

  it("AT11: an open request whose connection is revoked, missing or null is closed and the client gets in-app", () => {
    const open = { id: "r1", status: "out_for_signature" as const, connectionId: "conn-1" };
    for (const connection of [
      { state: "ok" as const, id: "conn-1", status: "revoked" as const },
      { state: "ok" as const, id: null, status: null },
    ]) {
      expect(decideSigningPath(facts({ requests: { state: "ok", open }, connection }))).toEqual({ kind: "in_app", close: open });
    }
    expect(decideSigningPath(facts({ requests: { state: "ok", open: { ...open, connectionId: null } } }))).toEqual({ kind: "in_app", close: { ...open, connectionId: null } });
  });
});

function world(requests: Row[], connection: Row | null, opts: Parameters<typeof esignDb>[1] = {}) {
  return esignDb({ client_proposal_esign_request: requests, adobe_sign_connection: connection ? [connection] : [] }, opts);
}

describe("loadSigningPath (the reads, service role, fenced on the proposal's org)", () => {
  it("AT23: an 11-minute-old creating row is closed as failed (creation_interrupted) and the client gets in-app when nothing else is open", async () => {
    const w = world([{ id: "r1", proposal_id: "prop-2", org_id: "org-1", status: "creating", connection_id: "conn-1", created_at: ago(11) }], { id: "conn-1", org_id: "org-1", status: "active" });
    expect(await loadSigningPath({ db: w.db, ref: REF, now: NOW, switchOn: false, setupReady: true })).toBe("in_app");
    expect((w.tables.client_proposal_esign_request as Row[])[0]).toMatchObject({ status: "failed", last_error: "creation_interrupted" });
  });

  it("AT23: a 9-minute-old creating row is left, and in-app stays refused (the page offers the Adobe button, never the in-app form)", async () => {
    const w = world([{ id: "r1", proposal_id: "prop-2", org_id: "org-1", status: "creating", connection_id: "conn-1", created_at: ago(9) }], { id: "conn-1", org_id: "org-1", status: "active" });
    expect(await loadSigningPath({ db: w.db, ref: REF, now: NOW, switchOn: false, setupReady: true })).toBe("resume");
    expect((w.tables.client_proposal_esign_request as Row[])[0].status).toBe("creating");
  });

  it("AT11: an open request whose connection was deleted (connection_id null) is closed cancelled + cancel_failed, fenced on its status", async () => {
    const w = world([{ id: "r1", proposal_id: "prop-2", org_id: "org-1", status: "out_for_signature", connection_id: null, created_at: ago(30) }], null);
    expect(await loadSigningPath({ db: w.db, ref: REF, now: NOW, switchOn: true, setupReady: true })).toBe("in_app");
    expect((w.tables.client_proposal_esign_request as Row[])[0]).toMatchObject({ status: "cancelled", cancel_failed: true });
    const close = w.calls.find((c) => c.op === "update" && (c.payload as Row).status === "cancelled")!;
    expect(close.filters).toContainEqual(["eq", "status", "out_for_signature"]);
    expect(close.filters).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("AT1 / 0113 missing: a missing table (42P01 / PGRST205) is in-app", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const w = world([], null, { failOn: { client_proposal_esign_request: { code } } });
      expect(await loadSigningPath({ db: w.db, ref: REF, now: NOW, switchOn: true, setupReady: true })).toBe("in_app");
    }
  });

  it("the connection read selects no sealed column", async () => {
    const w = world([], { id: "conn-1", org_id: "org-1", status: "active", access_token_enc: "x" });
    expect(await loadSigningPath({ db: w.db, ref: REF, now: NOW, switchOn: true, setupReady: true })).toBe("adobe");
    for (const c of w.calls) expect(c.columns ?? "").not.toMatch(/_enc/);
  });
});

describe("Settings → Integrations, the Adobe Acrobat Sign row", () => {
  const base = { setupReady: true, switchOn: true, waiting: null, canManage: true };
  const conn = (status: "active" | "reauth" | "revoked") => ({ state: "ok" as const, connection: { id: "c", org_id: "o", status, api_access_point: "https://api.na1.adobesign.com", account_email: "firm@example.com", access_expires_at: null, last_refreshed_at: null } });

  it("AT6: not set up → disabled with SWITCH_ON_WORDS (the connect slot is 'disabled')", () => {
    expect(adobeRowView({ ...base, setupReady: false, read: { state: "ok", connection: null } })).toMatchObject({ state: "not-available", help: ADOBE_NOT_SET_UP, connect: "disabled" });
  });
  it("AT6: connected with the switch off says clients sign in Lectual", () => {
    const v = adobeRowView({ ...base, switchOn: false, read: conn("active") });
    expect(v.state).toBe("connected");
    expect(v.help).toBe(`Connected as firm@example.com. ${ADOBE_SWITCH_OFF_LINE}`);
    expect(adobeRowView({ ...base, read: conn("active") }).help).toBe("Connected as firm@example.com.");
  });
  it("AT6: a connection read that fails is 'couldn't check'", () => {
    expect(adobeRowView({ ...base, read: { state: "unavailable" } }).state).toBe("couldnt-check");
  });
  it("AT12: reauth → Reconnect and how many clients are waiting (a failed count leaves the line out)", () => {
    const v = adobeRowView({ ...base, waiting: 3, read: conn("reauth") });
    expect(v).toMatchObject({ state: "reconnect", connect: "reconnect", disconnect: true });
    expect(v.help).toContain("3 clients are waiting to sign until you reconnect.");
    expect(adobeRowView({ ...base, waiting: null, read: conn("reauth") }).help).not.toContain("waiting");
    expect(adobeWaitingLine(1)).toBe("1 client is waiting to sign until you reconnect.");
  });
  it("only the admin tier gets the buttons", () => {
    expect(adobeRowView({ ...base, canManage: false, read: conn("active") })).toMatchObject({ connect: null, disconnect: false });
    expect(adobeRowView({ ...base, canManage: false, read: { state: "ok", connection: null } }).connect).toBeNull();
  });
});

describe("/p step 3 on the Adobe path", () => {
  const step3 = PIN_CASES.find((c) => c.name === "tm-step3-ready")!;
  const startAdobe = async () => ({ ok: false as const, message: "x" });

  it("adobe: the typed name only (no tick), the Adobe button, and Adobe's note", () => {
    const html = renderPin(step3, { signingPath: "adobe", onStartAdobe: startAdobe });
    expect(html).toContain(ADOBE_SIGN_LABEL);
    expect(html).not.toContain(SIGN_LABEL);
    expect(html).not.toContain(SIGN_AGREE_LABEL);
    expect(html).toContain(ADOBE_SIGN_NOTE.replace(/'/g, "&#x27;"));
    expect(html).toContain('name="typed_name"');
    expect(html).not.toContain("<iframe");
  });

  it("AT12: paused: the sentence, no form and no sign button", () => {
    const html = renderPin(step3, { signingPath: "paused", onStartAdobe: startAdobe });
    expect(html).toContain(ESIGN_PAUSED_SENTENCE);
    expect(html).not.toContain('name="typed_name"');
    expect(html).not.toContain(SIGN_LABEL);
    expect(html).not.toContain(ADOBE_SIGN_LABEL);
  });

  it("an accepted receipt ignores a signing path", () => {
    const receipt = PIN_CASES.find((c) => c.name === "tm-receipt")!;
    expect(renderPin(receipt, { signingPath: "adobe", onStartAdobe: startAdobe })).not.toContain(ADOBE_SIGN_LABEL);
  });

  it("AT9: the action's answer: a URL navigates top-level; fallback turns the page in-app; nothing else is guessed", () => {
    expect(adobeStartOutcome({ ok: true, url: "https://secure.na1.adobesign.com/x" })).toEqual({ navigate: "https://secure.na1.adobesign.com/x" });
    expect(adobeStartOutcome({ ok: false, fallback: "in_app", message: "m" })).toEqual({ fallback: "m" });
    expect(adobeStartOutcome({ ok: false, message: "m" })).toEqual({ error: "m" });
    expect(adobeStartOutcome(null)).toHaveProperty("error");
  });

  it("AT9: after a fallback the page is the in-app form, the typed name and details kept, the tick shown (client state only)", async () => {
    // The fallback is React state; a fresh render (a reload) chooses again. Rendering the in-app path with the same typed values
    // is what the page shows after `fellBack`.
    const html = renderPin({ name: "x", props: { initialLoe: { step: 3, details: TEST_DETAILS, typedName: "Jordan Sample" } } });
    expect(html).toContain('value="Jordan Sample"');
    expect(html).toContain(SIGN_AGREE_LABEL);
  });
});

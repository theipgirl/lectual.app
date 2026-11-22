import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: async () => {} }));

import { acceptPublicProposal } from "@/lib/proposals/public";
import { ADOBE_FALLBACK_SENTENCE, ADOBE_SIGN_HERE_INSTEAD, ESIGN_BUSY_SENTENCE, ESIGN_PAUSED_SENTENCE, ESIGN_SIGNED_WAITING_SENTENCE, SIGN_MESSAGES } from "@/lib/loe/client-words";
import { assembleAgreement, letterDateText } from "@/lib/loe/signing";
import { buildExhibit } from "@/lib/loe/exhibit";
import { money } from "@/components/client-proposal/format";
import { quoteForAcceptance } from "@/lib/proposals/client-classes";
import { DISABLED_NOTIFICATION_TYPES, expirationInstant } from "@/lib/esign/payload";
import { TEST_DETAILS } from "../loe/full-letter-fixture";
import { ESIGN_URL, NOW, TOKEN, deps, happyAdobe, pageInput, start, startWorld } from "./start-world";
import { fakeAdobe, json, type Row } from "./esign-db";
import { runStartAdobeSigning } from "@/lib/esign/start-core";
import { readPublicProposal } from "@/lib/proposals/public";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const req = (w: ReturnType<typeof startWorld>) => w.tables.client_proposal_esign_request as Row[];

let spies: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
});
afterEach(() => spies.forEach((s) => s.mockRestore()));
const logged = () => JSON.stringify(spies.map((s) => s.mock.calls));

describe("AT2: same text, same fingerprint (typed name, start date)", () => {
  it("AT2: the stored agreement text and sha256 equal in-app assembleAgreement for the same typed name, details, selection and date", async () => {
    const w = startWorld();
    const input = await pageInput(w);
    const adobe = happyAdobe();
    const { result } = await start(w, adobe, input);
    expect(result).toEqual({ ok: true, url: ESIGN_URL });
    const opened = w.rpcCalls.find((c) => c.fn === "client_proposal_esign_open")!;
    const text = opened.args.p_agreement_text as string;

    // In-app: the same pieces, the same date text (the firm's date of this call).
    const read = await readPublicProposal(TOKEN, NOW, w.db);
    if (read.status !== "ok") throw new Error("read");
    const priced = quoteForAcceptance(read.view.content, input.selection, undefined);
    if (!priced.ok) throw new Error("price");
    const dateText = letterDateText(NOW, "America/New_York");
    const inApp = assembleAgreement({
      body: read.view.content.loe!.body,
      inputs: { details: TEST_DETAILS, typedName: "Jordan Sample", dateText, clientEmail: "callum@example.com" },
      exhibit: buildExhibit(priced.content, priced.quote, money),
    });
    if (!inApp.ok) throw new Error("assemble");
    expect(text).toBe(inApp.agreement.text);
    expect(opened.args.p_agreement_sha256).toBe(sha(inApp.agreement.text));
    // Both date fields are the start date; no placeholder remains.
    expect(text).toContain(dateText);
    expect(text).not.toContain("[date]");
    // {{signer_name}} is the typed name, never client_name.
    expect(opened.args.p_signer_name).toBe("Jordan Sample");
    expect(text).toContain("Jordan Sample");
    const agreementCall = adobe.calls.find((c) => c.method === "POST" && c.url.endsWith("/agreements"))!;
    const body = agreementCall.body as { participantSetsInfo: Array<{ memberInfos: Array<{ name: string; email: string }> }> };
    expect(body.participantSetsInfo[0].memberInfos[0]).toEqual({ email: "callum@example.com", name: "Jordan Sample" });
  });

  it("AT2: the request's frozen columns are what signAndAccept would send to 0106 for the same inputs", async () => {
    const w = startWorld();
    const input = await pageInput(w);
    await start(w, happyAdobe(), input);
    const open = w.rpcCalls.find((c) => c.fn === "client_proposal_esign_open")!.args;

    // The in-app path, same inputs and instant, with the tick.
    const w2 = startWorld({ rpcImpl: (fn, a, t) => { (t.captured ??= []).push(a as Row); return { data: "sig-1", error: null }; } });
    const b = await pageInput(w2);
    await acceptPublicProposal(TOKEN, b.selection, NOW, w2.db, undefined, { typedName: "Jordan Sample", agree: true, details: TEST_DETAILS, fingerprint: b.fingerprint });
    const inApp = (w2.tables.captured as Row[])[0];
    for (const k of ["p_signer_name", "p_signer_title", "p_entity_name", "p_address", "p_agreement_text", "p_agreement_sha256", "p_selection", "p_snapshot"]) {
      expect(open[k], k).toEqual(inApp[k]);
    }
  });

  it("AT2: an empty or too-short typed name is name_required, missing details are details_required: no row, no Adobe call", async () => {
    for (const [over, message] of [
      [{ typedName: "" }, SIGN_MESSAGES.name_required],
      [{ typedName: "J" }, SIGN_MESSAGES.name_required],
      [{ details: { ...TEST_DETAILS, street: "" } }, SIGN_MESSAGES.details_required],
    ] as const) {
      const w = startWorld();
      const adobe = happyAdobe();
      const input = await pageInput(w, over);
      const { result } = await start(w, adobe, input);
      expect(result).toEqual({ ok: false, message });
      expect(w.rpcCalls).toHaveLength(0);
      expect(req(w)).toHaveLength(0);
      expect(adobe.calls).toHaveLength(0);
    }
  });
});

describe("AT3: stale", () => {
  it("AT3: a browser fingerprint that differs from the server's is stale: no row, no Adobe call", async () => {
    const w = startWorld();
    const adobe = happyAdobe();
    const input = await pageInput(w);
    const { result } = await start(w, adobe, { ...input, fingerprint: "0".repeat(64) });
    expect(result).toEqual({ ok: false, message: SIGN_MESSAGES.stale });
    expect(w.rpcCalls).toHaveLength(0);
    expect(adobe.calls).toHaveLength(0);
  });

  it("AT3: esign_open refusing esign_proposal_changed maps to the stale sentence", async () => {
    const w = startWorld({ rpcImpl: () => ({ data: null, error: { code: "23514", message: "esign_proposal_changed: x" } }) });
    const adobe = happyAdobe();
    const { result } = await start(w, adobe, await pageInput(w));
    expect(result).toEqual({ ok: false, message: SIGN_MESSAGES.stale });
    expect(adobe.calls).toHaveLength(0);
  });
});

describe("AT4: payload", () => {
  it("AT4: one SIGNER, all notifications off, all sendOptions NONE, no reminders, externalId = request, token only in redirectUrl", async () => {
    const w = startWorld();
    const adobe = happyAdobe();
    await start(w, adobe, await pageInput(w));
    const body = adobe.calls.find((c) => c.method === "POST" && c.url.endsWith("/agreements"))!.body as Record<string, unknown>;
    const sets = body.participantSetsInfo as Array<Record<string, unknown>>;
    expect(sets).toHaveLength(1);
    expect(sets[0].role).toBe("SIGNER");
    expect(sets[0].memberInfos).toHaveLength(1);
    expect([...(sets[0].disabledNotificationTypes as string[])].sort()).toEqual([...DISABLED_NOTIFICATION_TYPES].sort());
    expect((sets[0].disabledNotificationTypes as string[])).toHaveLength(5);
    expect(body.emailOption).toEqual({ sendOptions: { initEmails: "NONE", inFlightEmails: "NONE", completionEmails: "NONE" } });
    expect(body).not.toHaveProperty("reminderFrequency");
    expect(body.externalId).toEqual({ id: "req-1" });
    const redirect = (body.postSignOption as { redirectUrl: string }).redirectUrl;
    expect(redirect).toBe(`https://app.example.com/p/${TOKEN}/?signed=adobe`);
    // The token appears exactly once in everything sent to Adobe.
    const everything = JSON.stringify(adobe.calls.map((c) => ({ url: c.url, body: c.body instanceof FormData ? [...c.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : (v as File).name]) : c.body })));
    expect(everything.split(TOKEN).length - 1).toBe(1);
    expect(String(body.name).length).toBeLessThanOrEqual(255);
    expect(body.name).not.toContain(TOKEN);
    const webhook = adobe.calls.find((c) => c.url.endsWith("/webhooks"))!.body as { webhookUrlInfo: { url: string }; scope: string };
    expect(new URL(webhook.webhookUrlInfo.url).pathname).toBe("/api/esign/webhook/");
    expect(webhook.scope).toBe("RESOURCE");
    expect(JSON.stringify(webhook)).not.toContain("includeSignedDocuments");
    const signing = adobe.calls.find((c) => c.url.endsWith("/signingUrls"))!;
    expect(signing.url).not.toContain("frameParent");
  });

  it("AT4: expirationTime is the end of expires_on in the firm's zone, across a DST change", () => {
    // Nov 1, 2026 is the day New York leaves daylight time: 23:59:59 EST = 04:59:59Z on Nov 2.
    expect(expirationInstant("2026-11-01", "America/New_York")).toBe("2026-11-02T04:59:59.000Z");
    // A summer date: EDT, UTC-4.
    expect(expirationInstant("2026-07-04", "America/New_York")).toBe("2026-07-05T03:59:59.000Z");
    expect(expirationInstant(null, "America/New_York")).toBeNull();
  });

  it("AT4: the agreement's expirationTime comes from the proposal's expires_on", async () => {
    const w = startWorld();
    const adobe = happyAdobe();
    await start(w, adobe, await pageInput(w));
    const body = adobe.calls.find((c) => c.method === "POST" && c.url.endsWith("/agreements"))!.body as Record<string, unknown>;
    expect(body.expirationTime).toBe("2026-11-02T04:59:59.000Z");
  });
});

describe("AT9: a creation failure is in-app for that visit", () => {
  const failing: Array<[string, Record<string, () => Response | Promise<Response>>, string]> = [
    ["a 5xx at create", { "POST /agreements": () => json({ code: "MISC_SERVER_ERROR" }, 503) }, "adobe_unavailable"],
    ["a 429 at create", { "POST /agreements": () => json({ code: "THROTTLING_TOO_MANY_REQUESTS" }, 429, { "retry-after": "30" }) }, "adobe_rate_limited"],
    ["a timeout at create", { "POST /agreements": () => Promise.reject(Object.assign(new Error("t"), { name: "TimeoutError" })) }, "adobe_timeout"],
    ["a 429 at signingUrls", { "GET /signingUrls": () => json({ code: "THROTTLING" }, 429) }, "adobe_rate_limited"],
    ["a 5xx at signingUrls", { "GET /signingUrls": () => json({}, 500) }, "adobe_unavailable"],
    ["an http esignUrl", { "GET /signingUrls": () => json({ signingUrlSetInfos: [{ signingUrls: [{ esignUrl: "http://secure.na1.adobesign.com/x" }] }] }) }, "adobe_refused"],
    ["an esignUrl on another host", { "GET /signingUrls": () => json({ signingUrlSetInfos: [{ signingUrls: [{ esignUrl: "https://adobesign.com.evil.com/x" }] }] }) }, "adobe_refused"],
  ];
  for (const [name, routes, code] of failing) {
    it(`AT9: ${name} → failed (${code}), cancel attempted, nothing accepted, fallback in_app`, async () => {
      const w = startWorld();
      const adobe = happyAdobe(routes);
      const { result } = await start(w, adobe, await pageInput(w));
      expect(result).toEqual({ ok: false, fallback: "in_app", message: ADOBE_FALLBACK_SENTENCE });
      expect(req(w)[0].status).toBe("failed");
      expect(req(w)[0].last_error).toBe(code);
      const created = adobe.calls.some((c) => c.method === "POST" && c.url.endsWith("/agreements") && code !== "adobe_timeout" && !name.includes("at create"));
      if (created) {
        const cancel = adobe.calls.find((c) => c.method === "PUT" && c.url.endsWith("/state"))!;
        expect(cancel.body).toEqual({ state: "CANCELLED", agreementCancellationInfo: { comment: "", notifyOthers: false } });
      }
      expect((w.tables.client_proposal[0] as Row).status).toBe("sent");
      expect(logged()).not.toContain("SECRET-SIGNING-LINK");
      expect(JSON.stringify(w.tables)).not.toContain("SECRET-SIGNING-LINK");
    });
  }

  it("AT9: a cancel Adobe refuses sets cancel_failed, never a last_error value", async () => {
    const w = startWorld();
    const adobe = happyAdobe({ "GET /signingUrls": () => json({}, 500), "PUT /state": () => json({ code: "INVALID_AGREEMENT_STATE" }, 400) });
    await start(w, adobe, await pageInput(w));
    expect(req(w)[0]).toMatchObject({ status: "failed", last_error: "adobe_unavailable", cancel_failed: true });
  });

  it("AT9: adobe_agreement_id and out_for_signature are written BEFORE the webhook call; a webhook failure keeps the request open", async () => {
    const w = startWorld();
    const adobe = happyAdobe({ "POST /webhooks": () => json({ code: "INVALID_WEBHOOK" }, 400) });
    const { result } = await start(w, adobe, await pageInput(w));
    expect(result).toEqual({ ok: true, url: ESIGN_URL });
    const update = w.calls.find((c) => c.op === "update" && (c.payload as Row).adobe_agreement_id === "agr-1")!;
    const webhook = adobe.calls.find((c) => c.url.endsWith("/webhooks"))!;
    expect(update.at).toBeLessThan(webhook.at);
    expect(req(w)[0]).toMatchObject({ status: "out_for_signature", adobe_agreement_id: "agr-1", last_error: "webhook_not_registered" });
    expect(logged()).not.toContain("SECRET-SIGNING-LINK");
    expect(JSON.stringify(w.tables)).not.toContain("SECRET-SIGNING-LINK");
  });

  it("AT9: signingUrls not ready yet is retried, then answered", async () => {
    const w = startWorld();
    let n = 0;
    const adobe = happyAdobe({
      "GET /signingUrls": () => (++n < 3 ? json({ code: "AGREEMENT_NOT_EXPOSED" }, 404) : json({ signingUrlSetInfos: [{ signingUrls: [{ esignUrl: ESIGN_URL }] }] })),
    });
    const { result } = await start(w, adobe, await pageInput(w));
    expect(result).toEqual({ ok: true, url: ESIGN_URL });
    expect(n).toBe(3);
  });

  it("AT9: after the failure the in-app RPC is allowed (the fake function sees no open request)", async () => {
    const w = startWorld();
    await start(w, happyAdobe({ "POST /agreements": () => json({}, 503) }), await pageInput(w));
    const open = req(w).filter((r) => r.status === "creating" || r.status === "out_for_signature");
    expect(open).toHaveLength(0);
  });
});

describe("AT8: a 401 pauses the firm; a 4xx about one agreement does not", () => {
  it("AT8: a 401 at create marks the connection reauth", async () => {
    const w = startWorld();
    const { deps: d } = await start(w, happyAdobe({ "POST /agreements": () => json({ code: "INVALID_ACCESS_TOKEN" }, 401) }), await pageInput(w));
    expect(d.markReauth).toHaveBeenCalledWith("org-1", "conn-1");
  });
  it("AT8: a 400 about this agreement does not", async () => {
    const w = startWorld();
    const { deps: d } = await start(w, happyAdobe({ "POST /agreements": () => json({ code: "INVALID_PARTICIPANT" }, 400) }), await pageInput(w));
    expect(d.markReauth).not.toHaveBeenCalled();
    expect(req(w)[0].last_error).toBe("adobe_refused");
  });
  it("AT8: reauth or no connection with nothing open → in-app, no Adobe call", async () => {
    for (const kind of ["reauth", "none"] as const) {
      const w = startWorld();
      const adobe = happyAdobe();
      const { result } = await start(w, adobe, await pageInput(w), { access: async () => ({ kind }) });
      expect(result).toEqual({ ok: false, fallback: "in_app", message: ADOBE_SIGN_HERE_INSTEAD });
      expect(adobe.calls).toHaveLength(0);
      expect(w.rpcCalls).toHaveLength(0);
    }
  });
});

describe("AT10: an open request", () => {
  it("AT10: esign_open failing on the unique index maps to its own fixed sentence", async () => {
    const w = startWorld({ rpcImpl: () => ({ data: null, error: { code: "23505", message: "duplicate key" } }) });
    const { result } = await start(w, happyAdobe(), await pageInput(w));
    expect(result).toEqual({ ok: false, message: SIGN_MESSAGES.esign_open });
  });

  it("AT10: the in-app RPC answering loe_sign_esign_open maps to the same sentence, never the unavailable text", async () => {
    const w = startWorld({ rpcImpl: () => ({ data: null, error: { code: "23514", message: "loe_sign_esign_open: out for signature" } }) });
    const b = await pageInput(w);
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, { typedName: "Jordan Sample", agree: true, details: TEST_DETAILS, fingerprint: b.fingerprint });
    expect(r).toMatchObject({ ok: false, reason: "esign_open", message: SIGN_MESSAGES.esign_open });
  });
});

describe("AT6 / D18: an open request and the switch", () => {
  async function openedWorld() {
    const w = startWorld();
    const input = await pageInput(w);
    await start(w, happyAdobe(), input);
    return { w, input };
  }

  it("AT6: switch off, unchanged choices → resume (a fresh signingUrls), no new agreement", async () => {
    const { w, input } = await openedWorld();
    const adobe = happyAdobe();
    const { result } = await start(w, adobe, input, { switchOn: false });
    expect(result).toEqual({ ok: true, url: ESIGN_URL });
    expect(adobe.calls.map((c) => `${c.method} ${new URL(c.url).pathname.split("/").pop()}`)).toEqual(["GET signingUrls"]);
  });

  it("AT6: switch off, changed choices → the old request is cancelled (emails off), in-app, no new agreement", async () => {
    const { w } = await openedWorld();
    const changed = await pageInput(w, { selection: { "ci-logo": true } });
    const adobe = happyAdobe();
    const { result } = await start(w, adobe, changed, { switchOn: false });
    expect(result).toEqual({ ok: false, fallback: "in_app", message: ADOBE_SIGN_HERE_INSTEAD });
    // Adobe is asked first (REQUIRED 1), then the cancel.
    expect(adobe.calls.map((c) => c.method)).toEqual(["GET", "PUT"]);
    expect(req(w)[0].status).toBe("cancelled");
    expect(req(w)).toHaveLength(1);
  });

  it("AT6: switch on, changed choices → the old one is cancelled and a new request made", async () => {
    const { w } = await openedWorld();
    const changed = await pageInput(w, { selection: { "ci-logo": true } });
    const adobe = happyAdobe();
    const { result } = await start(w, adobe, changed);
    expect(result).toEqual({ ok: true, url: ESIGN_URL });
    expect(req(w).map((r) => r.status)).toEqual(["cancelled", "out_for_signature"]);
  });

  it("AT6: switch off and nothing open → in-app, no row, no Adobe call", async () => {
    const w = startWorld();
    const adobe = happyAdobe();
    const { result } = await start(w, adobe, await pageInput(w), { switchOn: false });
    expect(result).toEqual({ ok: false, fallback: "in_app", message: ADOBE_SIGN_HERE_INSTEAD });
    expect(adobe.calls).toHaveLength(0);
    expect(w.rpcCalls).toHaveLength(0);
  });

  it("a request still being created (under 10 minutes) answers busy, never a second agreement", async () => {
    const w = startWorld({ requests: [{ id: "req-9", proposal_id: "prop-2", org_id: "org-1", status: "creating", connection_id: "conn-1", created_at: new Date(NOW.getTime() - 9 * 60 * 1000).toISOString() }] });
    const adobe = happyAdobe();
    const { result } = await start(w, adobe, await pageInput(w));
    expect(result).toEqual({ ok: false, message: ESIGN_BUSY_SENTENCE });
    expect(adobe.calls).toHaveLength(0);
  });
});

describe("AT23: stuck creating", () => {
  it("AT23: start's out_for_signature update after the row was closed changes 0 rows: the agreement is cancelled, in-app", async () => {
    const w = startWorld();
    const adobe = happyAdobe({
      // The path read closes the row while Adobe is creating the agreement.
      "POST /agreements": () => {
        (w.tables.client_proposal_esign_request as Row[])[0].status = "failed";
        (w.tables.client_proposal_esign_request as Row[])[0].last_error = "creation_interrupted";
        return json({ id: "agr-1" }, 201);
      },
    });
    const { result } = await start(w, adobe, await pageInput(w));
    expect(result).toEqual({ ok: false, fallback: "in_app", message: ADOBE_FALLBACK_SENTENCE });
    expect(adobe.calls.some((c) => c.method === "PUT" && c.url.includes("/agreements/agr-1/state"))).toBe(true);
    expect(adobe.calls.some((c) => c.url.endsWith("/webhooks") || c.url.endsWith("/signingUrls"))).toBe(false);
  });

  it("AT23: an 11-minute-old creating row is closed (creation_interrupted) before a new request is opened", async () => {
    const w = startWorld({ requests: [{ id: "req-old", proposal_id: "prop-2", org_id: "org-1", status: "creating", connection_id: "conn-1", created_at: new Date(NOW.getTime() - 11 * 60 * 1000).toISOString() }] });
    const { result } = await start(w, happyAdobe(), await pageInput(w));
    expect(result).toEqual({ ok: true, url: ESIGN_URL });
    expect(req(w)[0]).toMatchObject({ id: "req-old", status: "failed", last_error: "creation_interrupted" });
  });
});

describe("readiness", () => {
  it("a letter that is no longer the firm's current one, or a client email that isn't real, is in-app with no row", async () => {
    for (const over of [{ letterCurrent: async () => "stale" as const }]) {
      const w = startWorld();
      const adobe = happyAdobe();
      const { result } = await start(w, adobe, await pageInput(w), over);
      expect(result).toMatchObject({ fallback: "in_app" });
      expect(w.rpcCalls).toHaveLength(0);
    }
    const w = startWorld({ proposal: { client_email: "not-an-address" } });
    const adobe = fakeAdobe({});
    const input = await pageInput(w).catch(() => null);
    if (input) {
      const r = await runStartAdobeSigning(input, deps(w, adobe));
      expect(r).toMatchObject({ fallback: "in_app" });
      expect(adobe.calls).toHaveLength(0);
    }
  });
});

describe("REQUIRED 1: never signed twice: Adobe is asked before an open request is cancelled or replaced", () => {
  async function openedWorld() {
    const w = startWorld();
    const input = await pageInput(w);
    await start(w, happyAdobe(), input);
    expect(req(w)[0].status).toBe("out_for_signature");
    return { w, input };
  }
  const signed = { "GET /agreements/[^/]+": () => json({ id: "agr-1", status: "SIGNED" }) };
  const created = (adobe: ReturnType<typeof happyAdobe>) => adobe.calls.filter((c) => c.method === "POST" && c.url.endsWith("/agreements")).length;

  it("signed in Adobe, back on the page, pressed again (signingUrls fails): the waiting sentence, no fallback, no new agreement, nothing closed", async () => {
    for (const switchOn of [true, false]) {
      const { w, input } = await openedWorld();
      const adobe = happyAdobe({ ...signed, "GET /signingUrls": () => json({ code: "AGREEMENT_NOT_EXPOSED" }, 404) });
      const { result } = await start(w, adobe, input, { switchOn });
      expect(result).toEqual({ ok: false, message: ESIGN_SIGNED_WAITING_SENTENCE });
      expect(result).not.toHaveProperty("fallback");
      expect(created(adobe)).toBe(0);
      expect(adobe.calls.some((c) => c.method === "PUT")).toBe(false);
      expect(req(w)).toHaveLength(1);
      expect(req(w)[0].status).toBe("out_for_signature");
    }
  });

  it("a signingUrls failure on resume never calls failRequest: still open at Adobe → our cancel succeeds → only then a new agreement (switch on)", async () => {
    const { w, input } = await openedWorld();
    const adobe = happyAdobe({ "GET /signingUrls": (() => { let n = 0; return () => (++n <= 1 ? json({}, 500) : json({ signingUrlSetInfos: [{ signingUrls: [{ esignUrl: ESIGN_URL }] }] })); })() });
    const { result } = await start(w, adobe, input);
    const methods = adobe.calls.map((c) => `${c.method} ${new URL(c.url).pathname.split("/").slice(-1)[0]}`);
    expect(methods.indexOf("GET agr-1")).toBeLessThan(methods.indexOf("PUT state"));
    expect(req(w)[0]).toMatchObject({ status: "cancelled", last_error: null });
    expect(result).toEqual({ ok: true, url: ESIGN_URL });
    expect(req(w)[1].status).toBe("out_for_signature");
  });

  it("changed choices on a SIGNED agreement: no cancel, no close, no new agreement, no in-app", async () => {
    const { w } = await openedWorld();
    const changed = await pageInput(w, { selection: { "ci-logo": true } });
    for (const switchOn of [true, false]) {
      const adobe = happyAdobe(signed);
      const { result } = await start(w, adobe, changed, { switchOn });
      expect(result).toEqual({ ok: false, message: ESIGN_SIGNED_WAITING_SENTENCE });
      expect(adobe.calls.map((c) => c.method)).toEqual(["GET"]);
      expect(req(w)).toHaveLength(1);
      expect(req(w)[0].status).toBe("out_for_signature");
    }
  });

  it("changed choices with the cancel refused: paused, the request left open, no second agreement", async () => {
    const { w } = await openedWorld();
    const changed = await pageInput(w, { selection: { "ci-logo": true } });
    const adobe = happyAdobe({ "PUT /state": () => json({ code: "INVALID_AGREEMENT_STATE" }, 400) });
    const { result } = await start(w, adobe, changed);
    expect(result).toEqual({ ok: false, message: ESIGN_PAUSED_SENTENCE });
    expect(created(adobe)).toBe(0);
    expect(w.rpcCalls.filter((c) => c.fn === "client_proposal_esign_open")).toHaveLength(1);
    expect(req(w)).toHaveLength(1);
    expect(req(w)[0]).toMatchObject({ status: "out_for_signature", cancel_failed: false });
  });

  it("changed choices with the re-read failing: paused, nothing cancelled or closed", async () => {
    const { w } = await openedWorld();
    const changed = await pageInput(w, { selection: { "ci-logo": true } });
    const adobe = happyAdobe({ "GET /agreements/[^/]+": () => json({}, 503) });
    const { result } = await start(w, adobe, changed);
    expect(result).toEqual({ ok: false, message: ESIGN_PAUSED_SENTENCE });
    expect(adobe.calls.map((c) => c.method)).toEqual(["GET"]);
    expect(req(w)[0].status).toBe("out_for_signature");
  });

  it("changed choices on an agreement Adobe already reports CANCELLED / EXPIRED / DECLINED: closed to match, no cancel call, then a new one", async () => {
    for (const [adobeStatus, ours] of [["CANCELLED", "cancelled"], ["EXPIRED", "expired"], ["DECLINED", "declined"]] as const) {
      const { w } = await openedWorld();
      const changed = await pageInput(w, { selection: { "ci-logo": true } });
      const adobe = happyAdobe({ "GET /agreements/[^/]+": () => json({ status: adobeStatus }) });
      const { result } = await start(w, adobe, changed);
      expect(result).toEqual({ ok: true, url: ESIGN_URL });
      expect(adobe.calls.some((c) => c.method === "PUT")).toBe(false);
      expect(req(w).map((r) => r.status)).toEqual([ours, "out_for_signature"]);
    }
  });
});

describe("REQUIRED 2: an open request whose connection is gone is closed, then in-app", () => {
  const open = (connection_id: string | null) => ({ id: "req-9", proposal_id: "prop-2", org_id: "org-1", status: "out_for_signature", connection_id, adobe_agreement_id: "agr-9", canonical_fingerprint: "f".repeat(64), created_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() });

  it("connection_id null, or the connection revoked / deleted (access none): cancelled + cancel_failed (fenced on status), in-app", async () => {
    for (const [row, access] of [[open(null), undefined], [open("conn-1"), async () => ({ kind: "none" as const })]] as const) {
      const w = startWorld({ requests: [row] });
      const adobe = happyAdobe();
      const { result } = await start(w, adobe, await pageInput(w), access ? { access } : {});
      expect(result).toEqual({ ok: false, fallback: "in_app", message: ADOBE_SIGN_HERE_INSTEAD });
      expect(req(w)[0]).toMatchObject({ status: "cancelled", cancel_failed: true });
      const close = w.calls.find((c) => c.op === "update" && (c.payload as Row).status === "cancelled")!;
      expect(close.filters).toContainEqual(["eq", "status", "out_for_signature"]);
      expect(adobe.calls).toHaveLength(0);
    }
  });

  it("reauth or unavailable stays paused: the request left open, no in-app, no Adobe call", async () => {
    for (const kind of ["reauth", "unavailable"] as const) {
      const w = startWorld({ requests: [open("conn-1")] });
      const adobe = happyAdobe();
      const { result } = await start(w, adobe, await pageInput(w), { access: async () => ({ kind }) });
      expect(result).toEqual({ ok: false, message: ESIGN_PAUSED_SENTENCE });
      expect(req(w)[0].status).toBe("out_for_signature");
      expect(adobe.calls).toHaveLength(0);
    }
  });
});

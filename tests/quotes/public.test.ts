import { describe, expect, it } from "vitest";

import {
  PUBLIC_ORG_COLUMNS,
  PUBLIC_QUOTE_COLUMNS,
  PUBLIC_QUOTE_LINE_COLUMNS,
  acceptPublicQuote,
  declinePublicQuote,
  buildAcceptedSnapshot,
  coarseUserAgent,
  isWellFormedPublicToken,
  parseInet,
  quoteAgreementFingerprint,
  quoteLinesFingerprint,
  readPublicQuote,
  recordQuoteViewed,
  type AcceptInput,
  type AcceptResult,
  type PublicQuoteLine,
} from "@/lib/quotes/public";
import { quoteTotals } from "@/lib/quotes/pricing";
import type { ClientChoice } from "@/lib/quotes/packages";
import { FakeDb, type Row } from "./fake-db";

/**
 * `/q/[token]` is the only unauthenticated surface in this product, and RLS
 * cannot be its boundary — an anon caller has no `active_org_id` claim, so
 * every policy evaluates against null. The token is the whole credential, and
 * everything below tests one of the properties that makes that safe.
 *
 * ── WHY THIS RUNS AGAINST A FAKE AND NOT A CLOUD PROJECT ────────────────────
 * `pnpm test` runs against whichever CLOUD project `.env.test` names; there is
 * no local Postgres. That rules out the test this file most needs to contain:
 * the double-accept race, which requires two requests interleaved at a chosen
 * instant, with the second reaching its UPDATE only after the first has
 * committed. A fake with a barrier can arrange exactly that, deterministically,
 * on every run.
 *
 * The fake (./fake-db.ts) is a small PostgREST shape — `.eq/.in/.is/.or/
 * .order/.limit`, projection by the requested column list, and set-based
 * updates that return the rows they actually changed. That last part is the one
 * that matters: the acceptance guard is a WHERE clause, and "how many rows came
 * back" is the signal it turns on.
 *
 * What this cannot test, and what covers it instead: that Postgres evaluates
 * the same predicate under real concurrency (row locks), and that RLS is
 * configured as 0068 writes it. Those live in `tests/tenant-isolation.test.ts`
 * against a real database.
 *
 * Ported from lectual (branch claude/lectual-firm-dashboard-prd-f3loev) without
 * the line-request, readable-slug, logo and crm_activity-timeline cases — this
 * app has none of those (see PORTED_FROM.md). The decline cases are new, and so
 * is the offer model (packages.ts): packages chosen whole, `selected` as the
 * firm's offer until signature, the client's pick travelling with the
 * signature. The selection-persistence cases went with the endpoint they
 * tested; what replaced them asserts that no refusal writes anything.
 */

/* ────────────────────────────── fixtures ───────────────────────────────── */

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const MATTER_ID = "22222222-2222-2222-2222-222222222222";
const QUOTE_ID = "33333333-3333-3333-3333-333333333333";
const TOKEN = "PVWaKF2p3wEhVsD8lQd0XgYbZn7RTuJc1MkO5eA9iL4";
const OTHER_TOKEN = "ZZZZZZ2p3wEhVsD8lQd0XgYbZn7RTuJc1MkO5eA9iL4";

const NOW = new Date("2026-09-09T15:00:00.000Z");

/**
 * A quote with two offered PACKAGES (Comprehensive carries its own second-class
 * USPTO fee), a line in every package, an offered add-on, and a USPTO fee — the
 * shape §0 is about — plus a package and an add-on the firm has WITHHELD
 * (`selected: false`), which must never reach the client. Integer cents.
 */
function lineFixtures(): Row[] {
  return [
    line({ id: "line-flat", kind: "legal_fee", charge_at: "signing", selection: "included", selected: true, label: "Trademark filing — flat fee", unit_amount_cents: 150_000, sort_index: 10 }),
    line({ id: "line-std", kind: "legal_fee", charge_at: "signing", selection: "tier_option", tier_group: "Standard", selected: true, label: "Standard search", unit_amount_cents: 95_000, sort_index: 20 }),
    line({ id: "line-prem", kind: "legal_fee", charge_at: "signing", selection: "tier_option", tier_group: "Comprehensive", selected: true, label: "Comprehensive search", unit_amount_cents: 165_000, sort_index: 30 }),
    line({ id: "line-prem-uspto", kind: "government_fee", charge_at: "filing", selection: "tier_option", tier_group: "Comprehensive", selected: true, label: "USPTO fee, second class", unit_amount_cents: 35_000, sort_index: 35 }),
    line({ id: "line-budget", kind: "legal_fee", charge_at: "signing", selection: "tier_option", tier_group: "Budget", selected: false, label: "Knockout search only", unit_amount_cents: 40_000, sort_index: 38 }),
    line({ id: "line-monitor", kind: "legal_fee", charge_at: "signing", selection: "optional", selected: true, label: "Watch service, year one", unit_amount_cents: 50_000, sort_index: 40 }),
    line({ id: "line-drawing", kind: "legal_fee", charge_at: "signing", selection: "optional", selected: false, label: "Design mark drawing", unit_amount_cents: 25_000, sort_index: 45 }),
    line({ id: "line-uspto", kind: "government_fee", charge_at: "filing", selection: "included", selected: true, label: "USPTO filing fee (1 class)", unit_amount_cents: 35_000, sort_index: 50 }),
  ];
}

/** The client's pick, as the page sends it. */
function pick(pkg: string | null, addOns: string[] = []): ClientChoice {
  return { package: pkg, addOns };
}

function line(overrides: Row): Row {
  return {
    org_id: ORG_ID,
    quote_id: QUOTE_ID,
    tier_group: null,
    description: null,
    quantity: 1,
    source_service_item_id: null,
    ...overrides,
  };
}

function quoteRow(overrides: Row = {}): Row {
  return {
    id: QUOTE_ID,
    org_id: ORG_ID,
    matter_id: MATTER_ID,
    lead_id: null,
    contact_id: null,
    title: "Trademark registration — ACME",
    status: "sent",
    currency: "USD",
    intro_body: "Here is what we propose.",
    terms_body: "Flat fees, billed as set out above.",
    expires_at: "2026-09-30T23:59:00.000Z",
    sent_at: "2026-09-08T12:00:00.000Z",
    accepted_at: null,
    declined_at: null,
    withdrawn_at: null,
    public_token: TOKEN,
    accepted_by_name: null,
    accepted_by_email: null,
    accepted_ip: null,
    accepted_user_agent: null,
    accepted_snapshot: null,
    created_by: "user-1",
    created_at: "2026-09-08T11:00:00.000Z",
    updated_at: "2026-09-08T12:00:00.000Z",
    ...overrides,
  };
}

function makeDb(quoteOverrides: Row = {}, lines: Row[] = lineFixtures()): FakeDb {
  return new FakeDb({
    crm_quote: [quoteRow(quoteOverrides)],
    crm_quote_line: lines,
    crm_quote_event: [],
    crm_org: [{ id: ORG_ID, name: "Beliard IP", slug: "beliard", modules: [] }],
  });
}

/** The fingerprint `/q/[token]` would have rendered the page with, for the rows
 * as they stand right now. */
async function renderedFingerprint(db: FakeDb, now: Date = NOW): Promise<string> {
  const read = await readPublicQuote(TOKEN, now, db);
  if (read.status !== "ok") throw new Error(`expected a readable quote, got ${read.status}`);
  return read.view.linesFingerprint;
}

/**
 * Sign the way a real client does: READ the proposal, then send the signature
 * back carrying the fingerprint of the figures THAT read produced.
 *
 * Every acceptance below goes through this, because it is the only sequence the
 * product can actually perform — the page renders from a read and the accept
 * form echoes that render's `linesFingerprint`. A test that hand-wrote a
 * fingerprint would be asserting against a client that does not exist.
 *
 * Same argument order as `acceptPublicQuote`, so the two are interchangeable at
 * a call site: the tests that need the read and the signature separated in time
 * — the race, the one where the database is down, and the stale-figures tests
 * below — call the real function directly with a fingerprint they captured
 * earlier, which is exactly what a client with the page still open has.
 */
async function signAsClient(
  input: Omit<AcceptInput, "linesFingerprint">,
  now: Date,
  db: FakeDb,
): Promise<AcceptResult> {
  const linesFingerprint = await renderedFingerprint(db, now);
  return acceptPublicQuote({ ...input, linesFingerprint }, now, db);
}

/* ──────────────────────── the column allowlists ─────────────────────────── */


describe("column allowlists — §6.2", () => {
  it("never reads the internal record ids out of crm_quote at all", () => {
    // Not "reads them and strips them" — the strongest version of this rule is
    // that the columns never leave the database, so there is nothing to strip
    // and nothing a later refactor can forget to strip.
    for (const column of ["matter_id", "lead_id", "contact_id", "created_by"]) {
      expect(PUBLIC_QUOTE_COLUMNS).not.toContain(column);
    }
  });

  it("never reads the e-sign audit fields back out", () => {
    // Captured FOR the firm. Echoing a stored IP or email to whoever holds the
    // link hands it to the wrong holder of it.
    for (const column of ["accepted_ip", "accepted_user_agent", "accepted_by_email"]) {
      expect(PUBLIC_QUOTE_COLUMNS).not.toContain(column);
    }
  });

  it("does not follow a line back to the firm's private service library", () => {
    expect(PUBLIC_QUOTE_LINE_COLUMNS).not.toContain("source_service_item_id");
  });

  it("reads only the firm's display identity", () => {
    expect([...PUBLIC_ORG_COLUMNS]).toEqual(["name"]);
  });

  it("never reads the token back out, and names no column this app's databases lack", () => {
    // The caller already holds the token. `public_slug` is lectual's 0070,
    // which is not in lectual.app's databases — naming it would turn every
    // read into a 42703 and every proposal into "unavailable".
    expect(PUBLIC_QUOTE_COLUMNS).not.toContain("public_token");
    expect(PUBLIC_QUOTE_COLUMNS).not.toContain("public_slug");
  });

  it("never reads the token back out into the client payload", async () => {
    // The page has the token from its own URL and hands it to the server
    // actions from there.
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(JSON.stringify(read.view)).not.toContain(TOKEN);
  });

  it("sends an explicit column list to every table — never select('*')", async () => {
    const db = makeDb();
    await readPublicQuote(TOKEN, NOW, db);
    expect(db.selects.length).toBeGreaterThan(0);
    for (const { columns } of db.selects) expect(columns).not.toContain("*");
  });
});

describe("the payload sent to the client", () => {
  it("contains no org_id and no matter_id — by name or by value", async () => {
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;

    // Serialise it the way the RSC payload does: whatever survives this is what
    // reaches the browser.
    const wire = JSON.stringify(read.view);
    expect(wire).not.toContain("org_id");
    expect(wire).not.toContain("matter_id");
    expect(wire).not.toContain(ORG_ID);
    expect(wire).not.toContain(MATTER_ID);
    // The credential itself must not be echoed back into the page body either.
    expect(wire).not.toContain(TOKEN);
  });

  it("keeps the ids the writes need on the server-side handle instead", async () => {
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.handle.orgId).toBe(ORG_ID);
    expect(read.handle.quoteId).toBe(QUOTE_ID);
    // …and the handle is a separate object, so a component receiving `view`
    // cannot reach them.
    expect(Object.keys(read.view)).not.toContain("orgId");
  });

  it("returns the firm's display name and nothing else about it", async () => {
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.firm).toEqual({ name: "Beliard IP", timeZone: "America/New_York" });
  });

  it("shows dates on the quote's OWN firm's clock, read by the quote's org id", async () => {
    const db = makeDb();
    db.tables.crm_org_profile = [
      { org_id: "some-other-org", time_zone: "Asia/Tokyo" },
      { org_id: ORG_ID, time_zone: "America/Denver", email_signature: "private" },
    ];
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.firm.timeZone).toBe("America/Denver");
    expect(db.selects.filter((q) => q.table === "crm_org_profile").map((q) => q.columns)).toEqual(["time_zone"]);
  });

  it("falls back to the default zone when the profile cannot be read, rather than failing the page", async () => {
    const db = makeDb();
    db.failTable = "crm_org_profile";
    const read = await readPublicQuote(TOKEN, NOW, db);
    expect(read.status).toBe("ok");
    if (read.status === "ok") expect(read.view.firm.timeZone).toBe("America/New_York");
  });

  it("publishes the OFFER — a withheld package or add-on never reaches the browser", async () => {
    // `selected` on a package/add-on line is the firm's offer switch until
    // signature (packages.ts). What the firm switched off is not part of what
    // this client was sent, so it is absent from the payload, not merely hidden.
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.lines.map((l) => l.id)).toEqual([
      "line-flat",
      "line-std",
      "line-prem",
      "line-prem-uspto",
      "line-monitor",
      "line-uspto",
    ]);
    const wire = JSON.stringify(read.view);
    expect(wire).not.toContain("Knockout search only");
    expect(wire).not.toContain("Budget");
    expect(wire).not.toContain("Design mark drawing");
    expect(read.handle.offerIntact).toBe(true);
  });

  it("marks an offer with packages but none switched on as not signable", async () => {
    const db = makeDb(
      {},
      lineFixtures().map((l) => (l.selection === "tier_option" ? { ...l, selected: false } : l)),
    );
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.handle.offerIntact).toBe(false);
    const result = await acceptPublicQuote(
      { token: TOKEN, name: "Dana Reyes", choice: pick(null), linesFingerprint: read.view.linesFingerprint, ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toMatchObject({ ok: false, reason: "not_ready" });
    expect(db.tables.crm_quote[0].status).toBe("sent");
  });
});

describe("an unknown token is nothing at all — §6.3", () => {
  it("404s a token that names no quote", async () => {
    const db = makeDb();
    const read = await readPublicQuote(OTHER_TOKEN, NOW, db);
    expect(read).toEqual({ status: "not_found" });
  });

  it("404s a malformed token WITHOUT touching the database", async () => {
    const db = makeDb();
    expect(await readPublicQuote("short", NOW, db)).toEqual({ status: "not_found" });
    expect(await readPublicQuote("", NOW, db)).toEqual({ status: "not_found" });
    // A token-guessing loop should cost a regex, not a round trip — and every
    // character that could reach PostgREST's filter parser is refused here.
    expect(db.queryCount.value).toBe(0);
  });

  it("refuses a token carrying filter punctuation", () => {
    expect(isWellFormedPublicToken(`${TOKEN},foo`)).toBe(false);
    expect(isWellFormedPublicToken(`${TOKEN}.eq`)).toBe(false);
    expect(isWellFormedPublicToken(`${TOKEN}(x)`)).toBe(false);
    expect(isWellFormedPublicToken(TOKEN)).toBe(true);
  });

  it("404s a DRAFT quote — indistinguishably from an unknown token", async () => {
    // A draft's token exists but the firm has not sent it. Saying "not sent
    // yet" would confirm to a caller that their guess named a real quote.
    const db = makeDb({ status: "draft", sent_at: null });
    expect(await readPublicQuote(TOKEN, NOW, db)).toEqual({ status: "not_found" });
  });

  it("distinguishes an unreachable database from a missing quote", async () => {
    // The one thing that must NOT collapse into not_found: rendering a 404
    // because the database was unreachable tells a client the proposal their
    // lawyer sent them does not exist.
    const db = makeDb();
    db.failTable = "crm_quote";
    expect(await readPublicQuote(TOKEN, NOW, db)).toEqual({ status: "unavailable" });
  });

  it("refuses to render a quote whose firm cannot be read", async () => {
    const db = makeDb();
    db.tables.crm_org = [];
    // Not "Your firm" and not a blank header — a client is being asked to sign
    // an agreement with somebody, and we could not say who.
    expect(await readPublicQuote(TOKEN, NOW, db)).toEqual({ status: "unavailable" });
  });
});

describe("terminal states — §6.4", () => {
  it("reads an expired quote as expired even though the stored status says sent", async () => {
    // Expiry is evaluated on READ, by comparing instants. There is no job
    // writing `expired` back, and a client must never see a live accept button
    // because a cron did not run.
    const db = makeDb({ expires_at: "2026-09-08T23:59:00.000Z" });
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.status).toBe("expired");
    expect(read.handle.storedStatus).toBe("sent");
  });

  it("refuses to accept an expired quote", async () => {
    const db = makeDb({ expires_at: "2026-09-08T23:59:00.000Z" });
    const result = await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "not_live" });
    expect(db.tables.crm_quote[0].status).toBe("sent");
  });

  it("refuses to accept a withdrawn quote", async () => {
    const db = makeDb({ status: "withdrawn", withdrawn_at: "2026-09-09T09:00:00.000Z" });
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.status).toBe("withdrawn");
    const result = await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "not_live" });
  });

  it("refuses to accept a declined quote", async () => {
    const db = makeDb({ status: "declined", declined_at: "2026-09-09T09:00:00.000Z" });
    const result = await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "not_live" });
  });

});

describe("the client's pick is validated against the offer they were shown — §6.5", () => {
  const signer = { name: "Dana Reyes", email: "dana@example.test" };

  async function signWith(db: FakeDb, choice: ClientChoice): Promise<AcceptResult> {
    return signAsClient({ token: TOKEN, ...signer, choice, ip: null, userAgent: null }, NOW, db);
  }

  it("REJECTS a package that is not on offer rather than ignoring it", async () => {
    // Ignoring it would sign the client up for something other than what they
    // picked. A withheld package is as unknown to them as a made-up one.
    for (const name of ["Budget", "Platinum"]) {
      const db = makeDb();
      const result = await signWith(db, pick(name));
      expect(result, name).toEqual({ ok: false, reason: "unknown_line" });
      expect(db.writes, name).toEqual([]);
    }
  });

  it("REJECTS an add-on id from outside the offer — withheld, included, or another quote's", async () => {
    for (const id of ["line-drawing", "line-flat", "line-prem", "someone-elses-line"]) {
      const db = makeDb();
      const result = await signWith(db, pick("Standard", [id]));
      expect(result, id).toEqual({ ok: false, reason: "unknown_line" });
      expect(db.writes, id).toEqual([]);
    }
  });

  it("takes the package whole: every one of its lines, and none of the other package's", async () => {
    const db = makeDb();
    const result = await signWith(db, pick("Comprehensive", ["line-monitor"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const taken = result.snapshot.lines.filter((l) => l.selected).map((l) => l.id);
    expect(taken.sort()).toEqual(["line-flat", "line-monitor", "line-prem", "line-prem-uspto", "line-uspto"]);
    expect(result.snapshot.totals.due_at_signing).toBe(150_000 + 165_000 + 50_000);
    // The package's own USPTO fee is at filing with the every-package one.
    expect(result.snapshot.totals.due_at_filing).toBe(35_000 + 35_000);
  });

  it("gives an anonymous caller exactly three write endpoints — accept, decline and pay (after signing)", async () => {
    // The ported engine persisted every tick from this unauthenticated route
    // (`saveSelectionAction`). Here the rows' `selected` is the firm's offer
    // until signature, so no endpoint lets a client write it: ticking a box
    // writes nothing, and the pick arrives once, with the signature. Paying is
    // its own endpoint that only works on an already-accepted quote (spec §7.4).
    const actions = await import("@/app/q/[token]/actions");
    expect(Object.keys(actions).sort()).toEqual(["acceptQuoteAction", "declineQuoteAction", "payQuoteAction"]);
  });
});

describe("acceptance", () => {
  const signer = { name: "Dana Reyes", email: "dana@example.test" };

  it("refuses to accept while a package is unchosen, and says which reason", async () => {
    const db = makeDb();
    const result = await signAsClient({ token: TOKEN, ...signer, ip: null, userAgent: null }, NOW, db);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("not_ready");
    // The accept button has to be able to say WHY it is disabled.
    expect(result.message).toBe("Choose a package.");
    expect(db.tables.crm_quote[0].status).toBe("sent");
  });

  it("accepts once, freezing the snapshot with the two amounts split", async () => {
    const db = makeDb();
    const result = await signAsClient(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), ip: "203.0.113.9", userAgent: "Mozilla/5.0 (Macintosh)" },
      NOW,
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = db.tables.crm_quote[0];
    expect(row.status).toBe("accepted");
    expect(row.accepted_by_name).toBe("Dana Reyes");
    expect(row.accepted_ip).toBe("203.0.113.9");
    expect(row.accepted_snapshot).toBeTruthy();

    const snapshot = result.snapshot;
    // §0: the firm's flat fee and the chosen package at signing; the USPTO fees
    // — the every-package one and the package's own — are NOT in that figure,
    // and never can be.
    expect(snapshot.totals.due_at_signing).toBe(150_000 + 165_000);
    expect(snapshot.totals.due_at_filing).toBe(35_000 + 35_000);
    expect(snapshot.totals.full_project_cost).toBe(150_000 + 165_000 + 35_000 + 35_000);
    // The package not taken is in the record too — what was offered, not only
    // what was taken — and so is the add-on the client left unticked.
    expect(snapshot.lines.find((l) => l.id === "line-std")?.selected).toBe(false);
    expect(snapshot.lines.find((l) => l.id === "line-monitor")?.selected).toBe(false);
    // What the firm withheld was never offered, so it is not in the record.
    expect(snapshot.lines.map((l) => l.id)).not.toContain("line-budget");
    expect(snapshot.lines.map((l) => l.id)).not.toContain("line-drawing");
    expect(snapshot.signature).toEqual({ name: "Dana Reyes", email: "dana@example.test" });
    expect(snapshot.quote.terms_body).toBe("Flat fees, billed as set out above.");

    const events = db.tables.crm_quote_event.filter((e) => e.type === "accepted");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ package: "Comprehensive", due_at_signing_cents: 315_000 });
  });

  it("signs with a typed name alone — an email is optional, and checked only if given", async () => {
    const db = makeDb();
    const result = await signAsClient({ token: TOKEN, name: "Dana Reyes", choice: pick("Standard"), ip: null, userAgent: null }, NOW, db);
    expect(result.ok).toBe(true);
    expect(db.tables.crm_quote[0].accepted_by_email).toBeNull();
    expect((db.tables.crm_quote[0].accepted_snapshot as { signature: { email: string } }).signature.email).toBe("");
  });

  it("cannot be accepted twice — the second attempt is refused, not applied", async () => {
    const db = makeDb();
    const first = await signAsClient(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(first.ok).toBe(true);

    const second = await signAsClient(
      { token: TOKEN, name: "Someone Else", email: "else@example.test", choice: pick("Standard"), ip: null, userAgent: null },
      new Date(NOW.getTime() + 1000),
      db,
    );
    expect(second).toEqual({ ok: false, reason: "already_resolved" });

    // The FIRST signature is what stands. A second acceptance overwriting
    // `accepted_snapshot` would rewrite what somebody signed.
    const row = db.tables.crm_quote[0];
    expect(row.accepted_by_name).toBe("Dana Reyes");
    expect((row.accepted_snapshot as { signature: { name: string } }).signature.name).toBe("Dana Reyes");
    expect(db.tables.crm_quote_event.filter((e) => e.type === "accepted")).toHaveLength(1);
  });

  it("THE RACE: two concurrent acceptances produce exactly one", async () => {
    // Both requests are held at their first read until both have arrived, so
    // both pass every JavaScript check on a `sent` quote and both reach the
    // UPDATE. The only thing standing between that and two acceptances is the
    // conditional WHERE clause — which is exactly what this asserts.
    const db = makeDb();

    // Both readers are looking at the same unchanged page, so they hold the
    // same fingerprint. Captured before the barrier goes in, so the only reads
    // the barrier counts are the two acceptances' own.
    const onScreen = await renderedFingerprint(db);

    let arrived = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.beforeQuery = async (table, op) => {
      if (table !== "crm_quote" || op !== "select") return;
      arrived += 1;
      if (arrived >= 2) release();
      await gate;
    };

    const [a, b] = await Promise.all([
      acceptPublicQuote({ token: TOKEN, name: "First Signer", email: "a@example.test", choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null }, NOW, db),
      acceptPublicQuote({ token: TOKEN, name: "Second Signer", email: "b@example.test", choice: pick("Standard"), linesFingerprint: onScreen, ip: null, userAgent: null }, NOW, db),
    ]);

    const outcomes = [a, b];
    expect(outcomes.filter((r) => r.ok)).toHaveLength(1);
    const loser = outcomes.find((r) => !r.ok);
    expect(loser && !loser.ok && loser.reason).toBe("already_resolved");

    // One acceptance in the database, one `accepted` event, one signature.
    expect(db.tables.crm_quote[0].status).toBe("accepted");
    expect(db.tables.crm_quote_event.filter((e) => e.type === "accepted")).toHaveLength(1);
    const winner = outcomes.find((r) => r.ok);
    expect(db.tables.crm_quote[0].accepted_by_name).toBe(
      winner && winner.ok ? winner.snapshot.signature.name : "",
    );
    // Only the winner writes its choice back to the rows — the loser's pick
    // touches nothing.
    expect(db.writes.filter((w) => w.table === "crm_quote_line")).toHaveLength(1);
    const taken = winner && winner.ok ? winner.snapshot.lines.filter((l) => l.selected && l.selection === "tier_option")[0]?.tier_group : null;
    const rows = db.tables.crm_quote_line;
    for (const row of rows.filter((r) => r.selection === "tier_option")) {
      expect(row.selected, String(row.id)).toBe(row.tier_group === taken);
    }
  });

  it("accepts on the exact expiry millisecond — the boundary is exclusive", async () => {
    // `isQuoteExpired` lets a client clicking accept on the exact instant in,
    // "erring the other way would refuse an on-time signature". The conditional
    // update has to agree with it, or the JS check passes, the database refuses,
    // and the client is told somebody else signed first.
    const db = makeDb({ expires_at: NOW.toISOString() }, lineFixtures());
    const result = await signAsClient(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result.ok).toBe(true);
    expect(db.tables.crm_quote[0].status).toBe("accepted");
  });

  it("refuses a signature that is not a name or not an email, before touching the row", async () => {
    const db = makeDb();
    const noName = await signAsClient(
      { token: TOKEN, name: " ", email: "dana@example.test", choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(noName.ok).toBe(false);
    if (!noName.ok) expect(noName.reason).toBe("invalid_name");

    const badEmail = await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@nope", choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(badEmail.ok).toBe(false);
    if (!badEmail.ok) expect(badEmail.reason).toBe("invalid_email");

    expect(db.tables.crm_quote[0].status).toBe("sent");
    // The refusal happens before any write, so a rejected signature
    // leaves nothing behind at all.
    expect(db.tables.crm_quote_event).toHaveLength(0);
  });

  it("refuses the whole acceptance when the pick it carries is not on offer", async () => {
    // A signature over a choice the client could not have made is a signature
    // over something else.
    const db = makeDb();
    const result = await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", choice: pick("Budget"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "unknown_line" });
    expect(db.tables.crm_quote[0].status).toBe("sent");
  });

  it("still accepts when the client's IP cannot be parsed", async () => {
    // `accepted_ip` is `inet`; Postgres rejects a malformed value, so an
    // unvalidated x-forwarded-for would not corrupt the audit trail — it would
    // stop someone signing. Unparseable means null.
    const db = makeDb();
    const result = await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", choice: pick("Comprehensive"), ip: "not-an-ip", userAgent: null },
      NOW,
      db,
    );
    expect(result.ok).toBe(true);
    expect(db.tables.crm_quote[0].accepted_ip).toBeNull();
  });

  it("reports unavailable rather than failure when the update cannot be run", async () => {
    const db = makeDb();
    // The client read the page while the database was still up; it goes down
    // between that render and their signature.
    const onScreen = await renderedFingerprint(db);
    db.failTable = "crm_quote";
    const result = await acceptPublicQuote(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result.ok).toBe(false);
    // Not `already_resolved` — "we couldn't reach the database" and "somebody
    // else signed it" are different things to tell a client.
    if (!result.ok) expect(["unavailable", "unconfigured"]).toContain(result.reason);
  });
});

describe("a signature over figures that moved is refused, never repriced", () => {
  const signer = { name: "Dana Reyes", email: "dana@example.test" };

  /**
   * THE REPRODUCTION, verbatim.
   *
   * The client opens the link and reads "Due today $3,150.00" — the firm's flat
   * fee at $1,500 plus the package they picked. A staff member then edits that
   * flat-fee line to $4,750 while the page is still open on the client's
   * screen. The client clicks "Accept and sign".
   *
   * Before the fingerprint existed this returned `ok`, and
   * `accepted_snapshot.totals.due_at_signing` came out at the NEW figure: the
   * client signed $6,400 having read $3,150, and §5's frozen legal record —
   * whose entire purpose is to hold what someone agreed to — stored the number
   * they were never shown. The selection carries only line IDS, and a re-priced
   * line keeps its id, so the ids alone had nothing to object to.
   */
  it("REFUSES when a line was re-priced after the client read the page", async () => {
    const db = makeDb();

    // The client's page: this read is what they are looking at.
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    const onScreen = read.view.linesFingerprint;
    expect(read.view.lines.find((l) => l.id === "line-flat")?.unit_amount_cents).toBe(150_000);

    // The firm re-prices that same line while they read it.
    const flat = db.tables.crm_quote_line.find((l) => l.id === "line-flat");
    if (!flat) throw new Error("fixture missing");
    flat.unit_amount_cents = 475_000;

    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );

    expect(result).toEqual({ ok: false, reason: "quote_changed" });

    // Nothing was signed, and in particular nothing was signed at the new
    // price: no acceptance, no frozen record, no `accepted` event.
    const row = db.tables.crm_quote[0];
    expect(row.status).toBe("sent");
    expect(row.accepted_at).toBeNull();
    expect(row.accepted_snapshot).toBeNull();
    expect(row.accepted_by_name).toBeNull();
    expect(db.tables.crm_quote_event.filter((e) => e.type === "accepted")).toHaveLength(0);
  });

  it("reads the lines ONCE — the snapshot is built from the rows the fingerprint was checked against", async () => {
    // The ported engine re-read the lines inside the accept path (to persist
    // the selection), which opened a window between the fingerprint check and
    // the snapshot. With no selection write there is one read, so the frozen
    // figures are by construction the checked figures.
    const db = makeDb();
    const onScreen = await renderedFingerprint(db);
    let lineReads = 0;
    db.beforeQuery = async (table, op) => {
      if (table === "crm_quote_line" && op === "select") lineReads += 1;
    };
    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );
    db.beforeQuery = null;
    expect(result.ok).toBe(true);
    expect(lineReads).toBe(1);
  });

  it("REFUSES when the firm switches a package on or off while the client reads", async () => {
    // Switching the offer changes which lines the client may take without
    // touching an amount. The fingerprint is over the OFFERED lines, so it moves.
    for (const change of ["withhold", "offer"] as const) {
      const db = makeDb();
      const onScreen = await renderedFingerprint(db);
      for (const row of db.tables.crm_quote_line) {
        if (change === "withhold" && row.tier_group === "Standard") row.selected = false;
        if (change === "offer" && row.tier_group === "Budget") row.selected = true;
      }
      const result = await acceptPublicQuote(
        { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
        NOW,
        db,
      );
      expect(result, change).toEqual({ ok: false, reason: "quote_changed" });
      expect(db.tables.crm_quote[0].status, change).toBe("sent");
    }
  });

  it("accepts when the proposal has not moved", async () => {
    // The other half of the guard: it must refuse a changed quote WITHOUT
    // refusing an unchanged one, or the whole surface stops working and the
    // fix is worse than the defect.
    const db = makeDb();
    const result = await signAsClient(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.totals.due_at_signing).toBe(150_000 + 165_000);
    expect(db.tables.crm_quote[0].status).toBe("accepted");
  });

  it("is not a lock: the same client signs once they have read the new figures", async () => {
    // A refusal means "read this again", not "you can never sign this". After
    // a reload the page carries the current fingerprint, the signature goes
    // through, and the snapshot freezes the figures the client actually read
    // the second time.
    const db = makeDb();
    const stale = await renderedFingerprint(db);
    const flat = db.tables.crm_quote_line.find((l) => l.id === "line-flat");
    if (flat) flat.unit_amount_cents = 475_000;

    const refused = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: stale, ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(refused).toEqual({ ok: false, reason: "quote_changed" });

    const result = await signAsClient(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.totals.due_at_signing).toBe(475_000 + 165_000);
  });

  it("REFUSES when a line was re-scheduled without its amount changing", async () => {
    // §0's axis, not just the amounts: moving the flat fee from signing to
    // filing changes "Due today" by $1,500 without touching a single number on
    // the line. A fingerprint over amounts alone would let that through.
    const db = makeDb();
    const onScreen = await renderedFingerprint(db);
    const flat = db.tables.crm_quote_line.find((l) => l.id === "line-flat");
    if (flat) flat.charge_at = "filing";

    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "quote_changed" });
    expect(db.tables.crm_quote[0].status).toBe("sent");
  });

  it("still reports unknown_line — not quote_changed — when the chosen package was REMOVED", async () => {
    // A package that vanished is the more specific fact and the choice check
    // still gets to say so first; the fingerprint only speaks about
    // interference the pick could not reveal.
    const db = makeDb();
    const onScreen = await renderedFingerprint(db);
    db.tables.crm_quote_line = db.tables.crm_quote_line.filter((l) => l.tier_group !== "Comprehensive");

    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "unknown_line" });
    expect(db.tables.crm_quote[0].status).toBe("sent");
  });

  it("refuses when a chargeable line was ADDED that the client never saw", async () => {
    // This one CHANGES what used to happen: an added line kept every submitted
    // id valid, so the acceptance went through and the client signed for an
    // item that was not on their page — with its money in "Due today". It is
    // the same defect as a re-price wearing different clothes, and it gets the
    // same refusal.
    const db = makeDb();
    const onScreen = await renderedFingerprint(db);
    db.tables.crm_quote_line.push(
      line({
        id: "line-surprise",
        kind: "legal_fee",
        charge_at: "signing",
        selection: "included",
        selected: true,
        label: "Rush handling",
        unit_amount_cents: 90_000,
        sort_index: 60,
      }),
    );

    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "quote_changed" });
    expect(db.tables.crm_quote[0].accepted_snapshot).toBeNull();
  });

  it("does not refuse over a typo fix or a reorder", async () => {
    // Nothing about what is owed changed, and a guard that cried wolf over
    // wording would train firms to expect spurious refusals — which is how a
    // real one starts getting clicked through.
    const db = makeDb();
    const onScreen = await renderedFingerprint(db);
    const flat = db.tables.crm_quote_line.find((l) => l.id === "line-flat");
    if (flat) {
      flat.label = "Trademark filing — flat fee (all classes)";
      flat.description = "Now with a description.";
      flat.sort_index = 15;
    }

    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a caller that sends no fingerprint at all", async () => {
    // A `"use server"` action is a bare POST endpoint. Treating a missing
    // fingerprint as "nothing to check" would leave the whole guard optional
    // for exactly the caller who wants it optional.
    const db = makeDb();
    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: "", ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "quote_changed" });
    expect(db.tables.crm_quote[0].status).toBe("sent");
  });
});

describe("quoteLinesFingerprint", () => {
  function priced(overrides: Partial<PublicQuoteLine> = {}): PublicQuoteLine {
    return {
      id: "line-a",
      kind: "legal_fee",
      charge_at: "signing",
      selection: "included",
      tier_group: null,
      selected: true,
      label: "Flat fee",
      description: null,
      quantity: 1,
      unit_amount_cents: 150_000,
      sort_index: 10,
      ...overrides,
    };
  }

  it("reads the same whether an int8 arrived as a number or as a quoted numeral", async () => {
    // PostgREST hands a bigint back either way depending on configuration. A
    // fingerprint that told them apart would refuse every acceptance in the
    // deployment where two reads happened to disagree about the wire format.
    expect(quoteLinesFingerprint([priced({ unit_amount_cents: "150000", quantity: "1" })])).toBe(
      quoteLinesFingerprint([priced({ unit_amount_cents: 150_000, quantity: 1 })]),
    );
  });

  it("does not move when the client ticks a box", () => {
    // The choice travels separately and is validated on its own terms. A
    // fingerprint that included `selected` would refuse every acceptance that
    // involved choosing anything.
    expect(quoteLinesFingerprint([priced({ selected: true })])).toBe(
      quoteLinesFingerprint([priced({ selected: false })]),
    );
  });

  it("does not move when the lines come back in a different order", () => {
    const a = priced({ id: "line-a" });
    const b = priced({ id: "line-b", unit_amount_cents: 35_000 });
    expect(quoteLinesFingerprint([a, b])).toBe(quoteLinesFingerprint([b, a]));
  });

  it("moves on every field that decides what is owed and when", () => {
    const base = quoteLinesFingerprint([priced()]);
    expect(quoteLinesFingerprint([priced({ unit_amount_cents: 475_000 })])).not.toBe(base);
    expect(quoteLinesFingerprint([priced({ quantity: 2 })])).not.toBe(base);
    expect(quoteLinesFingerprint([priced({ charge_at: "filing" })])).not.toBe(base);
    expect(quoteLinesFingerprint([priced({ kind: "government_fee" })])).not.toBe(base);
    expect(quoteLinesFingerprint([priced({ selection: "optional" })])).not.toBe(base);
    expect(quoteLinesFingerprint([priced({ tier_group: "package" })])).not.toBe(base);
    expect(quoteLinesFingerprint([priced({ id: "line-z" })])).not.toBe(base);
    expect(quoteLinesFingerprint([priced(), priced({ id: "line-b" })])).not.toBe(base);
  });

  it("carries nothing a client could not already read off the page", async () => {
    // It rides in the RSC payload, so it is held to the same rule as every
    // other field there.
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    // Two 128-bit halves since the engagement terms joined the digest — the
    // lines and the terms, kept separable so a refusal can name which one
    // moved. Still opaque hex, still derived only from fields already in the
    // payload.
    expect(read.view.linesFingerprint).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{32}$/);
    expect(read.view.linesFingerprint).not.toContain(ORG_ID);
  });
});

describe("an accepted quote — §5", () => {
  it("hands the receipt the frozen snapshot, and reads terminal", async () => {
    const db = makeDb();
    await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );

    // Now a staff member "fixes a typo" and re-prices a line. The client's
    // signed agreement must not move.
    const flat = db.tables.crm_quote_line.find((l) => l.id === "line-flat");
    if (flat) flat.unit_amount_cents = 999_900;

    const read = await readPublicQuote(TOKEN, new Date(NOW.getTime() + 60_000), db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.status).toBe("accepted");
    expect(read.view.acceptedSnapshot?.totals.due_at_signing).toBe(150_000 + 165_000);
    expect(read.view.acceptedByName).toBe("Dana Reyes");
  });

  it("does not hand the signer's email back to whoever holds the link", async () => {
    // The column allowlist refuses `accepted_by_email` on purpose; the same
    // address sits inside the snapshot's signature block, and leaving it there
    // would route around the allowlist through a jsonb column.
    const db = makeDb();
    await signAsClient(
      { token: TOKEN, name: "Dana Reyes", email: "dana@example.test", choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(JSON.stringify(read.view)).not.toContain("dana@example.test");
    // …while the STORED record still has it, because that is the firm's e-sign
    // evidence and the redaction is a projection, not an edit.
    const stored = db.tables.crm_quote[0].accepted_snapshot as { signature: { email: string } };
    expect(stored.signature.email).toBe("dana@example.test");
  });

  it("returns null for a snapshot it cannot parse, rather than a partial one", async () => {
    // A receipt built from a half-understood record is a legal document
    // rendered on a guess; the component falls back to confirming the
    // acceptance without figures.
    const db = makeDb({
      status: "accepted",
      accepted_at: "2026-09-09T10:00:00.000Z",
      accepted_by_name: "Dana Reyes",
      accepted_snapshot: { totals: "who knows" },
    });
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.acceptedSnapshot).toBeNull();
  });
});

describe("the viewed event — the only free write an anon caller gets", () => {
  it("writes one row, with no caller-supplied text in it", async () => {
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");

    await recordQuoteViewed(read.handle, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)", NOW, db);
    expect(db.tables.crm_quote_event).toHaveLength(1);
    expect(db.tables.crm_quote_event[0]).toMatchObject({
      org_id: ORG_ID,
      quote_id: QUOTE_ID,
      type: "viewed",
      actor: "client",
      // A fixed vocabulary, not the raw header — nothing an anonymous caller
      // typed is stored in a jsonb column a staff surface renders.
      payload: { ua: "mobile" },
    });
  });

  it("does not write a second row on a reload inside the dedupe window", async () => {
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");

    db.clock = NOW.toISOString();
    await recordQuoteViewed(read.handle, "curl/8", NOW, db);

    const thirtySecondsLater = new Date(NOW.getTime() + 30_000);
    db.clock = thirtySecondsLater.toISOString();
    await recordQuoteViewed(read.handle, "curl/8", thirtySecondsLater, db);
    // This route causes a write with no login and no rate limiter in front of
    // it. Twelve rows an hour is engagement tracking; nine hundred is a
    // refresh loop.
    expect(db.tables.crm_quote_event).toHaveLength(1);

    const sixMinutesLater = new Date(NOW.getTime() + 6 * 60_000);
    db.clock = sixMinutesLater.toISOString();
    await recordQuoteViewed(read.handle, "curl/8", sixMinutesLater, db);
    expect(db.tables.crm_quote_event).toHaveLength(2);
  });

  it("never throws, whatever the database does", async () => {
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    db.failTable = "crm_quote_event";
    // A broken audit table must not take down the page a client came to read.
    await expect(recordQuoteViewed(read.handle, "curl/8", NOW, db)).resolves.toBeUndefined();
  });

  it("maps every user agent to a fixed vocabulary", () => {
    expect(coarseUserAgent("Mozilla/5.0 (Windows NT) Chrome/120")).toBe("chrome");
    expect(coarseUserAgent("Mozilla/5.0 (iPhone) Safari/605")).toBe("mobile");
    expect(coarseUserAgent("Googlebot/2.1")).toBe("bot");
    expect(coarseUserAgent("<script>alert(1)</script>")).toBe("other");
    expect(coarseUserAgent(null)).toBe("unknown");
  });
});

describe("parseInet", () => {
  it("takes the leftmost hop of an x-forwarded-for chain", () => {
    expect(parseInet("203.0.113.9, 70.41.3.18")).toBe("203.0.113.9");
  });

  it("refuses anything that is not an address literal", () => {
    expect(parseInet("999.1.1.1")).toBeNull();
    expect(parseInet("localhost")).toBeNull();
    expect(parseInet("'; drop table crm_quote; --")).toBeNull();
    expect(parseInet(null)).toBeNull();
  });

  it("accepts IPv6", () => {
    expect(parseInet("2001:db8::1")).toBe("2001:db8::1");
  });
});

describe("buildAcceptedSnapshot", () => {
  it("normalises wire-loose amounts into definite integers", () => {
    // int8 can arrive as a quoted numeral. A frozen legal record with a string
    // in it is a record somebody has to parse later, possibly differently.
    const snapshot = buildAcceptedSnapshot({
      view: { title: "T", introBody: null, termsBody: null, expiresAt: null, currency: "USD" },
      lines: [
        {
          id: "l1",
          kind: "legal_fee",
          charge_at: "signing",
          selection: "included",
          tier_group: null,
          selected: true,
          label: "Flat fee",
          description: null,
          quantity: "2",
          unit_amount_cents: "150000",
          sort_index: 0,
        },
      ],
      acceptedAt: NOW.toISOString(),
      name: "Dana Reyes",
      email: "dana@example.test",
    });
    expect(snapshot.lines[0].quantity).toBe(2);
    expect(snapshot.lines[0].unit_amount_cents).toBe(150_000);
    expect(snapshot.lines[0].amount_cents).toBe(300_000);
    expect(snapshot.totals.due_at_signing).toBe(300_000);
    expect(snapshot.snapshot_version).toBe(1);
  });

  it("puts a government fee at filing even when its charge_at says otherwise", () => {
    // The database forbids that row (crm_quote_line_gov_fee_not_at_signing) and
    // pricing.ts buckets it to filing regardless. Asserted here because the
    // snapshot is the record a client is charged from.
    const snapshot = buildAcceptedSnapshot({
      view: { title: "T", introBody: null, termsBody: null, expiresAt: null, currency: "USD" },
      lines: [
        {
          id: "l1",
          kind: "government_fee",
          charge_at: "signing",
          selection: "included",
          tier_group: null,
          selected: true,
          label: "USPTO fee",
          description: null,
          quantity: 1,
          unit_amount_cents: 35_000,
          sort_index: 0,
        },
      ],
      acceptedAt: NOW.toISOString(),
      name: "Dana Reyes",
      email: "dana@example.test",
    });
    expect(snapshot.totals.due_at_signing).toBe(0);
    expect(snapshot.totals.due_at_filing).toBe(35_000);
  });
});

describe("no refusal writes anything; the winning signature writes the choice back", () => {
  const signer = { name: "Dana Reyes", email: "dana@example.test" };

  /**
   * The ported engine had to defend a stored selection against a bare POST:
   * `accept({ selectedLineIds: [] })` once cleared a client's package while
   * reporting an error. There is no stored selection to strip any more — the
   * pick travels only with the signature — and these pin the stronger property
   * that replaced it: every refusal leaves every row exactly as it was.
   */
  it("refuses a bare POST with no package, and touches no row", async () => {
    const db = makeDb();
    const linesFingerprint = await renderedFingerprint(db);
    const before = JSON.stringify(db.tables);
    const refused = await acceptPublicQuote({ token: TOKEN, ...signer, linesFingerprint, ip: null, userAgent: null }, NOW, db);
    expect(refused).toEqual({ ok: false, reason: "not_ready", message: "Choose a package." });
    expect(db.writes).toEqual([]);
    expect(JSON.stringify(db.tables)).toBe(before);
  });

  it("touches no row for any refusal the submission alone decides", async () => {
    const cases: Array<[string, Partial<AcceptInput>]> = [
      ["bad name", { name: " " }],
      ["bad email", { email: "dana@nope" }],
      ["unknown package", { choice: pick("Budget") }],
      ["unknown add-on", { choice: pick("Standard", ["line-drawing"]) }],
      ["stale fingerprint", { linesFingerprint: "0".repeat(32) + "." + "0".repeat(32) }],
    ];
    for (const [label, override] of cases) {
      const db = makeDb();
      const linesFingerprint = await renderedFingerprint(db);
      const result = await acceptPublicQuote(
        { token: TOKEN, ...signer, choice: pick("Standard"), linesFingerprint, ip: null, userAgent: null, ...override },
        NOW,
        db,
      );
      expect(result.ok, label).toBe(false);
      expect(db.writes, label).toEqual([]);
    }
  });

  it("writes the client's choice back, so the rows then read as what they took", async () => {
    const db = makeDb();
    const result = await signAsClient({ token: TOKEN, ...signer, choice: pick("Comprehensive", ["line-monitor"]), ip: null, userAgent: null }, NOW, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const selected = db.tables.crm_quote_line.filter((l) => l.selected).map((l) => l.id).sort();
    expect(selected).toEqual(["line-flat", "line-monitor", "line-prem", "line-prem-uspto", "line-uspto"]);
    // …and the live rows now total exactly what was frozen.
    const live = quoteTotals(db.tables.crm_quote_line as never);
    expect(live.dueAtSigning).toBe(result.snapshot.totals.due_at_signing);
    expect(live.dueAtFiling).toBe(result.snapshot.totals.due_at_filing);
    // The write-back is one statement, fenced on this quote and its org.
    const lineWrites = db.writes.filter((w) => w.table === "crm_quote_line");
    expect(lineWrites).toHaveLength(1);
    expect(lineWrites[0].filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "quote_id", value: QUOTE_ID },
        { kind: "eq", column: "org_id", value: ORG_ID },
      ]),
    );
  });

  it("does not undo a signature when writing the choice back fails", async () => {
    const db = makeDb();
    const linesFingerprint = await renderedFingerprint(db);
    db.beforeQuery = async (table, op) => {
      if (table === "crm_quote_line" && op === "update") db.failTable = "crm_quote_line";
    };
    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Standard"), linesFingerprint, ip: null, userAgent: null },
      NOW,
      db,
    );
    db.beforeQuery = null;
    db.failTable = null;
    expect(result.ok).toBe(true);
    expect(db.tables.crm_quote[0].status).toBe("accepted");
    expect(db.tables.crm_quote_event.filter((e) => e.type === "accepted")).toHaveLength(1);
  });
});

describe("a signature over TERMS that moved is refused, never applied", () => {
  const signer = { name: "Dana Reyes", email: "dana@example.test" };

  it("REFUSES when the engagement terms were rewritten after the client read the page", async () => {
    const db = makeDb();

    // The client's page: this read is the document they are looking at.
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    const onScreen = read.view.linesFingerprint;
    expect(read.view.termsBody).toBe("Flat fees, billed as set out above.");

    // The firm rewrites the fee agreement while it is open on their screen.
    // Note what does NOT change: no line is added, deleted or re-priced, so
    // the client's pick is perfectly valid and every amount
    // still matches. Before the terms joined the digest this returned `ok`.
    db.tables.crm_quote[0].terms_body =
      "Flat fees, billed as set out above. A 40% cancellation fee applies on withdrawal.";

    const result = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), linesFingerprint: onScreen, ip: null, userAgent: null },
      NOW,
      db,
    );

    expect(result).toEqual({ ok: false, reason: "terms_changed" });

    // Nothing was signed, and in particular nothing was signed over the new
    // wording: no acceptance, no frozen record, no `accepted` event.
    const row = db.tables.crm_quote[0];
    expect(row.status).toBe("sent");
    expect(row.accepted_at).toBeNull();
    expect(row.accepted_snapshot).toBeNull();
    expect(row.accepted_by_name).toBeNull();
    expect(db.tables.crm_quote_event.filter((e) => e.type === "accepted")).toHaveLength(0);
  });

  it("refuses a terms change that adds terms where the client saw none", async () => {
    // The empty-to-populated direction. A quote sent with no engagement letter
    // reads as a bare proposal; terms appearing under a client mid-signature is
    // the same tamper, and null must not be treated as "nothing to compare".
    const db = makeDb({ terms_body: null });
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");
    expect(read.view.termsBody).toBeNull();

    db.tables.crm_quote[0].terms_body = "You agree to arbitrate all disputes in Delaware.";

    const result = await acceptPublicQuote(
      {
        token: TOKEN,
        ...signer,
        choice: pick("Comprehensive"),
        linesFingerprint: read.view.linesFingerprint,
        ip: null,
        userAgent: null,
      },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "terms_changed" });
    expect(db.tables.crm_quote[0].accepted_at).toBeNull();
  });

  it("refuses a one-character edit — there is no cosmetic change to a fee clause", async () => {
    // Deliberately UNLIKE the lines digest, which ignores `label` and
    // `description` so a typo fix doesn't produce a spurious refusal. In terms
    // the text IS the agreement: a comma moved inside a fee sentence is a
    // different sentence, and the client has to be the one who reads it.
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");

    db.tables.crm_quote[0].terms_body = "Flat fees, billed as set out above ";

    const result = await acceptPublicQuote(
      {
        token: TOKEN,
        ...signer,
        choice: pick("Comprehensive"),
        linesFingerprint: read.view.linesFingerprint,
        ip: null,
        userAgent: null,
      },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "terms_changed" });
  });

  it("still reports quote_changed — not terms_changed — when it was the money that moved", async () => {
    // The two halves must not blur into one message: a client told the terms
    // changed will re-read the terms, and if it was the price that moved they
    // will sign the new figure having checked the wrong part of the page.
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");

    const flat = db.tables.crm_quote_line.find((l) => l.id === "line-flat");
    if (!flat) throw new Error("fixture missing");
    flat.unit_amount_cents = 475_000;

    const result = await acceptPublicQuote(
      {
        token: TOKEN,
        ...signer,
        choice: pick("Comprehensive"),
        linesFingerprint: read.view.linesFingerprint,
        ip: null,
        userAgent: null,
      },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "quote_changed" });
  });

  it("reports the money when BOTH halves moved, because that is the half to re-read first", async () => {
    const db = makeDb();
    const read = await readPublicQuote(TOKEN, NOW, db);
    if (read.status !== "ok") throw new Error("expected ok");

    const flat = db.tables.crm_quote_line.find((l) => l.id === "line-flat");
    if (!flat) throw new Error("fixture missing");
    flat.unit_amount_cents = 475_000;
    db.tables.crm_quote[0].terms_body = "Different terms entirely.";

    const result = await acceptPublicQuote(
      {
        token: TOKEN,
        ...signer,
        choice: pick("Comprehensive"),
        linesFingerprint: read.view.linesFingerprint,
        ip: null,
        userAgent: null,
      },
      NOW,
      db,
    );
    expect(result).toEqual({ ok: false, reason: "quote_changed" });
  });

  it("signs, and freezes the terms as read, when nothing moved", async () => {
    // The other side of the guard: it must not refuse an ordinary signature.
    // And the snapshot has to hold the WORDING, not just the amounts — the
    // frozen record is what proves later which agreement was signed.
    const db = makeDb();
    const result = await signAsClient(
      { token: TOKEN, ...signer, choice: pick("Comprehensive"), ip: null, userAgent: null },
      NOW,
      db,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.snapshot.quote.terms_body).toBe("Flat fees, billed as set out above.");

    // And a later staff rewrite cannot reach into what was signed.
    db.tables.crm_quote[0].terms_body = "Rewritten after the fact.";
    const after = await readPublicQuote(TOKEN, new Date(NOW.getTime() + 60_000), db);
    if (after.status !== "ok") throw new Error("expected ok");
    expect(after.view.acceptedSnapshot?.quote.terms_body).toBe("Flat fees, billed as set out above.");
  });
});

describe("quoteAgreementFingerprint", () => {
  const lines: PublicQuoteLine[] = [
    {
      id: "a",
      kind: "legal_fee",
      charge_at: "signing",
      selection: "included",
      tier_group: null,
      selected: true,
      label: "Flat fee",
      description: null,
      quantity: 1,
      unit_amount_cents: 150_000,
      sort_index: 0,
    },
  ];

  it("moves when the terms move, with the lines untouched", () => {
    expect(quoteAgreementFingerprint({ lines, termsBody: "A" })).not.toBe(
      quoteAgreementFingerprint({ lines, termsBody: "B" }),
    );
  });

  it("treats null and empty terms as the same document — both render as no terms", () => {
    expect(quoteAgreementFingerprint({ lines, termsBody: null })).toBe(
      quoteAgreementFingerprint({ lines, termsBody: "" }),
    );
  });

  it("does not normalise whitespace or case", () => {
    const base = quoteAgreementFingerprint({ lines, termsBody: "Flat fees." });
    expect(quoteAgreementFingerprint({ lines, termsBody: "flat fees." })).not.toBe(base);
    expect(quoteAgreementFingerprint({ lines, termsBody: " Flat fees." })).not.toBe(base);
    expect(quoteAgreementFingerprint({ lines, termsBody: "Flat  fees." })).not.toBe(base);
  });

  it("keeps the lines digest as its first half, so the two are separable", () => {
    const value = quoteAgreementFingerprint({ lines, termsBody: "A" });
    expect(value.split(".")).toHaveLength(2);
    expect(value.split(".")[0]).toBe(quoteLinesFingerprint(lines));
  });
});

/* ─────────────────────────── declining (new) ────────────────────────────── */

describe("declining — the client's own terminal state", () => {
  const signer = { name: "Dana Reyes", email: "dana@example.test" };

  it("declines a live quote, fenced on the row's own id and org, and records one event", async () => {
    const db = makeDb();
    const result = await declinePublicQuote(TOKEN, NOW, db);
    expect(result).toEqual({ ok: true, declinedAt: NOW.toISOString() });

    const quote = db.tables.crm_quote[0];
    expect(quote.status).toBe("declined");
    expect(quote.declined_at).toBe(NOW.toISOString());
    expect(quote.accepted_at).toBeNull();

    const events = db.tables.crm_quote_event.filter((e) => e.type === "declined");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ org_id: ORG_ID, quote_id: QUOTE_ID, actor: "client" });
  });

  it("reads as declined afterwards — no body, no accept control reachable", async () => {
    const db = makeDb();
    await declinePublicQuote(TOKEN, NOW, db);
    const read = await readPublicQuote(TOKEN, NOW, db);
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.view.status).toBe("declined");
  });

  it("cannot decline a signed quote, and says so without touching it", async () => {
    const db = makeDb();
    const accepted = await signAsClient({ token: TOKEN, ...signer, choice: pick("Standard"), ip: null, userAgent: null }, NOW, db);
    expect(accepted.ok).toBe(true);
    const before = JSON.stringify(db.tables.crm_quote[0]);

    expect(await declinePublicQuote(TOKEN, NOW, db)).toEqual({ ok: false, reason: "already_resolved" });
    expect(JSON.stringify(db.tables.crm_quote[0])).toBe(before);
    expect(db.tables.crm_quote_event.filter((e) => e.type === "declined")).toHaveLength(0);
  });

  it("cannot decline an expired, withdrawn or draft quote", async () => {
    expect(await declinePublicQuote(TOKEN, NOW, makeDb({ expires_at: "2026-09-08T23:59:00.000Z" }))).toEqual({ ok: false, reason: "not_live" });
    expect(await declinePublicQuote(TOKEN, NOW, makeDb({ status: "withdrawn" }))).toEqual({ ok: false, reason: "not_live" });
    expect(await declinePublicQuote(TOKEN, NOW, makeDb({ status: "draft", sent_at: null }))).toEqual({ ok: false, reason: "not_found" });
  });

  it("loses the race to a signature that commits first — the signature stands", async () => {
    const db = makeDb();
    const fingerprint = await renderedFingerprint(db);
    // Hold the decline's UPDATE until the acceptance has committed.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let held = false;
    db.beforeQuery = async (table, op) => {
      if (table === "crm_quote" && op === "update" && !held) {
        held = true;
        await gate;
      }
    };
    const declining = declinePublicQuote(TOKEN, NOW, db);
    await new Promise((r) => setTimeout(r, 0));
    expect(held).toBe(true);
    db.beforeQuery = null;
    const accepted = await acceptPublicQuote(
      { token: TOKEN, ...signer, choice: pick("Standard"), linesFingerprint: fingerprint, ip: null, userAgent: null },
      NOW,
      db,
    );
    release();
    expect(accepted.ok).toBe(true);
    expect(await declining).toEqual({ ok: false, reason: "not_live" });
    expect(db.tables.crm_quote[0].status).toBe("accepted");
  });

  it("refuses a malformed token without a database round trip", async () => {
    const db = makeDb();
    expect(await declinePublicQuote("nope", NOW, db)).toEqual({ ok: false, reason: "not_found" });
    expect(db.queryCount.value).toBe(0);
  });
});

/* ───────────────────── the matter opens on acceptance ────────────────────── */

describe("acceptance opens the matter — and nothing about that can undo it", () => {
  const LEAD_ID = "44444444-4444-4444-4444-444444444444";

  function withLead(): FakeDb {
    const db = makeDb({ lead_id: LEAD_ID, matter_id: null });
    db.tables.crm_lead = [{ id: LEAD_ID, org_id: ORG_ID, first_name: "Dana", last_name: "Reyes", business_name: "Reyes Roasting" }];
    db.tables.crm_matter_stage = [{ id: "stage-1", org_id: ORG_ID, order_index: 10, is_open: true }];
    db.tables.crm_matter = [];
    db.unique = { crm_matter: [["org_id", "matter_number"]] };
    return db;
  }

  it("opens one matter for the quote's lead and links it, only for the winning signature", async () => {
    const db = withLead();
    const result = await signAsClient({ token: TOKEN, name: "Dana Reyes", choice: pick("Standard"), ip: null, userAgent: null }, NOW, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matter).toMatchObject({ status: "opened", matterNumber: "TM-2026-0001" });
    expect(db.tables.crm_matter).toEqual([
      expect.objectContaining({ org_id: ORG_ID, lead_id: LEAD_ID, package_name: "Standard", status: "open", stage_id: "stage-1" }),
    ]);
    expect(db.tables.crm_quote[0].matter_id).toBe(db.tables.crm_matter[0].id);

    // A second signature attempt is refused before it could open another.
    const again = await signAsClient({ token: TOKEN, name: "Dana Reyes", choice: pick("Standard"), ip: null, userAgent: null }, NOW, db);
    expect(again).toEqual({ ok: false, reason: "already_resolved" });
    expect(db.tables.crm_matter).toHaveLength(1);
  });

  it("still accepts when the matter cannot be opened", async () => {
    const db = withLead();
    db.failInsertTable = "crm_matter";
    const result = await signAsClient({ token: TOKEN, name: "Dana Reyes", choice: pick("Standard"), ip: null, userAgent: null }, NOW, db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.matter).toEqual({ status: "failed" });
    expect(db.tables.crm_quote[0].status).toBe("accepted");
    expect(db.tables.crm_quote[0].matter_id).toBeNull();
  });

  it("leaves a quote that already names a matter alone", async () => {
    const db = makeDb();
    const result = await signAsClient({ token: TOKEN, name: "Dana Reyes", choice: pick("Standard"), ip: null, userAgent: null }, NOW, db);
    expect(result.ok && result.matter).toEqual({ status: "skipped", reason: "has_matter" });
    expect(db.tables.crm_matter ?? []).toEqual([]);
  });
});

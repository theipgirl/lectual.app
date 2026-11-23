import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readLatestRequest, requestStatusLine, REQUEST_STATUS_COLUMNS, type RequestStatusRead, type RequestStatusRow } from "@/lib/loe/email-signing/request-status";
import { type EvidenceDb, EVIDENCE_EVENT_COLUMNS, EVIDENCE_REQUEST_COLUMNS, readSigningEvidence } from "@/lib/loe/email-signing/evidence-read";
import { buildSignedCard, emailCopyView, lectualFileView } from "@/lib/loe/signed-card";
import { SigningLinkCard } from "@/components/proposal-editor/SigningLinkCard";
import { SIGNING_LINK_UNREADABLE } from "@/lib/ui/words";
import { STEP_TEXT } from "@/lib/proposals/step-text";
import { linkSnapshot, evidenceFor } from "./evidence-fixtures";
import { signedTrademark } from "../signed-fixtures";

const TZ = "America/New_York";
const NOW = new Date("2026-11-20T12:00:00.000Z");
const row = (over: Partial<RequestStatusRow>): RequestStatusRead => ({
  status: "ok",
  request: { id: "r1", status: "open", closed_reason: null, sent_at: "2026-11-12T19:14:00.000Z", expires_at: "2026-11-19T19:14:00.000Z", opened_at: null, consent_at: null, signed_at: null, created_at: "2026-11-12T19:14:00.000Z", ...over },
});

describe("the staff card's signing link line", () => {
  it("one line per state, from the newest request", () => {
    const live = { expires_at: "2026-11-30T19:14:00.000Z" };
    expect(requestStatusLine(row(live), TZ, NOW)).toBe("Link sent November 12, 2026 at 2:14 PM EST");
    expect(requestStatusLine(row({ ...live, opened_at: "2026-11-13T15:00:00.000Z" }), TZ, NOW)).toBe("Opened November 13, 2026 at 10:00 AM EST");
    expect(requestStatusLine(row({ ...live, opened_at: "2026-11-13T15:00:00.000Z", consent_at: "2026-11-13T15:01:00.000Z" }), TZ, NOW)).toBe("Consent given November 13, 2026 at 10:01 AM EST");
    expect(requestStatusLine(row({ status: "signed", signed_at: "2026-11-14T15:00:00.000Z" }), TZ, NOW)).toBe("Signed November 14, 2026 at 10:00 AM EST");
    expect(requestStatusLine(row({ status: "closed", closed_reason: "expired" }), TZ, NOW)).toBe("Link expired November 19, 2026");
    // An open request past its expiry reads as expired too.
    expect(requestStatusLine(row({}), TZ, NOW)).toBe("Link expired November 19, 2026");
    expect(requestStatusLine(row({ status: "closed", closed_reason: "resent" }), TZ, NOW)).toBe("Link closed (a newer link was sent)");
    expect(requestStatusLine(row({ status: "closed", closed_reason: "withdrawn" }), TZ, NOW)).toContain("withdrawn");
    expect(requestStatusLine(row({ status: "closed", closed_reason: "something-new" }), TZ, NOW)).toBe("Link closed");
  });

  it("no request draws no line; 0117 missing draws no line; a failed read says so and is never 'not sent'", () => {
    expect(requestStatusLine({ status: "ok", request: null }, TZ, NOW)).toBeNull();
    expect(requestStatusLine({ status: "not_set_up" }, TZ, NOW)).toBeNull();
    expect(requestStatusLine(null, TZ, NOW)).toBeNull();
    expect(requestStatusLine({ status: "unavailable" }, TZ, NOW)).toBe(SIGNING_LINK_UNREADABLE);
  });

  it("reads granted columns only, and judges errors by code", async () => {
    expect(REQUEST_STATUS_COLUMNS).toBe("id, status, closed_reason, sent_at, expires_at, opened_at, consent_at, signed_at, created_at");
    const db = (error: { code?: string } | null, data: unknown = []) => ({ from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data, error }) }) }) }) }) });
    expect(await readLatestRequest(db({ code: "42P01" }), "p")).toEqual({ status: "not_set_up" });
    expect(await readLatestRequest(db({ code: "PGRST205" }), "p")).toEqual({ status: "not_set_up" });
    expect(await readLatestRequest(db({ code: "XX000" }), "p")).toEqual({ status: "unavailable" });
    expect(await readLatestRequest(db(null, []), "p")).toEqual({ status: "ok", request: null });
    expect(await readLatestRequest(db(null, "x"), "p")).toEqual({ status: "unavailable" });
  });

  it("renders the line as text and nothing else", () => {
    const html = renderToStaticMarkup(<SigningLinkCard line={'Link sent <b>x</b>'} />);
    expect(html).toContain("Link sent &lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<button");
  });
});

describe("the card's two new step views", () => {
  const events = (outcome: string, step: string) => [{ proposal_id: "p1", created_at: "2026-11-12T20:00:00.000Z", payload: { step, outcome } }];
  it("not yet / done / failed with Try again / skipped / blocked / unreadable", () => {
    expect(emailCopyView([], "p1", true)).toMatchObject({ state: "not_yet", retry: false });
    expect(emailCopyView(events("sent", "signed_copy_email"), "p1", true)).toMatchObject({ state: "done", retry: false });
    expect(emailCopyView(events("failed", "signed_copy_email"), "p1", true)).toMatchObject({ state: "failed", retry: true });
    expect(emailCopyView(events("failed", "signed_copy_email"), "p1", false)).toMatchObject({ retry: false });
    expect(emailCopyView(events("skipped", "signed_copy_email"), "p1", true)).toMatchObject({ state: "skipped", retry: true });
    expect(lectualFileView(events("filed", "signed_loe_file"), "p1", true)).toMatchObject({ state: "done" });
    expect(lectualFileView(events("blocked", "signed_loe_file"), "p1", true)).toMatchObject({ state: "blocked", retry: true });
    expect(lectualFileView(null, "p1", true)).toMatchObject({ state: "unreadable", retry: false });
  });

  it("buildSignedCard shows them only for a link signature", () => {
    const signature = { status: "ok" as const, signature: { signerName: "A", signedAt: "2026-11-12T19:14:00.000Z", fingerprint: "f".repeat(64), entityName: null, signerTitle: null } } as never;
    const input = { proposalId: "p1", status: "accepted", signature, events: [], tz: TZ, canRetry: true, canDownload: true };
    const link = buildSignedCard({ ...input, snapshot: linkSnapshot() });
    const inApp = buildSignedCard({ ...input, snapshot: signedTrademark() });
    expect(link && link.kind === "signed" && link.file && link.copy).toBeTruthy();
    expect(inApp && inApp.kind === "signed" ? [inApp.file, inApp.copy] : "x").toEqual([null, null]);
  });
});

describe("one evidence reader, granted columns only", () => {
  it("selects exactly the granted request columns and never an ungranted one, on either path", async () => {
    for (const bad of ["token_sha256", "agreement_text", "agreement_sha256", "consent_sha256", "sent_to", "snapshot", "details", "address", "selection"]) expect(EVIDENCE_REQUEST_COLUMNS.split(", ")).not.toContain(bad);
    expect(EVIDENCE_REQUEST_COLUMNS).toBe("id, org_id, proposal_id, status, sent_at, opened_at, consent_at, signed_at, signature_id, words_version, copy_subject, copy_body");
    expect(EVIDENCE_EVENT_COLUMNS.split(", ")).toEqual(["kind", "at", "ip", "user_agent", "sent_to", "consent_sha256", "signature_kind", "signature_png", "typed_style", "signature_sha256", "typed_name", "agreement_sha256"]);
    const files = walk("src").filter((f) => /\.(ts|tsx)$/.test(f));
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      if (!/client_proposal_signing_request/.test(text) || /request-status|evidence-read|\/db\/types|loe\/email-signing\/(verify|link-|sign|ready|gate|close|public|open|failure|settings)/.test(f)) continue;
      // Any other reader of the request table in the Sprint B files must not name the ungranted columns.
      if (/signed-(copy|loe)|signed-pdf|paid-flow|accept-followups|staff-download/.test(f)) expect(text, f).not.toMatch(/token_sha256|agreement_text/);
    }
  });

  it("is three-state by error code and fenced on org, proposal and request", async () => {
    const seen: Array<[string, unknown]> = [];
    const mk = (errors: Record<string, { code: string } | null>, data: Record<string, unknown>): EvidenceDb => ({
      from: (table: string) => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: (c: string, v: unknown) => (seen.push([c, v]), q),
          order: () => q,
          limit: () => q,
          then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: data[table], error: errors[table] ?? null }).then(resolve),
        };
        return q as never;
      },
    });
    const key = { proposalId: "p1", orgId: "o1", requestId: "r1" };
    const e = evidenceFor(linkSnapshot());
    expect(await readSigningEvidence(mk({ client_proposal_signing_request: { code: "42P01" } }, {}), key)).toBe("not_set_up");
    expect(await readSigningEvidence(mk({ client_proposal_signing_event: { code: "42883" } }, { client_proposal_signing_request: [e.request] }), key)).toBe("not_set_up");
    expect(await readSigningEvidence(mk({ client_proposal_signing_request: { code: "XX000" } }, {}), key)).toBe("unavailable");
    expect(await readSigningEvidence(mk({}, { client_proposal_signing_request: [] }), key)).toBe("unavailable");
    expect(await readSigningEvidence(mk({}, {}), { ...key, requestId: null })).toBe("unavailable");
    const ok = await readSigningEvidence(mk({}, { client_proposal_signing_request: [e.request], client_proposal_signing_event: e.events.map((x) => ({ ...x, signature_png: x.signature_png ? `\\x${Buffer.from(x.signature_png).toString("hex")}` : null })) }), key);
    expect(typeof ok).toBe("object");
    expect(seen).toEqual(expect.arrayContaining([["org_id", "o1"], ["proposal_id", "p1"], ["id", "r1"]]));
    expect(vi.isMockFunction(readSigningEvidence)).toBe(false);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("every buildVerifiedSignedPdf caller passes readEvidence (D-B7)", () => {
  it("fails on any call whose argument object lacks readEvidence", () => {
    const callers = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && /buildVerifiedSignedPdf\(\{/.test(readFileSync(f, "utf8")));
    expect(callers.sort()).toEqual(
      [
        "src/lib/loe/staff-download.ts",
        "src/lib/proposals/accept-followups.ts",
        "src/lib/proposals/paid-flow.ts",
        "src/lib/proposals/public-letter.ts",
      ].sort(),
    );
    for (const f of callers) {
      const text = readFileSync(f, "utf8");
      let at = 0;
      let calls = 0;
      while ((at = text.indexOf("buildVerifiedSignedPdf({", at)) !== -1) {
        // The object literal: up to the matching close of the call.
        let depth = 0;
        let end = at + "buildVerifiedSignedPdf(".length;
        for (; end < text.length; end += 1) {
          if (text[end] === "{") depth += 1;
          if (text[end] === "}") {
            depth -= 1;
            if (depth === 0) break;
          }
        }
        expect(text.slice(at, end + 1), `${f} call ${calls}`).toMatch(/readEvidence/);
        calls += 1;
        at = end;
      }
      expect(calls, f).toBeGreaterThan(0);
    }
  });

  it("the dashboard files import no admin client; the signed-copy and filing cores hold no environment or client of their own", () => {
    for (const f of ["src/lib/proposals/paid-flow.ts", "src/lib/loe/staff-download.ts", "src/lib/proposals/signed-loe-file.ts", "src/lib/proposals/signed-copy-email.ts", "src/lib/proposals/signed-file-target.ts", "src/components/proposal-editor/EngagementLetterCard.tsx", "src/components/proposal-editor/SigningLinkCard.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/db\/admin|getAdminClient/);
    }
    expect(readFileSync("src/lib/proposals/signed-loe-file.ts", "utf8")).not.toMatch(/process\.env/);
  });

  it("the step sentences exist once and carry no address", () => {
    for (const [k, v] of Object.entries(STEP_TEXT)) if (/^(copy|file)/.test(k) || k === "signedNoParent") expect(v, k).not.toMatch(/@|https?:/);
    expect(STEP_TEXT.signedNoParent).toBe("No lead or matter to file the signed letter under yet.");
  });
});

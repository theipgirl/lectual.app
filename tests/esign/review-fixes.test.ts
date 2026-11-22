import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorForResponse } from "@/lib/esign/adobe-errors";
import { ADOBE_START_PER_TOKEN, ADOBE_START_WINDOW_MS } from "@/lib/esign/start-limit";

describe("PASS-WITH-CHANGES suggestions", () => {
  it("only a 401 or a dead-token code pauses the firm; INVALID_USER / USER_NOT_AUTHORIZED are a per-request refusal", () => {
    expect(errorForResponse(401, null).reauth).toBe(true);
    for (const code of ["INVALID_ACCESS_TOKEN", "EXPIRED_ACCESS_TOKEN"]) expect(errorForResponse(403, code).reauth, code).toBe(true);
    for (const code of ["INVALID_USER", "USER_NOT_AUTHORIZED", "NO_AUTHORIZATION_HEADER", "PERMISSION_DENIED"]) {
      const e = errorForResponse(403, code);
      expect(e.reauth, code).toBe(false);
      expect(e.failure).toBe("adobe_refused");
    }
  });

  it("the Adobe start action has a per-token courtesy limit (10 an hour), checked before any read", () => {
    expect(ADOBE_START_PER_TOKEN).toBe(10);
    expect(ADOBE_START_WINDOW_MS).toBe(60 * 60 * 1000);
    const src = readFileSync("src/app/p/[token]/actions.ts", "utf8");
    const fn = src.slice(src.indexOf("export async function startAdobeSigningAction"));
    expect(fn.indexOf("adobeStartTokenLimiter.allowed")).toBeGreaterThan(-1);
    expect(fn.indexOf("adobeStartTokenLimiter.allowed")).toBeLessThan(fn.indexOf("startAdobeSigning({"));
  });

  it("the Integrations page reads the callback outcome with Object.hasOwn (no prototype keys)", () => {
    const src = readFileSync("src/app/dashboard/settings/integrations/page.tsx", "utf8");
    expect(src).toContain("Object.hasOwn(ADOBE_OUTCOME, esign_error)");
    expect(src).not.toMatch(/ADOBE_OUTCOME\[esign_error\] \?\?/);
  });

  it("0113: esign_open stores the proposal row's client_email; the connection trigger clears last_error when it becomes active", () => {
    const sql = readFileSync("docs/pge/2026-11-17-agentic-ip-os/0113-proposed.sql.txt", "utf8");
    const open = sql.slice(sql.indexOf("create or replace function public.client_proposal_esign_open("));
    expect(open.slice(0, open.indexOf("\n$$;"))).toContain("p_details, v_row.client_email, 'creating'");
    expect(sql).toMatch(/if new\.status = 'active' and \(tg_op = 'INSERT' or old\.status is distinct from 'active'\) then\s+new\.last_error := null;/);
    expect(sql).toContain("client_proposal_id_org_uniq");
    expect(sql).not.toContain("PART 7");
    expect(sql).toContain("add column if not exists provider_signed_at timestamptz null");
    const complete = sql.slice(sql.indexOf("create or replace function public.client_proposal_adobe_complete("));
    const body = complete.slice(0, complete.indexOf("\n$$;"));
    expect(body).toContain("security invoker");
    expect(body).toContain("v_req.template_version, 'adobe_sign', v_req.adobe_agreement_id, v_req.id, p_signed_at");
    expect(body).toContain("'provider_signed_at', p_signed_at");
    expect(body).not.toMatch(/'signed_at', p_signed_at/);
  });
});

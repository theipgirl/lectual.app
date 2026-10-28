import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUESTIONS, loadActions, person } from "./helpers/step-harness";
import { FORM_A, ORG_A } from "./helpers/step-db";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import { leadFromSubmission, validatePublicStart } from "@/lib/intake-forms/public-submit";
import { makeStamp } from "@/lib/intake-forms/spam";

/**
 * Sprint 36: the UTM labels on a link reach the submission's `contact.utm` and the lead's referral_detail,
 * cleaned by the server whatever the browser sent, and survive the person finishing.
 */

const SLUG = "ugw-2026";
const contact = { name: "Ana Rivera", email: "ana@example.com", phone: "", company: "Rivera Roasters" };
const STAGE = { id: "stage-1", org_id: ORG_A, name: "Potential New Client", category: "open", order_index: 1, aging_threshold_days: null, created_at: "2026-01-01T00:00:00Z" };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const stamp = () => makeStamp({ formKey: FORM_A, now: Date.now() - 20_000, host: "instagram.com", key: "test-salt" });
const startPayload = (over: Record<string, unknown> = {}) => ({ mode: "form", contact, consent: true, honeypot: "", stamp: stamp(), ...over });

describe("validatePublicStart carries a clean utm", () => {
  it("keeps the clean subset and drops forged values", () => {
    const r = validatePublicStart({ mode: "form", contact, consent: true, utm: { source: "ig", medium: "<b>x</b>", campaign: "UGW-2026", fbclid: "zz", content: "a".repeat(80) } });
    expect(r.ok && r.value.utm).toEqual({ source: "ig", campaign: "UGW-2026" });
  });
  it("is {} when none is posted", () => {
    const r = validatePublicStart({ mode: "form", contact, consent: true });
    expect(r.ok && r.value.utm).toEqual({});
  });
});

describe("startIntakeAction", () => {
  it("stores only the clean subset in contact.utm and builds referral_detail with it", async () => {
    const { db, actions } = await loadActions({ tables: { crm_stage: [STAGE] } });
    const res = await actions.startIntakeAction(SLUG, startPayload({ utm: { source: "ig", medium: "social", campaign: "UGW-2026", content: "link_in_bio", term: "no", fbclid: "x", extra: "<script>" } }));
    expect(res).toMatchObject({ ok: true });
    const [row] = db.writesTo("crm_intake_submission", "insert");
    expect((row.payload as { contact: unknown }).contact).toEqual({ ...contact, utm: { source: "ig", medium: "social", campaign: "UGW-2026", content: "link_in_bio" } });
    const [lead] = db.writesTo("crm_lead", "insert");
    expect((lead.payload as { referral_detail: string }).referral_detail).toBe("UGW 2026 · ig / social / link_in_bio / UGW-2026 · Form on instagram.com");
  });

  it("drops a dirty value whole, and stores no utm key when nothing usable is posted", async () => {
    const { db, actions } = await loadActions({ tables: { crm_stage: [STAGE] } });
    await actions.startIntakeAction(SLUG, startPayload({ utm: { source: "i g", campaign: "x".repeat(65) } }));
    const [row] = db.writesTo("crm_intake_submission", "insert");
    expect((row.payload as { contact: Record<string, unknown> }).contact).toEqual(contact);
    expect("utm" in (row.payload as { contact: Record<string, unknown> }).contact).toBe(false);
    const [lead] = db.writesTo("crm_lead", "insert");
    expect((lead.payload as { referral_detail: string }).referral_detail).toBe("UGW 2026 · Form on instagram.com");
  });

  it("keeps the honeypot behaviour: a bot is thanked and nothing is written", async () => {
    const { db, actions } = await loadActions({ tables: { crm_stage: [STAGE] } });
    const res = await actions.startIntakeAction(SLUG, startPayload({ honeypot: "http://spam", utm: { source: "ig" } }));
    expect(res).toEqual({ ok: true, token: "" });
    expect(db.writesTo("crm_intake_submission")).toHaveLength(0);
  });

  it("refuses an archived intake", async () => {
    const { db, actions } = await loadActions({ tables: { crm_stage: [STAGE] } });
    db.rows("crm_intake_form")[0].status = "archived";
    const res = await actions.startIntakeAction(SLUG, startPayload());
    expect(res.ok).toBe(false);
    expect(db.writesTo("crm_intake_submission")).toHaveLength(0);
  });
});

describe("leadFromSubmission", () => {
  const config = defaultIntakeConfig();
  const sub = { mode: "form" as const, contact, answers: [] };
  it("is byte-identical to before without a utm", () => {
    expect(leadFromSubmission(sub, config, "acme.com", "UGW 2026").referral_detail).toBe("UGW 2026 · Form on acme.com");
    expect(leadFromSubmission(sub, config, "acme.com", "UGW 2026", {}).referral_detail).toBe("UGW 2026 · Form on acme.com");
    expect(leadFromSubmission(sub, config, null, null).referral_detail).toBe("Form");
  });
  it("adds the utm line between the source tag and how", () => {
    const utm = { source: "ig", medium: "social", content: "link_in_bio", campaign: "UGW 2026".replace(" ", "-") };
    expect(leadFromSubmission(sub, config, "instagram.com", "UGW 2026", utm).referral_detail).toBe("UGW 2026 · ig / social / link_in_bio / UGW-2026 · Form on instagram.com");
  });
});

describe("the utm survives finishing", () => {
  it("keeps contact.utm when the answers are added (the update never touches contact)", async () => {
    const utm = { source: "ig", campaign: "UGW-2026" };
    const p = person({ contact: { ...contact, utm }, lead_id: null });
    const { db, actions } = await loadActions({ people: [p.row] });
    const res = await actions.submitIntakeAction(SLUG, { token: p.token, mode: "form", answers: { [QUESTIONS[0].id]: "SANKOFA", [QUESTIONS[1].id]: "Yes" } });
    expect(res.ok).toBe(true);
    const [update] = db.writesTo("crm_intake_submission", "update");
    expect(update.payload).not.toHaveProperty("contact");
    expect(db.rows("crm_intake_submission")[0].contact).toEqual({ ...contact, utm });
  });
});

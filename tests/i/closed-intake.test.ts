import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminFake, FORM_A2, FORM_B, ORG_A, ORG_B, formRow } from "../intake-forms/helpers/step-db";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";

vi.mock("server-only", () => ({}));

/**
 * Sprint 36 12.12: an archived intake's link shows the firm, a draft and an unknown slug still read identically,
 * and the closed read carries nothing about the intake itself.
 */

async function read(slug: string, tables: Record<string, Record<string, unknown>[]> = {}) {
  const db = new AdminFake({
    crm_org: [
      { id: ORG_A, name: "Hartwell IP LLC" },
      { id: ORG_B, name: "Other Firm" },
    ],
    crm_org_profile: [{ org_id: ORG_A, display_name: "Hartwell IP" }],
    crm_intake_form: [
      formRow({ config: defaultIntakeConfig(), slug: "ugw-2026", status: "archived", name: "SECRET INTAKE NAME", source_tag: "SECRET TAG" }),
      formRow({ id: FORM_A2, slug: "main-intake", status: "live", created_at: "2026-01-01T00:00:00Z", config: defaultIntakeConfig() }),
      formRow({ id: "a3333333-3333-4333-8333-333333333333", slug: "later-intake", status: "live", created_at: "2026-06-01T00:00:00Z", config: defaultIntakeConfig() }),
      formRow({ id: "a4444444-4444-4444-8444-444444444444", slug: "in-progress", status: "draft", config: defaultIntakeConfig() }),
      formRow({ id: FORM_B, org_id: ORG_B, slug: "other-firm-old", status: "archived", config: defaultIntakeConfig() }),
    ],
    crm_intake_form_slug_alias: [],
    ...tables,
  });
  vi.resetModules();
  vi.doMock("server-only", () => ({}));
  vi.doMock("@/lib/db/admin", () => ({ getAdminClient: () => db.client() }));
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => false, askClaude: vi.fn() }));
  const { readPublicIntake } = await import("@/lib/intake-forms/public");
  return { result: await readPublicIntake(slug), db };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));

describe("readPublicIntake", () => {
  it("returns ok for a live form", async () => {
    expect((await read("main-intake")).result.status).toBe("ok");
  });

  it("returns closed for an archived form, with the firm's display name and its oldest live intake", async () => {
    const { result } = await read("ugw-2026");
    expect(result).toEqual({ status: "closed", firmName: "Hartwell IP", contactSlug: "main-intake" });
  });

  it("falls back to the organisation name when there is no display name, and to no link when nothing is live", async () => {
    const { result } = await read("ugw-2026", { crm_org_profile: [], crm_intake_form: [formRow({ slug: "ugw-2026", status: "archived", config: defaultIntakeConfig() })] });
    expect(result).toEqual({ status: "closed", firmName: "Hartwell IP LLC", contactSlug: null });
  });

  it("exposes nothing about the intake itself", async () => {
    const { result } = await read("ugw-2026");
    expect(JSON.stringify(result)).not.toMatch(/SECRET|ugw-2026|config|source/i);
  });

  it("reads a draft slug and an unknown slug exactly alike, as not_found", async () => {
    const draft = (await read("in-progress")).result;
    const unknown = (await read("no-such-intake")).result;
    const malformed = (await read("Not A Slug!")).result;
    expect(draft).toEqual({ status: "not_found" });
    expect(unknown).toEqual(draft);
    expect(malformed).toEqual(draft);
  });

  it("does not offer another firm's intake as the contact", async () => {
    const { result } = await read("other-firm-old");
    expect(result).toMatchObject({ status: "closed", firmName: "Other Firm", contactSlug: null });
  });
});

describe("start and submit refuse an archived form", () => {
  it("startIntakeAction and submitIntakeAction write nothing for an archived slug", async () => {
    vi.resetModules();
    const { loadActions } = await import("../intake-forms/helpers/step-harness");
    const { db, actions } = await loadActions();
    db.rows("crm_intake_form")[0].status = "archived";
    const start = await actions.startIntakeAction("ugw-2026", { mode: "form", contact: { name: "A", email: "a@example.com" }, consent: true });
    const submit = await actions.submitIntakeAction("ugw-2026", { mode: "form", contact: { name: "A", email: "a@example.com" }, answers: {}, consent: true });
    expect(start.ok).toBe(false);
    expect(submit.ok).toBe(false);
    expect(db.writes).toHaveLength(0);
  });
});


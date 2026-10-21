import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeDb, writesTo, type FakeDb } from "./helpers/fake-db";
import { READ_ONLY_ROLES, WRITE_ROLES, formData, standardSeed } from "./helpers/seed";
import {
  LITIGATION_TYPE_CHANGE_COPY,
  MATTER_PACKAGE_MAX,
  MATTER_REFERRAL_MAX,
  MATTER_TITLE_MAX,
  validateMatterHeader,
  type MatterHeaderValues,
} from "@/lib/matters/header-edit";

const h = vi.hoisted(() => ({ db: null as unknown as { client(): unknown } }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => h.db.client()) }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async () => false) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { updateMatterHeader } = await import("@/lib/matters/matters");
const { updateMatterHeaderAction } = await import("../../src/app/dashboard/matters/[id]/actions");

const current: MatterHeaderValues = { title: "Acme", package_name: "Basic", type: "TM", referral_source: "Booth" };

let db: FakeDb;
beforeEach(() => {
  db = createFakeDb({ tables: standardSeed() });
  h.db = db;
});

describe("validateMatterHeader (pure)", () => {
  it("returns only the keys that changed", () => {
    const r = validateMatterHeader({ title: "Acme Co", packageName: "Basic", type: "TM", referralSource: "Booth" }, current);
    expect(r).toEqual({ ok: true, changes: { title: "Acme Co" }, fields: ["title"] });
  });

  it("treats a post that changes nothing as no change", () => {
    const r = validateMatterHeader({ title: " Acme ", packageName: "Basic", type: "TM", referralSource: "Booth" }, current);
    expect(r).toEqual({ ok: true, changes: {}, fields: [] });
    expect(validateMatterHeader({}, current)).toEqual({ ok: true, changes: {}, fields: [] });
  });

  it("saves blank text as null, so a blank Came from clears it", () => {
    const r = validateMatterHeader({ referralSource: "   ", packageName: "" }, current);
    expect(r).toEqual({ ok: true, changes: { package_name: null, referral_source: null }, fields: ["package_name", "referral_source"] });
  });

  it("accepts values exactly at the limits and refuses one more", () => {
    expect(validateMatterHeader({ title: "x".repeat(MATTER_TITLE_MAX) }, current).ok).toBe(true);
    expect(validateMatterHeader({ packageName: "x".repeat(MATTER_PACKAGE_MAX) }, current).ok).toBe(true);
    expect(validateMatterHeader({ referralSource: "x".repeat(MATTER_REFERRAL_MAX) }, current).ok).toBe(true);
    for (const input of [
      { title: "x".repeat(MATTER_TITLE_MAX + 1) },
      { packageName: "x".repeat(MATTER_PACKAGE_MAX + 1) },
      { referralSource: "x".repeat(MATTER_REFERRAL_MAX + 1) },
    ]) {
      const r = validateMatterHeader(input, current);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/characters or fewer/);
    }
  });

  it("refuses a type that is not in the vocabulary, including a blank one", () => {
    for (const type of ["NOPE", "", "tm"]) {
      const r = validateMatterHeader({ type }, current);
      expect(r).toEqual({ ok: false, error: "Choose a valid matter type." });
    }
  });

  it("allows a change between ordinary types", () => {
    expect(validateMatterHeader({ type: "CR" }, current)).toEqual({ ok: true, changes: { type: "CR" }, fields: ["type"] });
  });

  it("refuses to or from Litigation, with a sentence", () => {
    expect(validateMatterHeader({ type: "LIT" }, current)).toEqual({ ok: false, error: LITIGATION_TYPE_CHANGE_COPY });
    expect(validateMatterHeader({ type: "TM" }, { ...current, type: "LIT" })).toEqual({ ok: false, error: LITIGATION_TYPE_CHANGE_COPY });
    // Staying on Litigation while editing the title is fine.
    expect(validateMatterHeader({ type: "LIT", title: "New" }, { ...current, type: "LIT" }).ok).toBe(true);
  });
});

describe("updateMatterHeader (data layer)", () => {
  it("sends only the changed keys, stamps updated_at, and keeps the matter number", async () => {
    const before = Date.now();
    const out = await updateMatterHeader("matter-1", { title: "Acme Co", packageName: "Basic", type: "CR" });
    expect(out.fields).toEqual(["title", "type"]);

    const [update] = writesTo(db, "crm_matter");
    const payload = update.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["title", "type", "updated_at"]);
    expect(Date.parse(payload.updated_at as string)).toBeGreaterThanOrEqual(before);

    const row = db.rows("crm_matter").find((r) => r.id === "matter-1")!;
    expect(row.type).toBe("CR");
    expect(row.matter_number).toBe("TM-2026-0001");
  });

  it("logs one 'Matter details updated' row that names the fields and holds none of the values", async () => {
    await updateMatterHeader("matter-1", { title: "Secret Title Co", referralSource: "Hidden Referrer" });
    expect(db.activity()).toHaveLength(1);
    const row = db.activity()[0];
    expect(row.matter_id).toBe("matter-1");
    expect(row.lead_id).toBeNull();
    expect(row.type).toBe("matter_updated");
    expect(row.payload).toEqual({ change: "header", fields: ["title", "referral_source"] });
    expect(JSON.stringify(row.payload)).not.toMatch(/Secret|Hidden/);
  });

  it("writes nothing and logs nothing when nothing changed", async () => {
    const out = await updateMatterHeader("matter-1", { title: "Acme", packageName: "Basic", type: "TM", referralSource: "Booth" });
    expect(out.fields).toEqual([]);
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("clears Came from when it is posted blank", async () => {
    await updateMatterHeader("matter-1", { referralSource: "" });
    expect(db.rows("crm_matter").find((r) => r.id === "matter-1")!.referral_source).toBeNull();
  });

  it("returns a sentence and writes nothing for an over-long value, an unknown type and Litigation", async () => {
    await expect(updateMatterHeader("matter-1", { title: "x".repeat(MATTER_TITLE_MAX + 1) })).rejects.toThrow(/200 characters/);
    await expect(updateMatterHeader("matter-1", { type: "BOGUS" })).rejects.toThrow(/valid matter type/);
    await expect(updateMatterHeader("matter-1", { type: "LIT" })).rejects.toThrow(/Litigation/);
    await expect(updateMatterHeader("matter-lit", { type: "TM" })).rejects.toThrow(/Litigation/);
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("reports another firm's matter as not found and writes nothing", async () => {
    await expect(updateMatterHeader("matter-x", { title: "Hijack" })).rejects.toThrow(/couldn't be found/);
    expect(db.writes).toEqual([]);
    expect(db.rows("crm_matter").find((r) => r.id === "matter-x")!.title).toBe("Other firm");
  });
});

describe("updateMatterHeaderAction (role matrix)", () => {
  const post = (extra: Record<string, string> = {}) => formData({ matterId: "matter-1", title: "Acme Co", ...extra });

  it.each(READ_ONLY_ROLES)("refuses %s with the permission sentence and never asks the client to write", async (role) => {
    db.role = role;
    const result = await updateMatterHeaderAction({}, post());
    expect(result.error).toMatch(/permission/i);
    expect(db.writes).toEqual([]);
    expect(db.activity()).toEqual([]);
  });

  it("refuses a caller whose role cannot be resolved", async () => {
    db.role = null;
    const result = await updateMatterHeaderAction({}, post());
    expect(result.error).toMatch(/permission/i);
    expect(db.writes).toEqual([]);
  });

  it.each(WRITE_ROLES)("lets %s save and logs one row naming the fields", async (role) => {
    db.role = role;
    const result = await updateMatterHeaderAction({}, post({ referralSource: "Referral" }));
    expect(result).toEqual({ saved: true });
    expect(db.activity()).toHaveLength(1);
    expect(db.activity()[0].payload).toEqual({ change: "header", fields: ["title", "referral_source"] });
  });

  it("returns the not-found sentence for another firm's matter", async () => {
    const result = await updateMatterHeaderAction({}, formData({ matterId: "matter-x", title: "Hijack" }));
    expect(result.error).toMatch(/couldn't be found/);
    expect(db.writes).toEqual([]);
  });

  it("saves only the keys the form posted", async () => {
    await updateMatterHeaderAction({}, formData({ matterId: "matter-1", referralSource: "" }));
    const [update] = writesTo(db, "crm_matter");
    expect(Object.keys(update.payload as object).sort()).toEqual(["referral_source", "updated_at"]);
  });
});

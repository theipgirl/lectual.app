import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { customFieldPairs, mapIntake, mapIntakeLabel, readLawmaticsIntake, sanitizeText, summariseProspect } from "@/lib/consult-prep/lawmatics-intake";

vi.mock("server-only", () => ({}));

describe("the ported intake label mapping", () => {
  it.each([
    ["Is your mark in use in commerce?", "useInCommerce"],
    ["Do you intend to use the mark? (intent to use)", "useInCommerce"],
    ["How did you hear about our services?", "referralSource"],
    ["Website or Instagram", "website"],
    ["Practice Area", "practiceArea"],
    ["What products or services will it cover?", "productsServices"],
    ["Company name", "company"],
    ["Brand name you want to protect", "mark"],
    ["Please describe your inquiry", "inquiry"],
    ["Who are your main competitors?", "competitors"],
    ["What are your goals for this brand?", "goals"],
    ["Consultation fee paid?", "consultFeePaid"],
  ])("%s -> %s", (label, key) => expect(mapIntakeLabel(label)).toBe(key));

  it("a label no pattern matches maps to nothing (it reads 'not recorded')", () => {
    expect(mapIntakeLabel("Favourite colour")).toBeNull();
    expect(mapIntake([{ label: "Favourite colour", value: "blue" }])).toEqual({});
  });
  it("the first non-empty value wins", () => {
    expect(mapIntake([{ label: "Goals", value: " " }, { label: "Goals", value: "A" }, { label: "Our goals", value: "B" }])).toEqual({ goals: "A" });
  });
  it("sanitising strips tags and control characters and caps length", () => {
    expect(sanitizeText("<b>Hi</b>\u0000 there\n\tfriend", 100)).toBe("Hi there friend");
    expect(sanitizeText("x".repeat(50), 10)).toHaveLength(10);
  });
});

describe("reading custom fields, whichever shape the API uses", () => {
  const wrap = (attributes: Record<string, unknown>) => ({ data: { id: "p1", type: "prospects", attributes } });
  it("an array of { name, value }, a { label: value } map, and id-keyed values named by the firm's field list", () => {
    expect(customFieldPairs(wrap({ custom_fields: [{ name: "Goals", value: "Grow" }] }))).toEqual([{ label: "Goals", value: "Grow" }]);
    expect(customFieldPairs(wrap({ custom_fields: { Goals: "Grow" } }))).toEqual([{ label: "Goals", value: "Grow" }]);
    expect(customFieldPairs(wrap({ custom_field_values: { "77": { formatted_value: "Yes" } } }), new Map([["77", "In commerce?"]]))).toEqual([{ label: "In commerce?", value: "Yes" }]);
    expect(customFieldPairs(wrap({ custom_field_values: [{ custom_field_id: 5, value: ["a", "b"] }] }), new Map([["5", "Goals"]]))).toEqual([{ label: "Goals", value: "a, b" }]);
  });
  it("a prospect with no custom fields reads as no answers, and the practice area comes from the include", () => {
    const s = summariseProspect({ data: { id: "p1", relationships: { practice_area: { data: { type: "practice_areas", id: "1" } } } }, included: [{ type: "practice_areas", id: "1", attributes: { name: "Copyright" } }] });
    expect(s.intake.practiceArea).toBe("Copyright");
    expect(s.intake.inquiry).toBeNull();
    expect(s.other).toEqual([]);
  });
});

describe("the read's states", () => {
  const prospect = { data: { id: "p1", attributes: { custom_fields: [{ name: "Goals", value: "Grow" }] } } };
  const client = (get: (path: string, params?: Record<string, string>) => Promise<unknown>) => ({ client: async () => ({ get, listAll: async () => ({ records: [], included: new Map(), pagesFetched: 1, truncated: false, includeDropped: false }) }) as never });
  it("not linked reads no client at all", async () => {
    const reader = { client: vi.fn() };
    expect(await readLawmaticsIntake(reader as never, null)).toEqual({ state: "not-linked" });
    expect(await readLawmaticsIntake(reader as never, "  ")).toEqual({ state: "not-linked" });
    expect(reader.client).not.toHaveBeenCalled();
  });
  it("no connection, and a connection that could not be opened, are different answers", async () => {
    expect(await readLawmaticsIntake({ client: async () => null }, "p1")).toEqual({ state: "not-connected" });
    expect(await readLawmaticsIntake({ client: async () => "unreadable" }, "p1")).toEqual({ state: "unavailable" });
    expect(await readLawmaticsIntake({ client: async () => { throw new Error("x"); } }, "p1")).toEqual({ state: "unavailable" });
  });
  it("asks for the prospect by its own encoded id, all fields first", async () => {
    const calls: Array<[string, Record<string, string> | undefined]> = [];
    const out = await readLawmaticsIntake(client(async (p, params) => (calls.push([p, params]), prospect)), "p/1?x");
    expect(out.state).toBe("unavailable"); // the answer names "p1", not the id asked for
    expect(calls[0][0]).toBe("/prospects/p%2F1%3Fx");
    expect(calls[0][1]).toEqual({ include: "practice_area,stage,contact", fields: "all" });
    expect(calls[1]).toEqual(["/prospects/p%2F1%3Fx", undefined]); // then a plain retry
  });
  it("never logs a value", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    await readLawmaticsIntake(client(async () => { throw new Error("planted-secret"); }), "p1");
    await readLawmaticsIntake(client(async () => prospect), "p1");
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain("Grow");
    expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toContain("planted-secret");
    for (const s of spies) s.mockRestore();
  });
});

describe("hygiene of the consult prep sources", () => {
  const read = (f: string) => fs.readFileSync(f, "utf8");
  const walk = (dir: string): string[] => fs.readdirSync(dir).flatMap((n) => (fs.statSync(path.join(dir, n)).isDirectory() ? walk(path.join(dir, n)) : /\.(ts|tsx)$/.test(n) ? [path.join(dir, n)] : []));
  const files = walk("src/lib/consult-prep");

  it("finds its files", () => expect(files.length).toBeGreaterThanOrEqual(12));

  it("no console output anywhere in the engine or the brief (counts only leave it)", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/\bconsole\./);
  });
  it("no raw error text is returned: no err.message, String(err) or error.message in the sources", () => {
    // (card-load.ts only TESTS the queue's error for a 404; it never returns or shows it.)
    for (const f of files.filter((x) => !x.endsWith("card-load.ts"))) expect(read(f), f).not.toMatch(/\b(err|error|e)\.message\b|String\((err|error|e)\)/);
  });
  it("only inserts into crm_activity are written by the engine: no update, upsert or delete", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/\.(update|upsert|delete)\(/);
    const engine = read("src/lib/consult-prep/engine.ts");
    for (const m of engine.matchAll(/\.from\("([a-z_]+)"\)\s*\.insert\(/g)) expect(m[1]).toBe("crm_activity");
  });
  it("no deployment-wide Lawmatics token: the firm's own (firmToken) is the only one", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/LAWMATICS_TOKEN|LAWMATICS_API/);
    expect(read("src/lib/consult-prep/deps.ts")).toContain("firmToken(admin, orgId)");
  });
  it("the Lawmatics client is read-only: nothing but get and listAll is called on it", () => {
    const src = read("src/lib/consult-prep/lawmatics-intake.ts");
    expect(src).not.toMatch(/\.(post|put|patch|delete)\(/);
    expect(src).not.toMatch(/@\/lib\/lawmatics\/writes/);
  });
  it("Resend is named in no file here: mail goes through internal-mail's one file", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/resend\.com|api\.resend/i);
  });
  it("no client email is ever a recipient: the engine passes only guarded addresses, and the guard sees the lead's own", () => {
    const engine = read("src/lib/consult-prep/engine.ts");
    expect(engine).toContain("guardRecipients({ to: recipients.to, cc: recipients.cc, clientAddresses: g.clientAddresses })");
    expect(engine).toContain("to: guarded.to");
    expect(engine).not.toMatch(/to:\s*\[[^\]]*lead\.email/);
  });
  it("every statement in the engine's reads names the firm", () => {
    const engine = read("src/lib/consult-prep/engine.ts");
    const reads = [...engine.matchAll(/admin\s*\.from\("([a-z_]+)"\)/g)].length + [...engine.matchAll(/ctx\.admin\.from\("([a-z_]+)"\)/g)].length;
    expect(reads).toBeGreaterThan(5);
    for (const m of engine.matchAll(/(?:ctx\.)?admin\s*\.from\("(crm_[a-z_]+)"\)([\s\S]{0,400}?)(?=;|\n\n)/g)) {
      if (m[1] === "crm_org") continue;
      expect(m[2], m[1]).toMatch(/org_id|orgId/);
    }
  });
  it("the assistant's own wording has no firm or staff name and no email address", () => {
    for (const f of files) {
      const src = read(f);
      for (const name of ["Rebecca", "RPB", "rpblawfirm", "Taylor", "Caitlyn"]) expect(src, `${f} names ${name}`).not.toContain(name);
    }
  });
});

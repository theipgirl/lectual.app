import { describe, it, expect } from "vitest";
import { LOE_FIELDS, SAMPLE_VALUES, findMergeFields, renderLetter, type LoeValues } from "@/lib/loe";

const values: LoeValues = {
  date: "November 12, 2026",
  client_name: "Pat Client",
  entity_name: "Client Goods LLC",
  address_block: "1 Main Street\nMiami, FL 33101",
  client_email: "pat@example.com",
  signer_name: "Pat Client",
  signed_date: "November 13, 2026",
};

describe("renderLetter: the seven fields", () => {
  for (const field of LOE_FIELDS) {
    it(`merges {{${field}}}`, () => {
      const r = renderLetter(`Before {{${field}}} after.`, values);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.blocks).toEqual([{ lead: null, text: `Before ${values[field]} after.` }]);
    });
  }

  it("tolerates spaces inside the braces and repeats a field", () => {
    const r = renderLetter("{{ client_name }} and {{client_name}}", values);
    expect(r).toEqual({ ok: true, blocks: [{ lead: null, text: "Pat Client and Pat Client" }] });
  });

  it("the sample values cover every field", () => {
    expect(Object.keys(SAMPLE_VALUES).sort()).toEqual([...LOE_FIELDS].sort());
    const r = renderLetter(LOE_FIELDS.map((f) => `{{${f}}}`).join("\n\n"), SAMPLE_VALUES);
    expect(r.ok).toBe(true);
  });
});

describe("renderLetter: fail closed", () => {
  it("an unknown field is an error naming it, and there is no letter", () => {
    const r = renderLetter("Dear {{foo}}, hello {{client_name}}.", values);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({ kind: "unknown_field", field: "foo" });
      expect(r.errors[0].sentence).toContain("foo");
    }
    expect("blocks" in r).toBe(false);
  });

  it("names each unknown field once, and keeps going", () => {
    const r = renderLetter("{{a}} {{b}} {{a}}", values);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => (e.kind === "unknown_field" ? e.field : "?"))).toEqual(["a", "b"]);
  });

  it("an allowed field with no value is an error, never a blank", () => {
    const r = renderLetter("Dear {{client_name}}", { date: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ kind: "missing_value", field: "client_name" });
  });

  it("an unclosed brace is an error", () => {
    for (const body of ["Dear {{client_name,", "price}} due", "{{client_name}} {{"]) {
      const r = renderLetter(body, values);
      expect(r.ok, body).toBe(false);
    }
  });
});

describe("renderLetter: values are literal text", () => {
  const nasty = ["<script>alert(1)</script>", "a > b < c", "{{client_name}}", "}}", "{{", "**bold** & <b>x</b>"];
  for (const value of nasty) {
    it(`keeps ${JSON.stringify(value)} exactly and does not re-merge it`, () => {
      const r = renderLetter("Signed by {{signer_name}} on {{date}}.", { ...values, signer_name: value });
      expect(r).toEqual({ ok: true, blocks: [{ lead: null, text: `Signed by ${value} on ${values.date}.` }] });
    });
  }

  it("a value does not become a lead-in or a new paragraph", () => {
    const r = renderLetter("{{client_name}}", { ...values, client_name: "**Hi.**\n\nAgain" });
    expect(r).toEqual({ ok: true, blocks: [{ lead: null, text: "**Hi.**\n\nAgain" }] });
  });
});

describe("renderLetter: blocks of plain strings", () => {
  it("splits on blank lines, reads a bold lead-in, drops empty paragraphs", () => {
    const body = "**Scope of work.** We will file the application.\n\n\n\nSecond paragraph\nwith a line break.\n\n   \n\n**Fees.** As outlined.";
    const r = renderLetter(body, values);
    expect(r).toEqual({
      ok: true,
      blocks: [
        { lead: "Scope of work.", text: "We will file the application." },
        { lead: null, text: "Second paragraph\nwith a line break." },
        { lead: "Fees.", text: "As outlined." },
      ],
    });
  });

  it("never returns markup: every block is a plain string pair", () => {
    const r = renderLetter("<p>Hello</p>\n\n{{client_name}}", values);
    expect(r.ok).toBe(true);
    if (r.ok) {
      for (const b of r.blocks) {
        expect(typeof b.text).toBe("string");
        expect(b.lead === null || typeof b.lead === "string").toBe(true);
      }
      // The tag is text, not interpreted.
      expect(r.blocks[0].text).toBe("<p>Hello</p>");
    }
  });

  it("is deterministic: the same input twice is deep-equal", () => {
    const body = "**A.** {{client_name}}\n\n{{address_block}}\n\n{{date}}";
    expect(renderLetter(body, values)).toEqual(renderLetter(body, values));
  });

  it("normalises Windows line endings", () => {
    const r = renderLetter("One\r\n\r\nTwo", values);
    expect(r).toEqual({ ok: true, blocks: [{ lead: null, text: "One" }, { lead: null, text: "Two" }] });
  });
});

describe("findMergeFields", () => {
  it("lists markers in order with whether each is allowed", () => {
    const r = findMergeFields("{{date}} {{ nope }} {{client_email}}");
    expect(r.fields).toEqual([
      { name: "date", allowed: true },
      { name: "nope", allowed: false },
      { name: "client_email", allowed: true },
    ]);
    expect(r.unclosed).toBe(false);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CONSTRAINT_WORDS, PREFIX_WORDS, customColumnsError, fallbackFor, mapperSentences, type ErrorContext } from "@/lib/custom-columns/errors";
import * as W from "@/lib/ui/words";

/**
 * F12 / R7: every refusal 0115 can raise becomes a fixed sentence. The inputs are parsed from the proposal file itself, so a constraint
 * or prefix added to the SQL without a sentence fails here.
 */
const ROOT = path.resolve(__dirname, "../..");
const raw = readFileSync(path.join(ROOT, "docs/pge/2026-11-17-agentic-ip-os/0115-proposed.sql.txt"), "utf8");
const sql = raw.replace(/--.*$/gm, "");

/** Never mapped, each with its reason. */
const ALLOW: Record<string, string> = {
  crm_lead_id_org_uniq: "the parent key on crm_lead; these actions never insert a lead",
  crm_matter_id_org_uniq: "the parent key on crm_matter; these actions never insert a matter",
  crm_custom_field_id_org_uniq: "never hit: the app never sends a field's id",
};

const SENTENCES = mapperSentences();
const CONTEXTS: ErrorContext[] = ["field", "value"];

/**
 * The longest run of characters the two strings share, character for character (R7's check as the contract states it: a sentence
 * may say "Archived" where the message says "archived"; what it may never do is carry a run of the message through).
 */
function longestShared(a: string, b: string): number {
  const x = a;
  const y = b;
  let best = 0;
  const prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= y.length; j++) {
      const keep = prev[j];
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = keep;
    }
  }
  return best;
}

function checkOutput(out: string, input: { code?: string; message: string }, label: string) {
  expect(SENTENCES.has(out), `${label}: ${out}`).toBe(true);
  expect(longestShared(out, input.message), `${label}: shares 8+ characters with "${input.message}"`).toBeLessThan(8);
  expect(out).not.toMatch(/custom_|crm_/);
  if (input.code) expect(out).not.toContain(input.code);
}

const tableOf = (name: string) => (name.startsWith("crm_custom_value") ? "crm_custom_value" : name.startsWith("crm_custom_field") ? "crm_custom_field" : name.startsWith("crm_lead") ? "crm_lead" : "crm_matter");

describe("F12: the counts in the proposal file", () => {
  const raises = [...sql.matchAll(/raise exception '([a-z_]+):([^']*(?:''[^']*)*)'\s*using errcode = '(\w+)'/g)];
  // Nov 23: +1 raise and +1 prefix, custom_value_money_owner_only (custom Money is owner-only; changed on purpose).
  it("17 raise lines, 15 distinct prefixes, each mapped", () => {
    expect(raises).toHaveLength(17);
    const prefixes = [...new Set(raises.map((m) => m[1]))];
    expect(prefixes).toHaveLength(15);
    expect(prefixes.sort()).toEqual(Object.keys(PREFIX_WORDS).sort());
  });
  it("11 CHECKs, 4 named FKs, 4 unique constraints and 1 unique index; each mapped or on the allow-list", () => {
    const checks = [...sql.matchAll(/constraint (\w+) check/g)].map((m) => m[1]);
    const fks = [...sql.matchAll(/constraint (\w+) foreign key/g)].map((m) => m[1]);
    const uniques = [...sql.matchAll(/constraint (\w+) unique/g)].map((m) => m[1]);
    const index = [...sql.matchAll(/create unique index if not exists (\w+)/g)].map((m) => m[1]);
    expect(checks).toHaveLength(11);
    expect(fks).toHaveLength(4);
    expect(uniques).toHaveLength(4);
    expect(index).toHaveLength(1);
    for (const name of [...checks, ...fks, ...uniques, ...index]) {
      if (name in ALLOW) {
        expect(ALLOW[name].length).toBeGreaterThan(10);
        expect(CONSTRAINT_WORDS[name]).toBeUndefined();
        continue;
      }
      for (const ctx of CONTEXTS) expect(customColumnsError({ code: "23514", message: `violates constraint "${name}"` }, ctx), name).not.toBe(fallbackFor(ctx));
    }
    expect(Object.keys(ALLOW)).toHaveLength(3);
  });
});

describe("F12: the real message shapes map to their words, never echoing the input", () => {
  const raises = [...sql.matchAll(/raise exception '(([a-z_]+):[^']*(?:''[^']*)*)'\s*using errcode = '(\w+)'/g)];
  it("each of the 17 trigger messages, verbatim, in both contexts", () => {
    for (const m of raises) {
      const message = m[1].replace(/''/g, "'");
      const input = { code: m[3], message };
      for (const ctx of CONTEXTS) {
        const out = customColumnsError(input, ctx);
        expect(out).toBe(PREFIX_WORDS[m[2]]);
        checkOutput(out, input, m[2]);
      }
    }
  });

  it("CHECK, unique and foreign key messages by constraint name", () => {
    const shapes: Array<{ code: string; message: string; want: string }> = [];
    for (const [name, want] of Object.entries(CONSTRAINT_WORDS)) {
      if (/_fk$/.test(name)) shapes.push({ code: "23503", message: `insert or update on table "${tableOf(name)}" violates foreign key constraint "${name}"`, want });
      else if (/uniq$|one_per_record$/.test(name)) shapes.push({ code: "23505", message: `duplicate key value violates unique constraint "${name}"`, want });
      else shapes.push({ code: "23514", message: `new row for relation "${tableOf(name)}" violates check constraint "${name}"`, want });
    }
    expect(shapes).toHaveLength(17);
    for (const s of shapes)
      for (const ctx of CONTEXTS) {
        const out = customColumnsError(s, ctx);
        expect(out, s.message).toBe(s.want);
        checkOutput(out, s, s.message);
      }
  });

  it("codes: not there yet, permission (both contexts), RLS, deadlock", () => {
    const cases: Array<{ code: string; message: string; field: string; value: string }> = [];
    for (const t of ["crm_custom_field", "crm_custom_value"]) {
      cases.push({ code: "42P01", message: `relation "public.${t}" does not exist`, field: W.CUSTOM_COLUMNS_NOT_READY, value: W.CUSTOM_COLUMNS_NOT_READY });
      cases.push({ code: "PGRST205", message: `Could not find the table 'public.${t}' in the schema cache`, field: W.CUSTOM_COLUMNS_NOT_READY, value: W.CUSTOM_COLUMNS_NOT_READY });
      cases.push({ code: "42501", message: `permission denied for table ${t}`, field: W.COLUMNS_NO_PERMISSION, value: W.CUSTOM_VALUE_NOT_ALLOWED });
      // N6: the RLS refusal shape
      cases.push({ code: "42501", message: `new row violates row-level security policy for table "${t}"`, field: W.COLUMNS_NO_PERMISSION, value: W.CUSTOM_VALUE_NOT_ALLOWED });
    }
    cases.push({ code: "40P01", message: "deadlock detected", field: W.CUSTOM_BUSY, value: W.CUSTOM_BUSY });
    for (const c of cases) {
      expect(customColumnsError(c, "field"), c.message).toBe(c.field);
      expect(customColumnsError(c, "value"), c.message).toBe(c.value);
      checkOutput(customColumnsError(c, "field"), c, c.message);
      checkOutput(customColumnsError(c, "value"), c, c.message);
    }
  });
});

describe("F12: precedence is prefix, then constraint, then code", () => {
  it("a prefix beats its code", () => {
    expect(customColumnsError({ code: "23505", message: "custom_field_label_taken: another live column of this firm already has this name" }, "field")).toBe(W.CUSTOM_LABEL_TAKEN);
    expect(customColumnsError({ code: "23503", message: "custom_value_no_field: no such column" }, "value")).toBe(W.CUSTOM_FIELD_GONE);
    expect(customColumnsError({ code: "23503", message: "custom_value_no_record: no such record" }, "value")).toBe(W.RECORD_CARD_GONE);
  });
  it("a constraint name beats a different code", () => {
    expect(customColumnsError({ code: "42501", message: 'new row for relation "crm_custom_field" violates check constraint "crm_custom_field_label_len"' }, "field")).toBe(W.CUSTOM_LABEL_TOO_LONG);
    expect(customColumnsError({ code: "40P01", message: 'duplicate key value violates unique constraint "crm_custom_field_label_live_uniq"' }, "field")).toBe(W.CUSTOM_LABEL_TAKEN);
  });
  it("an unknown code, or a known code with an unknown constraint, is the context's fallback", () => {
    expect(customColumnsError({ code: "XX000", message: "boom" }, "field")).toBe(W.CUSTOM_SAVE_FAILED);
    expect(customColumnsError({ code: "23505", message: 'duplicate key value violates unique constraint "crm_something_else"' }, "value")).toBe(W.CUSTOM_VALUE_SAVE_FAILED);
    expect(customColumnsError({ code: "23503", message: 'violates foreign key constraint "crm_lead_id_org_uniq"' }, "value")).toBe(W.CUSTOM_VALUE_SAVE_FAILED);
  });
});

describe("F12: anything that isn't a PostgREST error gets a fixed sentence and never throws", () => {
  const hostile = { get code(): string { throw new Error("no"); } };
  for (const [name, input] of [
    ["null", null],
    ["undefined", undefined],
    ["a string", "something broke"],
    ["an object with no code", { message: "x" }],
    ["a number", 42],
    ["a getter that throws", hostile],
  ] as const) {
    it(name, () => {
      for (const ctx of CONTEXTS) {
        expect(() => customColumnsError(input, ctx)).not.toThrow();
        expect(customColumnsError(input, ctx)).toBe(fallbackFor(ctx));
      }
    });
  }
  it("an Error whose message starts with a prefix maps by the prefix", () => {
    expect(customColumnsError(new Error("custom_value_bad_choice: x"), "value")).toBe(W.CUSTOM_CHOICE_BAD);
  });
});

describe("the sentences", () => {
  // Changed on purpose (editable views): field create and change are an owner's (lectual 0119), and there is no Settings -> Columns screen to bring an archived column back from.
  it("are the contract's, with the owner named in the permission line (N5)", () => {
    expect(W.COLUMNS_NO_PERMISSION).toBe("Only an owner can change columns.");
    expect(W.CUSTOM_COLUMN_ARCHIVED).toBe("Archived columns can't be changed.");
    expect(W.CUSTOM_COLUMNS_NOT_READY).toBe("Custom columns aren't switched on for your firm yet. Lectual will turn it on.");
    expect(W.CUSTOM_VALUE_CHANGED).toBe("This cell was changed by someone else just now. Refresh and try again.");
    expect(W.CUSTOM_FIELD_CHANGED).toBe("This column was changed by someone else just now. Refresh and try again.");
  });
  it("say nothing of databases, migrations, modules, schemas, deployments or coded identifiers", () => {
    for (const s of SENTENCES) {
      expect(s).not.toMatch(/database|migration|module|schema|deployment/i);
      expect(s).not.toMatch(/\b0\d{3}\b|\b\d{4,}\b/);
    }
  });
});
